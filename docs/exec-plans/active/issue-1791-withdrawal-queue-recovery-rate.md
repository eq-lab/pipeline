# Issue #1791: Withdrawal queue: index the recovery rate; serve queue offsets, aggregates and rate-scaled USD

Source: https://github.com/eq-lab/pipeline/issues/1791

Parent epic: #1776, merge order step 4 ("additive fields, dark until their keys are set"), after
#1788, #1793 and #1794. Unblocks frontend #1759. Related backlog issue: #1801 (see "Overlap with
#1801" below). No Figma reference is attached to this Issue or to #1776, so there is no visual
verification step.

## Scope

### Findings from research

- **F1: contract (frozen, `pipeline-stellar-contracts` HEAD `d0d5757`).**
  `contracts/withdrawal-queue/src/` was last changed in `f284509`.
  - `RATE_ONE = 1_000_000` (`lib.rs:32`). The constructor stores `Rate = RATE_ONE`.
  - `set_rate(new_rate)` (`lib.rs:182-195`) is owner-only. It requires
    `0 < new_rate < RATE_ONE`, panics `AlreadyInShutdown` once the rate is not `RATE_ONE`, and
    emits `RateSet { new_rate: i128 }`. The event has no `#[topic]` field, so the topics are
    `["rate_set"]` and the data is `Map{new_rate}`. The rate is set **at most once per
    contract**.
  - `request_withdrawal` emits `WithdrawalRequested { #[topic] withdrawer, #[topic] request_id,
    amount, queued }`, where `queued` is `total_queued` after this request
    (`lib.rs:127-139`).
  - `claim_request` emits `RequestClaimed { request_id, user, amount }` from
    `request_queue::claim_request`. `amount` is the PLUSD amount. It then pays
    `convert_to_assets(amount) = amount * rate / RATE_ONE` (integer floor, `storage.rs:102-104`)
    and burns `amount` PLUSD. No event carries the USDC paid.
  - `claimable(id)` (`lib.rs:90-106`) compares `queued(id) <= total_claimed +
    custodian_usdc * RATE_ONE / rate`. The custodian balance is not indexed.
- **F2: the indexer** already stores `WithdrawalRequested` (with `queued`) and `RequestClaimed`
  for the configured WQ (`packages/worker/src/indexer/stellar/parsers.rs:109-170`). The dispatch
  branch is `parse_withdrawal_requested(raw).or_else(|| parse_request_claimed(raw))`
  (`:588-589`). `rate_set` falls through as `None` and no row is written. `contract_logs` is
  generic JSON, so a new event name needs **no migration**.
- **F3: `/v1/withdrawal-queue`** (`packages/api/src/routes/withdrawal_queue.rs`).
  - `in_queue_usd` sums the normalised PLUSD `amount` of unclaimed rows.
  - `LIST_WITHDRAWAL_QUEUE_ROWS_SQL` (`contract_logs_repo.rs:218-237`) is chain-scoped, not
    contract-scoped, and covers EVM too.
  - Both frontends always send `chain_id` (`packages/frontend/src/api/useWithdrawalQueue.ts:107`,
    `packages/trustee/src/api/useWithdrawalQueue.ts:47`).
- **F4: `/v1/requests`.** It is built by `KycRepo::get_all_requests` (`kyc_repo.rs:922-1006`)
  and mapped through `GroupedRequest::from_row`. Amounts there are **raw on-chain integers at
  token decimals** (7 on Stellar, 6 on EVM; `packages/frontend/src/api/useRequests.ts:48`). This
  query serves EVM and Stellar rows alike.
- **F5: config.** The API already reads `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` for Stellar
  voucher signing (`config.rs:447-516`). pipeline-test sets it to
  `CBVXURJRF3DG7MBBLQZ4NTJ7K5MT2LJW3HA4LDW3XUMSPC4PROSNXFYQ` (`argocd/pipeline/test.yaml:95`),
  the same id the worker indexes (`:186`).
  - **The key is optional.** `load_stellar_voucher_config` reads it only after
    `CHAIN_<id>_API_STELLAR_DM_CONTRACT_ID`. If either key is unset, it logs a `warn!` and
    disables Stellar voucher signing for that chain; boot does not fail.
  - A malformed value fails boot only when the DM key is also set, because the loader returns
    before parsing otherwise.
  - Only the derived `StellarVoucherDomain` is kept (`StellarVoucherChainConfig.domain_wq`). The
    Strkey string is not stored anywhere today.
- **F6: testnet state (read 2026-11-03 with `stellar contract invoke --send=no`, WQ `CBVX…XFYQ`).**
  - `rate() = 1000000`, `total_queued() = 31875000000`, `total_claimed() = 22500000000`
    (7-dp raw).
  - The pre-#36 WQ `CC3T…U3Q7` also has rows in `contract_logs` on chain 99000001, so
    chain-wide sums would not match the current contract.

