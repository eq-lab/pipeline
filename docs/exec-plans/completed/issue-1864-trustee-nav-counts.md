# Issue #1864: Backend: per-section pending counts for the Trustee sidebar badges (Origination / Loans / Cash Management)

Source: https://github.com/eq-lab/pipeline/issues/1864

Parent epic: #775. Unblocks frontend #1350 (TD-36). Related: #784 (closed: it shipped only
`GET /v1/capital-allocation`, and its finalized scope said Needs Attention needs no backend work),
#799 (Overview "Needs Attention", see "Findings" below).

## Findings (research at plan time)

- **No existing Trustee read fits.**
  - `GET /v1/capital-allocation` is public, per-network money.
  - `GET /v1/loan-book` and `GET /v1/loan-book/submissions` are public, and the loan book
    computes prices, collateral and pockets on every call.
  - `GET /v1/cash-book` is Stellar-only. It requires `chain_id` and answers 404 on EVM.

  Bolting counts onto any of them would change its auth or its chain semantics. This plan
  therefore adds **one consolidated Trustee-only route**.
- **Overview "Needs Attention" computes no counts.** `packages/trustee/src/components/useNeedsAttention.ts`
  fetches unfiltered `useLoanSubmissions()` and `useLoanBook()`. It filters rows client-side:
  submissions with normalized `InReview` / `ChangesRequested` (#1046), and loans with display
  `WatchList` / `Past Due` / legacy `Matured` (#867). It then renders rows; it never renders a
  number. That is documented row selection over served statuses
  (`docs/frontend/trustee-flows.md#needs-attention-section`), not a frontend-computed metric. So
  it is no reason to serve counts. The sidebar badge is a number, so it does need a served count.
- **#799 is partly stale.**
  - The Origination group shipped in #818 and #1046.
  - The Loans group (Watchlist + Matured) shipped in #867.
  - "Loans — payments due" was de-scoped by #784. For today's bullet loans the next payment is the
    maturity, so it is covered by `Past Due`.
  - The Cash Management group is still labelled "blocked on backend", but its sources now exist:
    `GET /v1/cash-book` (#1790, Stellar) and `GET /v1/ramp/events` (#936, both chains). That
    premise is stale.
  - Only the Risk Council group still has no backend. There is no proposal/timelock data source
    in `packages/api`.

  The manager should re-scope #799. This plan does not touch it.

## Scope

**In: one new read, `GET /v1/attention-counts?chain_id=`.** It is Trustee-only and served from data
the backend already indexes or stores. There is no migration, no new env key and no RPC call.

- **Auth.** A bearer token is required (401 from the `AuthClaims` extractor before any DB access).
  The `trustee` role is required (403).
- **`chain_id`.** It follows the `GET /v1/loan-book` rule (`parse_chain_scope`):
  - omitted = every configured chain;
  - a configured id = that chain;
  - a well-formed unconfigured id = 200 with zero counts, `null` sourced fields and `chains: []`;
  - malformed or repeated = 400.
- **The response serves one count per badge plus its breakdown.** It does so for the union of the
  in-scope chains and again per chain (`chains[]`). This lets the sidebar make **one call with no
  `chain_id`**:
  - it reads `origination.count` and `loans.count` from the union, because those pages are
    cross-network (#1536/#1537);
  - it reads `cash_management.count` from the session chain's `chains[]` entry, because Cash
    Management is per-network (#1600/#1669).

  The client does no arithmetic, only a lookup by `chain_id`.

**Proposed badge definitions** (product choices; confirm in Open Questions):

| Badge | `count` = | Breakdown fields served |
|---|---|---|
| Origination | `in_review`: submissions with stored status `InReview` and no drawn `loan_id`, targeting an in-scope chain | `in_review`, `changes_requested` (stored `ChangesRequested`, undrawn), `approved_undrawn` (stored `Approved`, `loan_id IS NULL`, i.e. draw not yet linked by the indexer) |
| Loans | distinct loans, raw on-chain status not `Closed` and not `Default`, where the display status is `WatchList` or `Past Due`, **or** there is an open margin call. A loan matching several conditions counts once | `watch_list` (display `WatchList`), `past_due` (display `Past Due`), `margin_call_open` (`security_terms.margin_call_at <> 0` on a non-`Closed` loan; `null` when no in-scope chain has a SecurityRegistry), `disbursing` (display `Disbursing`), `defaulted` (raw `Default`) |
| Cash Management | `escrowed_wire_ins + pending_wire_outs + open_ramps + pending_ramp_events`, with `null` terms skipped | `escrowed_wire_ins` (minter `WireIn` with receiver = minter and no assign/return), `pending_wire_outs` (`WireOutRequested` with no settle/cancel), `open_ramps` (`RampOpened` with no `RampClosed`): all three are `null` when the chain has no minter (every EVM chain). `pending_ramp_events`: the length of `GET /v1/ramp/events`'s pending list, `null` when the chain has no custody/ramp address sets |

Display statuses come from `routes::loan_book::display_status`. They are the same strings
`GET /v1/loan-book` serves, so the badge agrees with the Loans page and the Needs Attention Loans
group. Minter statuses come from `minter_cash_book::{build_wire_ins, build_wire_outs, build_ramps}`,
so the badge agrees with `GET /v1/cash-book`.

**Response shape** (counts are JSON integers; there are no amounts):

```json
{
  "origination": { "count": 2, "in_review": 2, "changes_requested": 1, "approved_undrawn": 0 },
  "loans": { "count": 3, "watch_list": 1, "past_due": 2, "margin_call_open": 1,
             "disbursing": 1, "defaulted": 0 },
  "cash_management": { "count": 3, "escrowed_wire_ins": 1, "pending_wire_outs": 1,
                       "open_ramps": 0, "pending_ramp_events": 1 },
  "chains": [
    { "chain_id": 99000001, "origination": { "...": "..." }, "loans": { "...": "..." },
      "cash_management": { "count": 2, "escrowed_wire_ins": 1, "pending_wire_outs": 1,
                           "open_ramps": 0, "pending_ramp_events": 0 } },
    { "chain_id": 560048, "origination": { "...": "..." },
      "loans": { "count": 1, "watch_list": 1, "past_due": 0, "margin_call_open": null,
                 "disbursing": 0, "defaulted": 0 },
      "cash_management": { "count": 1, "escrowed_wire_ins": null, "pending_wire_outs": null,
                           "open_ramps": null, "pending_ramp_events": 1 } }
  ]
}
```

- **Union rules.**
  - The top-level sections are the per-chain sums.
  - A nullable field is `null` at the top level only when it is `null` on every in-scope chain
    (the `capital-allocation` convention).
  - `count` is never `null`.
  - `chains[]` is in `CHAINS` order.
- **EVM keeps working.**
  - An EVM chain contributes its submissions, loan statuses and pending ramp events.
  - Its minter and margin-call fields are `null`.
  - No existing route changes.

**Out of scope:**

- the frontend wiring (#1350);
- the Needs Attention item lists (#799);
- a Risk Council / LP Counterparties badge (none in Figma `4116:8855`; no backend source);
- the withdrawal queue and LP bank deposits as Cash Management items (see Open Questions);
- caching or materialising the counts.

## Assumptions and Risks

- **Per-request cost.** The sidebar renders on every Trustee page and will poll (#1350, likely
  30 s). Per in-scope chain the handler reads:
  - latest loan snapshots;
  - `loan_disbursement`;
  - `security_terms`;
  - the minter's full cash-book event history (`list_minter_events`, as `/v1/cash-book` does);
  - the full `AssetTransfer` list (`list_asset_transfers`, as `/v1/ramp/events` does).

  The last two grow with history. Run the per-chain reads concurrently (`tokio::try_join!`) and
  log a tech-debt entry ("attention counts recomputed per request; no materialisation"). It does
  not block shipping.
- **Margin-call scoping.**
  - `security_terms` is keyed by the SecurityRegistry address, not by the LoanRegistry.
  - Open calls are matched to the chain's current LoanRegistry snapshots by `loan_id`
    (`loan_key(BigDecimal)` against `i64::to_string`). This is the same assumption
    `GET /v1/loan-book/{id}/security` makes; it only warns on a registry mismatch.
  - After a LoanRegistry redeploy with reused ids, an old call could attach to a new loan. That is
    accepted, as for the per-loan route.
  - The projection can lag (`refresh_pending` on the per-loan route). The badge reflects the
    projection, not the chain.
- **Submissions targeting an unconfigured chain are not counted.** `GET /v1/loan-book/submissions`
  with no `chain_id` still lists them. This is a rare historical edge, documented in the spec.
- **Stale InReview rows are excluded.** An `InReview` row that is already drawn and linked
  (the #831 mint-succeeded/review-failed residual) is excluded by `loan_id IS NULL`. The
  Origination page shows such a row as `Approved` (its live status, normalized), so the two agree.
- **"Plain-string numbers" does not apply here.** The project's plain-string rule is for amounts.
  This response has none, and counts are JSON integers, following the precedent of
  `GET /v1/withdrawal-queue.requests_count: i64` and `TrusteeNavItem.badgeCount?: number`. See
  Open Questions.
- **A sub-read failure fails the whole response (500).** This applies to any one sub-read (e.g.
  the minter events query). The sidebar then shows no badges, which is the existing no-badge
  state. Partial results with per-section `null` on error are not attempted.
- **No dependency on open issues.** #1780 / #1779 (security projection) and #1790 (cash book) are
  merged on `main` (`193ba5ee`, `6b568fc2`).

## Open Questions

_None_

### Resolved questions (human, 2026-11-09)

1. **Origination `count`** = `InReview` **plus `approved_undrawn`** (both need a Trustee action). `ChangesRequested` is served in the breakdown but not counted (it waits on the originator).
2. **Loans `count`** additionally includes **`Disbursing`** (the Trustee must disburse). `Default` is served but not counted (Risk Council domain).
3. **Cash Management:** count each ramp **once** (an open ramp and its review event must not both count — dedupe by ramp id); **add the LP pending bank deposits** from #1285 (`pending_bank_deposits` source: recorded, not minted, not returned) as a counted item on both chains; the withdrawal queue stays out. If #1285 is not merged when this is implemented, add the field as a breakdown with the same SQL definition and note the dependency.
4. **Route and shape:** `GET /v1/attention-counts` with combined + `chains[]` is confirmed.
5. **Counts are JSON integers.**

## Implementation Steps

1. **Shared SQL: submissions.** In `packages/shared/src/submitted_loan_repo.rs`:
   - Add `pub const COUNT_UNDRAWN_SUBMISSIONS_SQL`:
     `SELECT target_chain_id, COUNT(*) FILTER (WHERE status = 'InReview') AS in_review,
     COUNT(*) FILTER (WHERE status = 'ChangesRequested') AS changes_requested,
     COUNT(*) FILTER (WHERE status = 'Approved') AS approved_undrawn FROM submitted_loans
     WHERE loan_id IS NULL AND target_chain_id = ANY($1::bigint[]) GROUP BY target_chain_id
     ORDER BY target_chain_id`.
   - Add `#[derive(sqlx::FromRow)] pub struct SubmissionCountsRow { target_chain_id: i64,
     in_review: i64, changes_requested: i64, approved_undrawn: i64 }`.
   - Add `SubmittedLoanRepo::count_undrawn_by_chain(&self, chain_ids: &[i64]) ->
     Result<Vec<SubmissionCountsRow>>`. It returns an empty `Vec` without a query when
     `chain_ids` is empty.
2. **Shared SQL: margin calls.** In `packages/shared/src/security_registry_repo.rs`:
   - Add `pub const LIST_OPEN_MARGIN_CALL_LOANS_SQL`:
     `SELECT loan_id FROM security_terms WHERE chain_id = $1 AND contract_address = $2
     AND margin_call_at <> 0 ORDER BY loan_id`.
   - Add `SecurityRegistryRepo::list_open_margin_call_loans(&self, chain_id, contract) ->
     anyhow::Result<Vec<i64>>`.
3. **Route module.** Add `packages/api/src/routes/attention_counts.rs` with the spec-pointer header
   `// spec: docs/product-specs/trustee-attention-counts.md#api-contract`. It is comment-less
   otherwise.
   - **DTOs** (`Serialize`, `ToSchema`, no `skip_serializing_if`, so `null` is explicit):
     - `OriginationCounts { count, in_review, changes_requested, approved_undrawn }`, all `i64`;
     - `LoanCounts { count, watch_list, past_due, margin_call_open: Option<i64>, disbursing,
       defaulted }`;
     - `CashManagementCounts { count, escrowed_wire_ins: Option<i64>, pending_wire_outs:
       Option<i64>, open_ramps: Option<i64>, pending_ramp_events: Option<i64> }`;
     - `ChainAttentionCounts { chain_id, origination, loans, cash_management }`;
     - `AttentionCountsResponse { origination, loans, cash_management, chains:
       Vec<ChainAttentionCounts> }`.
   - **Pure builders** (pub, no I/O):
     - `origination_counts(chain_id, rows: &[SubmissionCountsRow]) -> OriginationCounts`. A
       missing chain gives zeros; `count = in_review`.
     - `loan_counts(snapshots: &[LoanSnapshotRow], disbursed: &HashMap<String, bool>,
       open_margin_calls: Option<&HashSet<String>>, now: i64) -> LoanCounts`.
       - Per loan, take `display_status(&s.status, disbursed.get(loan_key).unwrap_or(false), now,
         s.current_maturity_timestamp)`.
       - Skip raw `Closed`.
       - Tally the breakdown fields.
       - `count` is the number of loans with raw status ≠ `Default` and (display ∈ {`WatchList`,
         `Past Due`} or `loan_key ∈ open_margin_calls`).
     - `cash_management_counts(minter: Option<(&[MinterEventRow], &str)>, pending_ramp_events:
       Option<usize>) -> CashManagementCounts`. It counts `WireInStatus::Escrowed`,
       `WireOutStatus::Pending` and `RampStatus::Open` from the existing builders; `count` sums
       the non-`null` terms.
     - `build_response(chains: Vec<ChainAttentionCounts>) -> AttentionCountsResponse`. It
       produces the union sums, with nullable fields summed over the non-`null` chains and `null`
       when all are `null`.
     - `authorize(claims, uri, chains) -> Result<ChainScope, ApiError>`. It runs
       `require_trustee` first, then `parse_chain_scope`, the same order as
       `cash_book::authorize`.
   - **Handler** `get_attention_counts(AuthClaims, State, Uri)`:
     1. `authorize`.
     2. Resolve the in-scope `ConfiguredChain`s (`LenientChainFilter::configured` semantics).
     3. `now` = system time.
     4. Run one `count_undrawn_by_chain` over all in-scope ids.
     5. Per chain, run concurrently (`tokio::try_join!`):
        - `list_latest_loan_snapshots(pool, chain_id, loan_registry_address(..)?, now)`;
        - `loan_disbursement_repo.list_for_chain`;
        - `list_open_margin_call_loans` if `security_registry_addresses` has the chain (else
          `None`);
        - `list_minter_events` if `minter_addresses` has the chain (else `None`);
        - `list_asset_transfers(pool, chain_id, now)` followed by
          `ramp::filter_pending_ramp_events(..).len()` if `transfer_addresses` has the chain
          (else `None`).
     6. Return `build_response`.
   - **Router and OpenAPI.**
     - `router()` → `.route("/attention-counts", get(get_attention_counts))`.
     - `#[utoipa::path]` with `params(LenientChainFilter)` and responses 200 / 400 / 401 / 403 /
       500.
     - `security(("bearer_auth" = []))`, tag `"AttentionCounts"`.
     - `AttentionCountsDoc` with `modifiers(&SecurityAddon)`.
4. **Wiring.**
   - `packages/api/src/routes/mod.rs`: add `pub mod attention_counts;`.
   - `packages/api/src/main.rs`: add
     `api_docs.merge(...attention_counts::AttentionCountsDoc::openapi())` and
     `.nest("/v1", pipeline_api::routes::attention_counts::router())`.
5. **Tech debt.** Add an entry to `docs/exec-plans/tech-debt-tracker.md`: the attention counts are
   recomputed per request over the full minter and asset-transfer history (no materialisation).
   Update TD-36: a backend source now exists, and the remaining work is frontend #1350.
6. **Docs** (see Docs to Update) and the user-stories doc.
7. **Lint and build:**
   - `cargo fmt --all`;
   - `cargo clippy --all -- -D warnings`;
   - `cargo test -p pipeline-api -p shared`;
   - `/Users/aabliazimov/Documents/work/pipeline/node_modules/.bin/tsx scripts/lint-docs.ts`.

## Test Strategy

All tests are pure unit tests in `packages/<pkg>/tests/<topic>.rs`. There is no inline
`#[cfg(test)]`, no `DATABASE_URL` / `POSTGRES_URL` and no Postgres. A
`PgPool::connect_lazy("postgres://localhost/test")` state is used only where the request returns
before any query, as `tests/cash_book.rs` does. Test bodies have no comments.

- **`packages/shared/tests/submitted_loan_repo.rs`** (extend). SQL needle tests:
  `COUNT_UNDRAWN_SUBMISSIONS_SQL` contains `loan_id IS NULL`, `target_chain_id = ANY($1::bigint[])`,
  `GROUP BY target_chain_id` and each of the three `FILTER (WHERE status = '…')` clauses, and
  does not contain `'Rejected'`.
- **`packages/shared/tests/security_registry_repo_sql.rs`** (extend). SQL needle tests:
  `LIST_OPEN_MARGIN_CALL_LOANS_SQL` contains `FROM security_terms`,
  `chain_id = $1 AND contract_address = $2` and `margin_call_at <> 0`.
- **New `packages/api/tests/attention_counts.rs`:**
  - **Origination:**
    - `InReview` counts;
    - `ChangesRequested` / `approved_undrawn` are served but not counted;
    - rows of another chain are ignored;
    - a chain with no row gives all zeros.
  - **Loans** (fixture `LoanSnapshotRow`s, as in `tests/loan_book.rs`):
    - a `WatchList` with off-ramp complete counts;
    - `Performing` past maturity → `past_due` counts;
    - `Performing` past maturity with no disbursement row → `disbursing`, not counted;
    - raw `Default` → `defaulted`, not counted, even with an open margin call;
    - raw `Closed` with an open margin call is ignored entirely;
    - `Performing` + open margin call counts;
    - `WatchList` + open margin call counts **once**;
    - `open_margin_calls = None` → `margin_call_open: null` and the other fields unchanged (EVM
      regression);
    - loan-id key matching between a `BigDecimal` snapshot id and an `i64` margin id.
  - **Cash management** (fixture `MinterEventRow`s, as in `tests/minter_cash_book.rs`):
    - escrowed vs. direct, assigned and returned wire-ins;
    - pending vs. settled and cancelled wire-outs;
    - open vs. closed ramps;
    - a malformed `WireIn` is skipped;
    - `minter = None` → the three minter fields `null`, with `count` = `pending_ramp_events` (EVM
      regression);
    - `pending_ramp_events = None` → `null`;
    - all `None` → `count: 0`.
  - **Response union:**
    - sums across two chains;
    - a nullable field is `null` only when every chain is `null` (Stellar + EVM → numeric);
    - an empty `chains` gives zero counts and `null` fields;
    - `chains[]` order is preserved;
    - the JSON shape (`serde_json::to_value`) has exact keys and explicit `null`s.
  - **Auth and chain:**
    - a request without a token → 401 via `router()` + `oneshot` on a lazy pool;
    - a non-trustee → 403 with or without `chain_id`;
    - a trustee with a malformed or repeated `chain_id` → 400;
    - an unconfigured id → `ChainScope::Unconfigured`;
    - omitted → `ChainScope::All`.
  - **OpenAPI:** `/v1/attention-counts` is documented with an optional `chain_id`, bearer
    security, and the 401/403 responses; the schemas are registered.
- No frontend tests: the frontend is #1350. No Figma verification: this is backend only, and
  Figma `4116:8855` is consumed by #1350.

## Docs to Update

- **New `docs/product-specs/trustee-attention-counts.md`** (under 150 lines), with an entry in
  `docs/product-specs/index.md` (Operations Console). Sections:
  - Overview;
  - Behavior: the per-badge definitions table from Scope, the chain scope, union/`null` rules and
    the EVM behaviour;
  - API Contract: `GET /v1/attention-counts`, its auth, statuses and the response example;
  - Data Model: no table; the sources are `submitted_loans`, the latest loan snapshots,
    `loan_disbursement`, `security_terms`, the minter `contract_logs` rows and `AssetTransfer`
    with `ramp_reviews`;
  - Security: Trustee-only, because it joins review state across Trustee queues.

  Write the definitions in their final, confirmed form after the Open Questions are answered.
- **`docs/product-specs/trustee-dashboard.md` "API" table:** add a "Sidebar attention counts
  (`GET /v1/attention-counts`)" row linking the new spec.
- **`ARCHITECTURE.md`** (the chain-scope paragraph): add `GET /v1/attention-counts` (Trustee-only)
  to the routes that follow the `GET /v1/loan-book` rule. Note that it carries a per-chain
  `chains[]` breakdown.
- **`docs/frontend/trustee-flows.md`** (the "Count badge slot" bullet and the nav-sections
  note): a backend source now exists (`GET /v1/attention-counts`). Wiring is #1350. Origination and
  Loans read the union; Cash Management reads the session chain's `chains[]` entry.
- **`docs/exec-plans/tech-debt-tracker.md`:** update TD-36 and add the per-request recompute entry
  (step 5).
- **New `docs/user-stories/epic-775/1864-trustee-attention-counts.md`:** API-level stories.
  - A Trustee token gets the counts for all chains and for one chain.
  - A non-Trustee token gets 403, and no token gets 401.
  - On pipeline-test (Stellar 99000001 + Hoodi 560048), the counts match `GET /v1/loan-book`,
    `GET /v1/loan-book/submissions`, `GET /v1/cash-book?chain_id=99000001` and
    `GET /v1/ramp/events?chain_id=` read at the same time.
  - The Hoodi entry has `null` minter and margin-call fields.
