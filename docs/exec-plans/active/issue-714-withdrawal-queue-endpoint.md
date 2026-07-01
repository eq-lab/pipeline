# Issue #714: Panel C: Withdrawal Queue protocol API endpoint

Source: https://github.com/eq-lab/pipeline/issues/714

## Scope

Add a **protocol-level** (aggregate, not per-wallet) read endpoint backing Panel C
of the Protocol Dashboard (#712). New route `GET /v1/withdrawal-queue`, sourced
entirely from `contract_logs` (`WithdrawalRequested` + `RequestClaimed`).

Returns:
- `summary.total_queue_depth` — Σ outstanding escrowed amount across pending requests.
- `summary.pending_count`, split into `fully_pending_count` and `partially_filled_count`.
- `summary.oldest_pending_age_seconds` — age of the oldest still-outstanding request.
- `summary.coverage_ratio` — available USDC ÷ queue depth (see **Open Questions** — the
  denominator source does not exist in the API layer yet; served as `null` for now).
- `recent_fills[]` — recent `RequestClaimed` rows: `queue_id`, `amount_filled`,
  `fill_type` (`full` | `partial`), `time_in_queue_seconds`, `filled_at`.

**In scope:** new route module, new shared repo method (raw-row fetch), a pure
compute function, unit tests, OpenAPI registration, epic endpoint-table update.

**Out of scope:** the Panel C UI (#719); the Panel A balance-sheet/reserves endpoint;
any on-chain RPC reads from the API; contract or indexer changes; Stellar-specific
address handling beyond what the shared query already does (events are chain-scoped
by `chain_id`).

## Assumptions and Risks

- **Amounts are base-6** (same scale as USDC/PLUSD elsewhere) and formatted with
  `formatting::base6_to_decimal_string`, matching `loan_book` / `analytics`. PLUSD is
  1:1 redeemable, so queue depth and USDC coverage share a scale.
- **Event param shape is confirmed** (`packages/worker/src/indexer/parsers.rs`,
  `packages/worker/tests/parsers.rs`):
  - `WithdrawalRequested` → `params`: `withdrawer`, `request_id`, `amount`, `queued`.
  - `RequestClaimed` → `params`: `request_id`, `user`, `amount`.
- **`amount` vs `queued`:** on `WithdrawalRequested`, `amount` = total requested,
  `queued` = portion escrowed into the queue (not paid immediately). The on-chain
  `IWithdrawalQueue.queueMetadata()` (`{queued, claimable, claimed, …}`,
  `worker/src/relayer/custodian.rs`) confirms `queued` is the escrowed/outstanding
  magnitude. **Queue depth is summed over `queued`, not `amount`.**
- **Claimed detection must be contract-scoped.** `RequestClaimed` is emitted by *both*
  the DepositManager and the WithdrawalQueue (see `routes/vouchers.rs`), and
  `request_id` is not unique across contracts. The claimed-match join **must** include
  `c2.contract_address = r.contract_address` (the exact pattern already used in
  `kyc_repo::get_all_requests`, `kyc_repo.rs:884`). Omitting it would let a deposit
  claim mark a withdrawal as filled. **Risk if missed → silent under-counting of the queue.**
- **Risk:** the "fully pending vs partially filled" split depends on the semantics
  chosen in Open Question 1. Plan assumes the request-time interpretation
  (`partially_filled ⇔ 0 < queued < amount`), which is fully derivable from indexed
  data; the multi-claim interpretation is not, without more event detail.
- Depends on nothing unfinished for the queue metrics; the `coverage_ratio` field
  depends on a USDC-reserve source that does not exist yet (Open Question 2). #719 (UI)
  is blocked on this issue.

## Open Questions

_Resolved with the requester on 2026-07-01:_

1. **Full-vs-partial semantics → RESOLVED: request-time interpretation.**
   `partially_filled ⇔ 0 < queued < amount`; `fully_pending ⇔ queued == amount`. One
   `RequestClaimed` per `request_id`; use the latest-claim LATERAL join (no per-id
   claim aggregation). This is the model in Implementation Steps.
2. **Coverage-ratio denominator → RESOLVED: serve `null` now.** Ship queue
   depth/counts/oldest-age/fills immediately with `coverage_ratio: null`; wire the real
   ratio once the Panel A balance-sheet/reserves endpoint provides available USDC. No
   API RPC reads and no new indexing in this issue.
3. **`recent_fills` window → default: latest 10 by `claimed_at` desc.** Adjustable in
   review; no blocker.

## Implementation Steps

1. **Shared repo — raw-row fetch.** Add `WithdrawalQueueRepo` in
   `packages/shared/src/withdrawal_queue_repo.rs` (register in
   `packages/shared/src/lib.rs`), or add methods to `contract_logs_repo.rs` if the
   reviewer prefers consolidation. Expose one method:
   - `async fn list_queue_rows(&self, executor, chain_id, to_unix) -> anyhow::Result<Vec<WithdrawalQueueRow>>`
   returning one row per `WithdrawalRequested` with its claim state, via a single query:
   ```sql
   SELECT (r.params->>'request_id')     AS request_id,
          (r.params->>'amount')::numeric  AS amount,
          (r.params->>'queued')::numeric  AS queued,
          r.block_timestamp               AS requested_at,
          claim.claimed_amount,
          claim.claimed_at
   FROM contract_logs r
   LEFT JOIN LATERAL (
       SELECT (c.params->>'amount')::numeric AS claimed_amount,
              c.block_timestamp              AS claimed_at
       FROM contract_logs c
       WHERE c.event_name = 'RequestClaimed'
         AND c.params->>'request_id' = r.params->>'request_id'
         AND c.contract_address = r.contract_address   -- contract-scoped (see Risks)
       ORDER BY c.block_timestamp DESC, c.log_index DESC
       LIMIT 1
   ) claim ON TRUE
   WHERE r.chain_id = $1
     AND r.event_name = 'WithdrawalRequested'
     AND r.block_timestamp <= $2
   ```
   Define `WithdrawalQueueRow { request_id: String, amount: BigDecimal, queued: BigDecimal, requested_at: i64, claimed_amount: Option<BigDecimal>, claimed_at: Option<i64> }`.
   (If OQ1 resolves to multi-claim, replace the LATERAL with a `SUM(claimed_amount)` +
   `MAX(claimed_at)` aggregate.)
2. **Route module.** Create `packages/api/src/routes/withdrawal_queue.rs` mirroring
   `loan_book.rs` structure:
   - DTOs: `WithdrawalQueueSummary`, `RecentFill`, `WithdrawalQueueResponse` (all
     `Serialize, ToSchema`); amounts as base-6 decimal strings, ratio as a decimal string.
   - `#[derive(OpenApi)] pub struct WithdrawalQueueDoc` listing the handler + schemas.
   - `pub fn router() -> Router<Arc<AppState>>` with `.route("/withdrawal-queue", get(get_withdrawal_queue))`.
   - Handler `get_withdrawal_queue(State, Query<ChainQuery>)` → `resolve_chain`, compute
     `to = now` (as in `loan_book::handle_loan_book`), fetch rows, delegate to compute.
   - **Pure** `pub fn compute_withdrawal_queue(rows: &[WithdrawalQueueRow], now: i64) -> WithdrawalQueueResponse`
     (no I/O — unit-testable per the tests-in-external-files convention):
     - Outstanding ⇔ `claimed_amount.is_none()` (OQ1 request-time model) and `queued > 0`.
     - `total_queue_depth` = Σ `queued` over outstanding, `base6_to_decimal_string`.
     - `fully_pending` ⇔ `queued == amount`; `partially_filled` ⇔ `0 < queued < amount`.
     - `oldest_pending_age_seconds` = `now − min(requested_at)` over outstanding; `None` if empty.
     - `recent_fills` = rows with `claimed_at.is_some()`, sorted `claimed_at` desc, take 10
       (OQ3); `fill_type` = `full` if `claimed_amount >= amount` else `partial`;
       `time_in_queue_seconds = claimed_at − requested_at`; `filled_at` = RFC3339.
     - `coverage_ratio` = `None` (OQ2, pending a USDC-available source).
3. **Register the module.** Add `pub mod withdrawal_queue;` to
   `packages/api/src/routes/mod.rs`; in `packages/api/src/main.rs` add
   `.nest("/v1", pipeline_api::routes::withdrawal_queue::router())` and
   `api_docs.merge(pipeline_api::routes::withdrawal_queue::WithdrawalQueueDoc::openapi());`.
4. **Wire the repo into `AppState`** (`packages/api/src/lib.rs`) if a dedicated
   `WithdrawalQueueRepo` is used; otherwise reuse `contract_logs_repo`. Construct it
   wherever `AppState` is assembled (follow `submitted_loan_repo` / `loan_parameters_repo`).
5. **Lint:** `cargo clippy --all -- -D warnings` clean.

## Test Strategy

New compute-layer test file `packages/api/tests/withdrawal_queue.rs` (external, pure —
no DB, no env vars, per project convention), exercising `compute_withdrawal_queue`
against fixture `WithdrawalQueueRow`s:
- Empty input → zeroed depth, `pending_count = 0`, `oldest_pending_age_seconds = None`,
  empty `recent_fills`, `coverage_ratio = None`.
- Mixed set: fully-pending (`queued == amount`, unclaimed), partially-filled
  (`queued < amount`, unclaimed), and fully-claimed rows → assert `total_queue_depth`
  sums only outstanding `queued`; `fully_pending_count` / `partially_filled_count`
  correct; claimed rows excluded from depth.
- `oldest_pending_age_seconds` picks the min `requested_at` among outstanding only.
- `recent_fills`: correct ordering (newest first), `full` vs `partial` classification,
  `time_in_queue_seconds`, and the N-limit (OQ3).
- Base-6 formatting assertions on `total_queue_depth` and `amount_filled`.

Run `cargo clippy --all -- -D warnings` and the workspace test suite; no `DATABASE_URL`
/ `POSTGRES_URL` reads in tests.

## Docs to Update

- Update the epic **#712** endpoint table: Panel C row → ✅ `GET /v1/withdrawal-queue`
  (note `coverage_ratio` pending per OQ2).
- `docs/product-specs/dashboards.md` — Panel C: add a one-line note that the aggregate
  is served by `GET /v1/withdrawal-queue` and that coverage awaits the reserves source.
- OpenAPI is generated from the utoipa annotations (`WithdrawalQueueDoc`) — no manual
  doc file. If `docs/generated/` holds a checked-in OpenAPI dump, regenerate it.