### In scope

1. **Worker: parse `rate_set`.** Add `parse_rate_set` to
   `packages/worker/src/indexer/stellar/parsers.rs`.
   - It stores `WithdrawalRateSet` with `params = {"new_rate": "<i128 decimal string>"}`, the
     value stored as emitted.
   - Wire it into the WQ dispatch branch only. A `rate_set` from the WQ that does not decode logs
     a `warn!`, the same pattern as the minter and DTF branches.
2. **Audit log.** Add `WithdrawalRateSet` to `AUDIT_EVENT_NAMES` and a `format_action` arm.
   - The action is `"Withdrawal recovery rate set — <rate/1e6 to 6 dp>"`, e.g.
     `"Withdrawal recovery rate set — 0.850000"`.
   - `details` is `{"new_rate": "<raw>"}`. The scope is `Protocol`, since the event has no
     `loan_id`.
3. **Shared pure rate module** `packages/shared/src/withdrawal_rate.rs`, the single home for
   the rate maths:
   - `RATE_ONE`;
   - `LogPosition { block_number: i64, log_index: i64 }`, ordered;
   - `RateSetPoint { contract_address: String, position: LogPosition, new_rate: BigDecimal }`;
   - `convert_to_assets(amount, rate) -> BigDecimal`, which floors like the contract;
   - `rate_at_claim(claim: LogPosition, rate_set: Option<(LogPosition, &BigDecimal)>) ->
     BigDecimal`. It returns the `rate_set` rate when the rate_set is strictly before the claim,
     else `RATE_ONE`;
   - `current_rate(rate_sets: &[RateSetPoint], scope: Option<&str>) -> BigDecimal`. With a
     scope, it takes the latest rate_set of that contract. Without one, it takes the latest
     rate_set on the chain. With none, it returns `RATE_ONE`.
4. **API config: no new env key.** The rate and totals are scoped to the existing optional
   `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` (F5).
   - **Loader.** A new loader reads that key on Stellar chains **independently** of the voucher
     loader. Otherwise the scope would be lost whenever the DM key is unset.
   - **Values.** Unset or blank means absent. A valid `C…` is stored in canonical Strkey form
     (`format!("{}", stellar_strkey::Contract)`), the same form the indexer writes to
     `contract_logs.contract_address`.
   - **Malformed value.** It logs a `warn!` and is treated as unset. It does **not** fail boot,
     so a value that is ignored today (DM key unset) cannot start crashing the API. With the DM
     key set, the voucher loader still fails boot as it does today.
   - **Storage.** `ChainsConfig::withdrawal_queue_addresses` and
     `AppState::withdrawal_queue_addresses: HashMap<i64, String>`.
   - **Key unset.** `rate` falls back to the latest `WithdrawalRateSet` on the chain (or
     `RATE_ONE`), per the issue. `total_queued` / `total_claimed` are `null`.
5. **`/v1/requests`** (`kyc_repo.rs`, `routes/analytics.rs`). Two new optional fields on
   **Stellar `Withdraw` rows only**. They are omitted otherwise (`skip_serializing_if`, like the
   sibling `request_id` / `assets` / `shares`). Both are raw integers at token decimals, like
   `amount`:
   - `queued_through` is `params.queued`, the cumulative PLUSD queue offset including this
     request (on-chain `withdrawal_request_queued(id)`). It is not an ordinal.
     `queued_ahead = queued_through − amount`.
   - `usdc_paid` is present only once the request is claimed. It is
     `floor(amount × rate_at_claim / 1e6)`. The rate used is the one in force at the claim on
     the request's own WQ contract: a claim ordered before that contract's `WithdrawalRateSet` by
     `(block_number, log_index)` pays at `1e6`.
6. **`/v1/withdrawal-queue`.**
   - **`in_queue_usd`.** Each queued row is valued at its own WQ contract's current rate:
     `normalize(floor(raw_amount × rate / 1e6))` per row, then summed. At `1e6` this is the
     same expression as today, `normalize(raw_amount)`. EVM rows have no `WithdrawalRateSet`, so
     they stay 1:1.
   - **New `summary` fields.** `total_queued` and `total_claimed` are PLUSD, base-6 decimal
     strings. `rate` is the raw 6-dp integer string as `rate()` returns it, e.g. `"1000000"`.
     All three are `Option`s and serialize as `null`, like the existing `estimated_wait_days` /
     `liquid_cover`.
   - **When `rate` is served.** Only when the scope is exactly one configured **Stellar** chain.
     It is `current_rate(rate_sets, wq_address)`.
   - **When the totals are served.** Only when the scope is exactly one Stellar chain **and**
     `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` is set (resolved RQ1). They are computed over that
     contract:
     `total_queued = MAX(params.queued)` over `WithdrawalRequested`. `MAX` is exact even when
     older history was never indexed. `total_claimed = Σ RequestClaimed.amount`. Each total is
     normalised once from the raw sum, so it matches `total_queued() / 10` truncated.
   - The new fields are `null` for EVM scope, union scope and unconfigured scope.
   - `items[]` is unchanged, `amount` included.
7. **Docs and user stories** (see "Docs to Update").

### Out of scope

- Contract or deployment changes (contracts are frozen).
- **Payable now.** `claimable(id)` stays an on-chain read in the frontend, per the issue. It
  needs the custodian USDC balance, which is not indexed.
- The paused flag (`paused` / `unpaused` are not indexed), a pre-claim payout preview, and EVM
  parity (no EVM rate event is indexed). See #1801.
- Stellar `custodian_set`, `verifier_set`, `request_enqueued` and the ownership / upgrade events.
  They stay uncollected.
- Any change to existing field values or meanings: `amount` everywhere, `items[]`, `status`,
  `requests_count`, `estimated_wait_days`.
- **The TVL ledger.** `PLUSD_LEDGER_SQL` subtracts PLUSD **burned** at claim, which is correct
  under any rate.
- Renaming `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` (the deferred env-naming work).
- Frontend changes. `useRequests.ts` / `useWithdrawalQueue.ts` types are a follow-up for #1759.
- The AccessManager and SecurityRegistry NFT mint/burn. They are not indexed (human decision,
  2026-11-03), and nothing here touches them.

### Overlap with #1801

#1791 does **not** fully subsume #1801.

| #1801 asks for | Covered by #1791? |
|---|---|
| `queued_ahead` | Yes, Stellar only. `queued_through`, with `queued_ahead = queued_through − amount` |
| `total_queued` / `total_claimed` | Yes, Stellar only, with `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` set |
| `rate` | Yes, Stellar only |
| `claimable` | No. Kept on-chain by #1791's own scope decision |
| paused | No |
| payout for a claimable request before the claim | No. Only `usdc_paid` after the claim |
| EVM | No |

Decision (resolved RQ5): after #1791 merges, #1801 is narrowed to the remainder: claimable, the
paused flag, the payout preview and EVM. This is post-merge step 13.

## Assumptions and Risks

- **Rollout safety (pipeline-test auto-deploys; API and worker roll independently).**
  - **Migrations.** None. `WithdrawalRateSet` rows are ordinary `contract_logs` rows. No
    `TRUNCATE` and no cursor reset.
  - **Old images on the new data.** An older worker ignores `rate_set`, as today. An older API
    ignores `WithdrawalRateSet` rows: its audit allow-list excludes them, and its queries filter
    by event name.
  - **Rollback.** Rolling back the worker leaves the rows in place, and nothing older reads them.
  - **Env.** No new env key, in the API or the worker.
    - `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` is read a second time, for scoping. It stays
      optional and no new boot failure is added: a malformed value logs a warning and is treated
      as unset.
    - pipeline-test already sets the key to the live queue `CBVX…XFYQ`, so the totals and rate go
      live there on the first API deploy. That is additive.
    - The new fields are `null` or omitted where they do not apply.
  - **EVM.** `get_all_requests` and `LIST_WITHDRAWAL_QUEUE_ROWS_SQL` are chain-scoped shared
    queries. The new columns are additive, and the new response fields are gated on
    `ChainKind::Stellar`. EVM regression tests are listed under Test Strategy.
  - **Indexer RPC.** No new RPC read is added to the indexer, so `index_once`
    (`packages/worker/src/indexer/mod.rs:240-276`) gains no new failure path.
  - **API changes are additive.** Every existing field keeps its value at `rate = 1e6`, which is
    pinned by golden tests. `in_queue_usd` changes value only once a `rate_set` exists, which is
    exactly the intended fix. Its meaning ("USD value of the queue") is preserved.
- **R1: a `rate_set` emitted before this worker runs is lost.** Nothing re-fetches it. Once it is
  older than RPC retention (~7 days), the API would serve `1e6` for a contract in shutdown.
  - Testnet is `1e6` today (F6). Mainnet (#37) should be checked before deploy.
  - Mitigation: the comparison step below checks served `rate` against `rate()`. On a mismatch,
    rewind the Stellar cursor while the event is still within retention.
- **R2: `total_claimed` undercounts if RequestClaimed history was never indexed** (for example
  older than retention when the WQ was first indexed). `total_queued` uses `MAX(queued)` and is
  immune to this. The testnet comparison will reveal any undercount. If it shows up, document it
  in the spec rather than patch it with RPC.
- **R3: `usdc_paid` is derived, not observed.** No event carries the USDC paid. It equals the
  contract's `convert_to_assets` exactly, because the rate at claim is known: it is set once and
  ordered by `(block_number, log_index)`. `log_index` is synthesised as
  `tx_index*1000 + op*100 + event` (`stellar/parsers.rs:515`), so two txs in one ledger order
  correctly.
- **R4: per-row valuation uses each row's own contract rate** (resolved RQ2). With one live WQ
  per chain, this equals a single chain rate.
- **R5: merge conflicts with sibling epic branches.**
  - #1789 and #1790 likely touch the same files: `stellar/parsers.rs` `dispatch_parser`,
    `audit_log.rs` `AUDIT_EVENT_NAMES`, `config.rs` / `lib.rs` / `main.rs` and the AppState
    literals in the API tests.
  - #1794 edits `.env.example`. Its plan lists a commented
    `CHAIN_<id>_STELLAR_API_WITHDRAWAL_QUEUE_ADDRESS (#1791)` line, which **must be dropped**:
    #1791 adds no new key.
  - Rebase onto `main` before the PR. Resolve by keeping every side's additions.
- **R6: `docs/product-specs/dashboards.md` is 195 lines**, and the lint errors above 200. The
  detail goes into `withdrawals.md`. `dashboards.md` gets a net change of at most +3 lines.
- **Dependencies.** No hard blocker. Epic merge order puts #1791 after #1788, #1793 and #1794.
  #1791 only edits a comment on the existing key in `.env.example`.

### Resolved questions (human, 2026-11-03)

- **RQ1 + RQ3: scoping key.** No new env key is added.
  - The rate and totals are scoped to the existing `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID`. It is
    optional (F5) and set on pipeline-test to `CBVX…XFYQ`.
  - With the key set, `rate`, `total_queued` and `total_claimed` are served for a single
    Stellar-chain scope, and they match the on-chain views.
  - With the key unset, `rate` falls back to the latest `WithdrawalRateSet` on the chain (or
    `RATE_ONE`), and the totals are `null`.
  - #1794's plan must drop its commented `…_STELLAR_API_WITHDRAWAL_QUEUE_ADDRESS (#1791)` line.
- **RQ2: rate used for `in_queue_usd`.** Accepted: each queued row is valued at its **own** WQ
  contract's rate.
- **RQ4: EVM `queued_through`.** No. EVM gets no `queued_through`, because EVM is out of scope
  for the epic. Both new `/v1/requests` fields stay gated on `ChainKind::Stellar`.
- **RQ5: #1801.** After #1791 merges, #1801 is narrowed to what remains: claimable, the paused
  flag, the payout preview and EVM. This is post-merge step 13.

## Open Questions

_None_

## Implementation Steps

Comment-less code throughout. At most one 2–3-line spec-pointer header per new file. No
field/function doc comments on new items and no body comments. Do not add comments while
touching existing items.

1. **Golden captures first, before any code change.** Write two golden tests and run them to
   capture today's output as literal strings:
   - In `packages/api/tests/withdrawal_queue.rs`: one EVM chain and one Stellar chain, with
     queued and completed rows.
   - In a new `packages/shared/tests/kyc_requests_queue_fields.rs`: EVM `Withdraw` / `Deposit` /
     `Stake` rows and a Stellar `Deposit` row.

   Freeze the strings. They are the byte-identity regression for steps 6–8.
2. **Shared rate module.**
   - Create `packages/shared/src/withdrawal_rate.rs` with the items in Scope §3 and register
     `pub mod withdrawal_rate;` in `packages/shared/src/lib.rs`.
   - `convert_to_assets` is `(amount * rate / RATE_ONE).with_scale_round(0, RoundingMode::Down)`.
   - `current_rate` picks the max `LogPosition` among the matching points.
3. **Worker parser.** In `packages/worker/src/indexer/stellar/parsers.rs`:
   - Add `pub fn parse_rate_set(raw: &RawEvent) -> Option<StellarLog>`. It requires
     `raw.event_name == "rate_set"` and `topics_base64.len() >= 1`, and reads
     `extract_i128_from_map(&raw.value_base64, "new_rate")?`. It emits
     `event_name: "WithdrawalRateSet"` and `params: {"new_rate": new_rate.to_string()}`.
   - In `dispatch_parser`, change the WQ branch to try `parse_withdrawal_requested`, then
     `parse_request_claimed`, then `parse_rate_set`.
   - When the result is `None` and `raw.event_name == "rate_set"`, emit a `tracing::warn!` that
     names `contract_id`, `event_name` and `tx_hash`, the same shape as the DTF warn.
   - Update the doc table in `docs/references/backend.md` (step 10).
4. **Audit log.** In `packages/api/src/routes/audit_log.rs`:
   - Append `"WithdrawalRateSet"` to `AUDIT_EVENT_NAMES`.
   - Add a `format_action` arm. With `params.new_rate` parseable, the action is
     `format!("Withdrawal recovery rate set — {}", ratio)`, where `ratio` is
     `new_rate / 1e6` with scale 6 via `BigDecimal::with_scale_round(6, RoundingMode::Down)` and
     `to_plain_string`. Otherwise it is `"Withdrawal recovery rate set"`.
   - `details` is `pass(params, &["new_rate"])`.
   - Update the module-level allow-list sentence so it lists the WQ recovery-rate event.
5. **API config.** In `packages/api/src/config.rs`:
   - Add `pub withdrawal_queue_addresses: HashMap<i64, String>` to `ChainsConfig`.
   - Add `fn load_withdrawal_queue_scope(chain_id, kind, out)`, with no `Result`, because it never
     fails boot.
     - For `Stellar` it reads the existing `CHAIN_{id}_API_STELLAR_WQ_CONTRACT_ID`. Unset or blank
       adds no entry.
     - Otherwise it parses with `stellar_strkey::Contract::from_string`. On success it stores
       `format!("{c}")` and logs `tracing::info!`. On failure it logs `tracing::warn!` naming the
       key and adds no entry.
     - For `Evm` it is a no-op.
   - Leave `load_stellar_voucher_config` unchanged.
   - Call the new loader in `from_env` for every chain, next to `load_loan_registry_address`,
     independent of the voucher path. Add one line to the `ChainsConfig` doc block saying the WQ
     key also scopes `/v1/withdrawal-queue`.
   - Thread it through `packages/api/src/lib.rs` (the `AppState` field) and
     `packages/api/src/main.rs`.
   - Add `withdrawal_queue_addresses: HashMap::new()` to every literal `AppState { … }` in
     `packages/api/tests/`: `analytics_pnl_positions_chain.rs`, `auth_chain_required.rs`,
     `chains.rs`, `dashboard_auditlog_chain.rs`, `loan_chain_required.rs`,
     `loan_registry_scope.rs`, `lp_payment_details_head.rs`, `lp_settlement_address.rs`,
     `ramp_kyc_chain.rs`, `stats_prices_vaults_yield_chain.rs`, `voucher_signing.rs` and
     `vouchers_chain_required.rs`. Re-grep `AppState {` after rebasing.
6. **Repo: `/v1/withdrawal-queue` data** (`packages/shared/src/contract_logs_repo.rs`).
   - **`LIST_WITHDRAWAL_QUEUE_ROWS_SQL`.** Add a second
     `LEFT JOIN LATERAL (SELECT (s.params->>'new_rate')::numeric AS rate FROM contract_logs s
     WHERE s.chain_id = r.chain_id AND s.contract_address = r.contract_address AND s.event_name =
     'WithdrawalRateSet' AND s.block_timestamp <= $2 ORDER BY s.block_number DESC, s.log_index
     DESC LIMIT 1) rs ON TRUE`, and select `rs.rate`. Keep every existing column and predicate.
   - **`WithdrawalQueueRow`.** Add `pub rate: Option<BigDecimal>` and
     `#[sqlx(default)] pub value: BigDecimal`.
   - **`list_withdrawal_queue_rows`.** Compute `r.value = normalize_usdc_amount(kind,
     &convert_to_assets(&r.amount, r.rate.as_ref().unwrap_or(&RATE_ONE)))` from the raw amount,
     **then** normalise `r.amount` as today.
   - **`list_withdrawal_rate_sets(executor, chain_id, to_unix) -> Vec<RateSetPoint>`.** Selects
     `contract_address, block_number, log_index::bigint, (params->>'new_rate')::numeric` for
     `event_name = 'WithdrawalRateSet' AND params ? 'new_rate'`, ordered by
     `(block_number, log_index)`.
   - **`get_withdrawal_queue_totals(executor, chain_id, to_unix, contract_address) ->
     (BigDecimal, BigDecimal)`.** One SQL statement with two scalar subqueries:
     `COALESCE(MAX((params->>'queued')::numeric), 0)` over `WithdrawalRequested` and
     `COALESCE(SUM((params->>'amount')::numeric), 0)` over `RequestClaimed`. Both filter on
     `chain_id = $1`, `contract_address = $3` and `block_timestamp <= $2`. It returns raw values.
     The caller normalises each once with `normalize_usdc_amount(Stellar, …)`.
7. **Route: `/v1/withdrawal-queue`** (`packages/api/src/routes/withdrawal_queue.rs`).
   - **`WithdrawalQueueSummary`.** Add `total_queued: Option<String>`,
     `total_claimed: Option<String>` and `rate: Option<String>`, with utoipa descriptions on the
     DTO fields, since the existing DTOs carry them.
   - Add `pub struct QueueState { pub total_queued: Option<BigDecimal>, pub total_claimed:
     Option<BigDecimal>, pub rate: BigDecimal }`.
   - Change `compute_withdrawal_queue` to `compute_withdrawal_queue(rows, state:
     Option<&QueueState>)`:
     - `in_queue_usd` sums `row.value` instead of `row.amount`;
     - with `Some(state)`, the totals go through `base6_to_decimal_string` and the rate through
       `to_plain_string()`;
     - with `None`, all three are `null`.
   - Add `pub fn queue_state_chain(scope: &[ConfiguredChain]) -> Option<ConfiguredChain>`. It
     returns `Some` iff `scope.len() == 1 && scope[0].kind == ChainKind::Stellar`.
   - **Handler.** When `queue_state_chain` returns a chain, it loads the rate sets and calls
     `current_rate(&points, wq)`, with `wq` from `state.withdrawal_queue_addresses`. With `wq`
     set it also loads the totals; otherwise the totals are `None`. Then it calls `compute`.
   - Update the module header and the `in_queue_usd` DTO description: "Σ of each queued
     request's USD value at its queue's recovery rate".
8. **Repo + route: `/v1/requests`** (`packages/shared/src/kyc_repo.rs`,
   `packages/api/src/routes/analytics.rs`).
   - **SQL `base` select list.** Add `(r.params->>'queued')::numeric AS queued`,
     `claim.block_number AS claim_block_number`, `claim.log_index AS claim_log_index`,
     `rs.block_number AS rate_set_block_number`, `rs.log_index AS rate_set_log_index` and
     `rs.new_rate AS rate_set_rate`.
   - **Claim lateral.** Add, after the `lp_profiles` join:
     `LEFT JOIN LATERAL (SELECT c3.block_number, c3.log_index::bigint AS log_index FROM
     contract_logs c3 WHERE r.event_name = 'WithdrawalRequested' AND c3.chain_id = r.chain_id AND
     c3.contract_address = r.contract_address AND c3.event_name = 'RequestClaimed' AND
     c3.params->>'request_id' = r.params->>'request_id' ORDER BY c3.block_number, c3.log_index
     LIMIT 1) claim ON TRUE`.
   - **Rate-set lateral.** The same shape over `WithdrawalRateSet` for `r.contract_address`,
     ordered ascending, `LIMIT 1`, selecting `(params->>'new_rate')::numeric AS new_rate`. The
     earliest row is the only one (F1).
   - Keep `is_claimed`, the `pending_only` clause and the `ORDER BY` untouched.
   - **`RequestEventRow`.** Add `queued: Option<BigDecimal>`, `claim_block_number: Option<i64>`,
     `claim_log_index: Option<i64>`, `rate_set_block_number: Option<i64>`,
     `rate_set_log_index: Option<i64>` and `rate_set_rate: Option<BigDecimal>`.
   - **`GroupedRequest`.** Add
     `#[serde(skip_serializing_if = "Option::is_none")] queued_through: Option<String>` and
     `usdc_paid: Option<String>`.
   - **`from_row`.** Make it `pub` and change it to `from_row(row, kyt_gate_enabled, kind:
     Option<ChainKind>)`. Both fields are set only when
     `kind == Some(ChainKind::Stellar) && event_name == "WithdrawalRequested"`:
     - `queued_through = row.queued.map(to_string)`;
     - `usdc_paid` is `Some(convert_to_assets(amount, rate_at_claim(claim_pos, rate_set)))` only
       when `claim_block_number` / `claim_log_index` are present and `amount` is `Some`.
   - **`get_all_requests`.** Add the parameter `chain_kind: impl Fn(i64) -> Option<ChainKind>`.
   - **`analytics.rs`.** Pass `|id| state.chains.iter().find(|c| c.chain_id == id).map(|c|
     c.kind)`. Add `queued_through` / `usdc_paid` to `RequestItem` with the same serde attribute
     and utoipa descriptions, and map them.
9. **`.env.example`.** No new key. Extend the trailing comment on the existing
   `# CHAIN_99000001_API_STELLAR_WQ_CONTRACT_ID=…` line with "also scopes the
   /v1/withdrawal-queue rate and totals". Coordinate the line with #1794, which syncs the contract
   ids in the same block. Run `scripts/check-chain-env-names.sh`.
10. **Docs** (see "Docs to Update").
11. **Verify.**
    - `cargo fmt --all`.
    - `cargo clippy --all -- -D warnings`.
    - `cargo test -p shared -p pipeline-api -p pipeline-worker`.
    - `npx tsx scripts/lint-docs.ts`. It runs in this worktree via the npx cache; if it fails for
      missing deps, report that it could not run.
    - `scripts/check-chain-env-names.sh`.
12. **Testnet comparison (acceptance; after merge to `main` deploys to pipeline-test).** The API
    already has `CHAIN_99000001_API_STELLAR_WQ_CONTRACT_ID=CBVXURJRF3DG7MBBLQZ4NTJ7K5MT2LJW3HA4LDW3XUMSPC4PROSNXFYQ`,
    so no manifest change is needed.
    - Read the on-chain values:
      `stellar contract invoke --id CBVX…XFYQ --source-account <any G…> --network testnet
      --send=no -- {rate,total_queued,total_claimed}`.
    - Compare them with
      `curl -s 'https://api.pipeline.stage.eqlab.net/v1/withdrawal-queue?chain_id=99000001' | jq
      .summary`:
      - `rate` equals `rate()`;
      - `total_queued` equals `total_queued()/10` to 6 dp;
      - `total_claimed` equals `total_claimed()/10` to 6 dp.
      The 2026-11-03 baseline is `"1000000"`, `"3187.500000"` and `"2250.000000"` if nothing
      moves.
    - For one Stellar request in `GET /v1/requests?wallet=<G…>&chain_id=99000001`,
      `queued_through` equals `withdrawal_request_queued(<id>)`.
    - Check that `chain_id=560048` responses keep their pre-deploy existing-field values.
    - Record the results in the PR and in the user-stories doc status.
13. **Post-merge (manager / human).**
    - Narrow #1801 to what remains: claimable, the paused flag, the payout preview and EVM.
    - Make sure #1794's plan drops its commented `…_STELLAR_API_WITHDRAWAL_QUEUE_ADDRESS (#1791)`
      line.

## Test Strategy

All tests are pure unit tests in `packages/<pkg>/tests/<topic>.rs`. There are no inline
`#[cfg(test)]` modules, no `DATABASE_URL` / `POSTGRES_URL` or any env-driven DB, and no RPC.
Tests carry no comments.

- **`packages/shared/tests/withdrawal_rate.rs` (new).**
  - `convert_to_assets`:
    - at `RATE_ONE`, the identity for 0, 1, 7-dp and very large `i128`-range values;
    - at `850_000` and `1`, the floor (e.g. `7 × 850_000 / 1e6 = 5`, `10 × 1 / 1e6 = 0`).
  - `rate_at_claim`:
    - no rate_set gives `RATE_ONE`;
    - a rate_set before the claim (lower block, or the same block with a lower `log_index`)
      gives the rate;
    - a rate_set after the claim (a higher block, or the same block with a higher
      `log_index`) gives `RATE_ONE`.
  - `current_rate`:
    - empty input gives `RATE_ONE`;
    - with a scope, it picks that contract and ignores another contract's later rate;
    - without a scope, it picks the latest on the chain;
    - a scoped contract with no rate_set gives `RATE_ONE`.
- **`packages/shared/tests/kyc_requests_queue_fields.rs` (new).** Covers `GroupedRequest::from_row`.
  - A Stellar `WithdrawalRequested`:
    - unclaimed has `queued_through` and no `usdc_paid`;
    - claimed with no rate_set has `usdc_paid == amount`;
    - claimed after the rate_set (`rate = 850_000`) has `usdc_paid` floored;
    - claimed before the rate_set pays at 1e6.
  - A Stellar `DepositRequested` and Stake/Unstake rows get no new fields.
  - **EVM regression.** An EVM `WithdrawalRequested` with `queued` and a claim position gets no
    new fields, and its `serde_json::to_string` equals the step-1 golden string byte for byte.
    `kind = None` (an unconfigured chain) gets no new fields.
  - Existing `status` / `amount` stay unchanged for every row.
- **`packages/api/tests/withdrawal_queue.rs` (extend).**
  - Update the row helpers with `rate: None, value: amount`. Existing calls pass `None` for the
    state, and every existing assertion must stay green unchanged.
  - **Golden.** The existing-field projection of the response for the mixed EVM and Stellar
    fixture equals the step-1 capture, with the three new keys removed from `summary` before
    comparing.
  - **Rate-scaled.**
    - A Stellar queued row with `value` at `rate < 1e6` makes `in_queue_usd` the sum of the
      values, and `items[].amount` stays raw-normalised;
    - mixed EVM and Stellar rows: EVM contributes 1:1.
  - **Aggregates.** `Some(QueueState)` serializes the totals as base-6 strings and `rate` as
    `"850000"`. `None` gives three `null`s.
  - **`queue_state_chain`.**
    - one Stellar chain gives `Some`;
    - one EVM chain gives `None`;
    - two chains (the union) give `None`;
    - an empty scope gives `None`.
- **`packages/api/tests/chains_config.rs` (extend, under `ENV_LOCK`).** Covers
  `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` as the scope:
  - unset gives no entry, and boot is OK;
  - a valid `C…` is stored in canonical form;
  - blank gives no entry;
  - malformed with the DM key unset: boot succeeds and there is no entry (no new boot failure);
  - set with the DM key unset: the scope entry is present while Stellar voucher signing stays
    disabled, as today.
  - EVM regression: an EVM chain has no entry, and the existing voucher behaviour is unchanged.
- **`packages/worker/tests/stellar_parsers.rs` (extend).**
  - `rate_set` decodes from the fixture (`encode_map_i128(&[("new_rate", 850_000)])`), giving
    `WithdrawalRateSet` with `{"new_rate": "850000"}`.
  - A wrong event name gives `None`.
  - A missing `new_rate` key gives `None`.
  - Dispatch from the WQ succeeds.
  - Dispatch of `rate_set` from the DM / sPLUSD contract gives `None`.
  - Existing WQ dispatch tests stay green, so the `withdrawal_requested` / `request_claimed`
    order is unchanged.
- **`packages/api/tests/dashboard_auditlog_chain.rs` (extend).**
  - `AUDIT_EVENT_NAMES` contains `WithdrawalRateSet`.
  - `act("WithdrawalRateSet", {"new_rate":"850000"}, Stellar)` gives
    `"Withdrawal recovery rate set — 0.850000"`, with `details.new_rate == "850000"`.
  - With the param missing, it gives the bare label.
- **Edge cases covered.**
  - Floor rounding.
  - A claim and a rate_set in the same ledger, ordered by `log_index`.
  - Multiple WQ contracts on one chain.
  - No `WithdrawalRateSet` at all, so the output is byte-identical.
  - EVM rows and EVM scope.
  - The union scope.
  - Totals with `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` unset.
- **Manual acceptance:** the testnet comparison in step 12.

## Docs to Update

- **`docs/product-specs/withdrawals.md`.** Add a section "Stellar queue read model (#1791)",
  about 15 lines:
  - the `WithdrawalRateSet` source, the once-only rate and `RATE_ONE`;
  - `/v1/requests` `queued_through` / `usdc_paid` (raw units, Stellar only, rate in force at the
    claim, floor);
  - `/v1/withdrawal-queue` `in_queue_usd` valuation and `total_queued` / `total_claimed` /
    `rate` (when served, units);
  - that the existing optional `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` also scopes the rate and
    totals, and what happens when it is unset;
  - that "payable now" stays a frontend `claimable(id)` read.
- **`docs/product-specs/dashboards.md` Panel C.** Change at most +3 lines, because the file is at
  195 of the 200-line limit:
  - "`in_queue_usd` sums each queued request's USD value at its queue's recovery rate (1:1 on
    EVM)";
  - the new `summary` fields;
  - the cumulative-`queued` remark now notes it is served as the totals.
  - Link to `withdrawals.md` for the rest.
- **`docs/product-specs/audit-logging.md`.** Add `WithdrawalRateSet` ("Withdrawal recovery rate
  set — <ratio>", Protocol scope) to the on-chain event list.
- **`docs/references/backend.md`.** In the Stellar events part, add a short WithdrawalQueue table:
  - `withdrawal_requested` → `WithdrawalRequested`;
  - `request_claimed` → `RequestClaimed`;
  - `rate_set` → `WithdrawalRateSet` (`new_rate`, raw 6-dp);
  - the other WQ events are not collected.
- **`docs/frontend/trustee-flows.md`** (lines ~187/197). One-phrase update so that `in_queue_usd`
  reads as rate-valued.
- **`.env.example`.** Extend the comment on the existing `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID`
  line (step 9).
- **New `docs/user-stories/epic-1776/1791-withdrawal-queue-recovery-rate.md`.** Same shape as
  `1788-…`. Stories:
  - (1) a testnet `rate_set` is indexed and audit-logged (only if a disposable WQ is available;
    otherwise mark it N/A, since testnet's live WQ must not enter shutdown without a human
    decision);
  - (2) served totals and rate match the on-chain views;
  - (3) `queued_through` matches `withdrawal_request_queued(id)`;
  - (4) EVM 560048 responses are unchanged;
  - (5) with `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` unset (a local stack), the totals are
    `null` and the rate falls back to the latest `rate_set` on the chain.
- **No new tech-debt entry**, unless R2 shows up in the testnet comparison. In that case, log it
  in `docs/exec-plans/tech-debt-tracker.md`.
