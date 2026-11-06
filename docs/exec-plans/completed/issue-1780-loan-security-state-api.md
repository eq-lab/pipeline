# Issue #1780: API: loan security state — terms, collateral value, debt, LTV, margin call, records

Source: https://github.com/eq-lab/pipeline/issues/1780

Parent epic: #1775, merge-order step 3. Depends on #1779 (merged, `193ba5ee`). Unblocks frontend #1767
(read card) and #1856–#1859 (write flows). Absorbs the read side of #1782 (closed as superseded on
2026-11-06: on-chain inspections are served here). Contract source of truth:
`pipeline-stellar-contracts@e9881ac`, `contracts/security-registry/src/lib.rs` (line numbers below are at
that commit).

## Scope

One read endpoint, `GET /v1/loan-book/{loan_id}/security?chain_id=<id>`, assembled from the #1779
projection tables. Everything a consumer needs per loan is inline: terms, the `coverage_detail` valuation,
margin-call state, price staleness, pause state, the inspector panel, extension consents, and every record
with its docs, mark, lot, inspections, flag and linked minter repayments. No other route is added.

### What is read and what is computed

The API has no RPC client. It reads the projection, folded by the worker every 30 s, and the valuation
snapshot `security_loan_valuations`, which the worker reads from `coverage_detail(loan_id)` plus
`loan_money(loan_id)`. The snapshot is the acceptance oracle. **The API never recomputes the loan's value,
LTV or coverage.**

| Field | Source |
|---|---|
| `terms.*` | read: `security_terms` (folded from `SecurityTermsSet` or the `terms` view) |
| `valuation.value / stale_value / flagged_value / debt / ltv_bps / coverage_bps / price_stale` | read verbatim: `security_loan_valuations` (`coverage_detail` at `detail_ledger`) |
| `valuation.outstanding / accrued_interest` | read verbatim: `security_loan_valuations` (`loan_money` at `money_ledger`, a separate simulate; it can differ from `debt` by a ledger of interest, TD-171) |
| `records[].valuation.{counted_quantity, value_per_unit, mark_at, stale, flagged}` | read verbatim: the `counted_records` JSONB of the same snapshot |
| `records[].valuation.value` | computed from that entry: goods `floor(counted_quantity × value_per_unit / 1e7)`, other `counted_quantity`. The contract divides once over the sum (`lib.rs:897-916`), so the per-record values may sum to a few raw units more than `value`. This is documented. |
| `margin_call.open / opened_at` | read: `security_terms.margin_call_at` (event-folded, so fresher than the snapshot) |
| `margin_call.cure_by` | read: `cure_by` of the `open` row in `security_margin_call_events` whose `block_timestamp == margin_call_at`. It is fixed at opening (`lib.rs:994-1006`). Fallback when that event is not indexed (view-seeded loan): the snapshot's `cure_by`, when its `margin_call_at` matches. The snapshot recomputes `cure_by` as `margin_call_at + current cure_period` (`lib.rs:785-789`), so it drifts after `set_terms`. `cure_by_source` says which: `event`, `coverage_detail` or `null`. |
| `margin_call.events[]`, `last_margin_call_ltv_bps`, `last_price_stale` | read: `security_margin_call_events` |
| `margin_call.cure_overdue` | computed: `open && now > cure_by`, false on a `Closed` loan. Nothing on-chain enforces `cure_by`; a call cures whenever LTV ≤ advance ratio. |
| `margin_call.ltv_above_ratio_no_onchain_call` | computed: no on-chain call open (`margin_call_at = 0`), a valuation exists, `valuation.ltv_bps > margin_call_ratio_bps`, and the loan is not `Closed` |
| `margin_call.open_call_curable` | computed: a call is open, a valuation exists and `valuation.ltv_bps <= advance_ratio_bps`. A `check_coverage` would cure it (`lib.rs:986-990`); for example, a call left open on a loan that was then repaid and closed. |
| `prices.mark_age`, `prices.price_stale`, `records[].mark_stale` | computed at `now` from the projection, mirroring `mark_age` (`lib.rs:807-827`) and `record_term` (`lib.rs:868-888`) |
| `records[].counts_toward_value` | computed: `status == Active && protection != InsuranceLossPayee` (`types.rs` `counts`, `lib.rs:837-847`) |
| `records[].attestation_stale` / `inspection_stale` | computed at `now` for `Active` records only, mirroring `is_stale` (`lib.rs:918-942`); `null` otherwise |
| `records[].agent_release` | computed from the snapshot: whether the Security Agent's own `release` passes `ensure_releasable` (`lib.rs:1199-1216`), else the Risk Council's `release_with_consent` is needed. It mirrors the contract's `valuation(exclude)` and `ltv_bps`. #1856 needs it, and the frontend must not compute LTV. |
| `paused`, `inspectors` | read: `security_registry_state` |
| `records[].repayments[]` | read: minter `CashRepaid` rows with `loan_id` and `sale_id == record_id`, with `CashRepaymentReversed` (minter `lib.rs:294-353`) |
| `refresh_pending` | computed: the loan has SecurityRegistry log rows newer than `projected_log_id`, or SecurityRegistry or loan-registry log rows newer than the valuation's `source_log_id` |

Pure contract mirrors (`ltv_bps`, `coverage_bps`, `counted_value_excluding`, the staleness helpers) live in
`shared::security_state` so that #1784 (alerts, worker) and #1785 (readiness, projected LTV) reuse them.
Unit tests pin the issue's LTV / coverage rounding and the sentinel cases against these mirrors, and
`agent_release` uses them.

### Response contract (`200`)

Encoding: ids, `u64` times and `u64` durations are decimal strings (`mark_age` can be `u64::MAX`, which
does not fit a JS number). `u32` bps, `i32` variances and `default_rate` are JSON numbers. `ltv_bps` /
`coverage_bps` keep `4294967295` as the `u32::MAX` sentinel. `i128` / `u128` amounts and quantities are
exact 7-dp decimal strings (`raw / 1e7`, e.g. `"1250.0000000"`). Hashes are lowercase hex and addresses are
Strkeys, as stored.

```json
{ "chain_id": 99000001, "loan_id": "7", "security_registry": "C...", "now": "1762400000",
  "loan_status": "Performing", "paused": false, "inspectors": ["G..."], "refresh_pending": false,
  "terms": { "advance_ratio_bps": 8000, "margin_call_ratio_bps": 8500, "cure_period": "604800",
    "price_stale_after": "86400", "payment_term": "Lc", "grace_period": "0", "default_rate": 0,
    "attestation_interval": "0", "inspection_interval": "0", "tolerance_bps": 200,
    "grade_tolerance_bps": 100, "set_ledger": 123, "complete": true },
  "valuation": { "value": "0.0000000", "stale_value": "...", "flagged_value": "...", "debt": "...",
    "outstanding": "...", "accrued_interest": "...", "ltv_bps": 0, "coverage_bps": 4294967295,
    "price_stale": false, "as_of": { "detail_ledger": 1, "money_ledger": 1, "fetched_at": "ISO" } },
  "margin_call": { "open": false, "opened_at": null, "cure_by": null, "cure_by_source": null,
    "cure_overdue": false, "last_margin_call_ltv_bps": null, "last_price_stale": null,
    "ltv_above_ratio_no_onchain_call": false, "open_call_curable": false,
    "events": [{ "kind": "open|price_stale|cured", "ltv_bps": 9000, "margin_call_ratio_bps": 8500,
                 "cure_by": "...", "at": "...", "block_number": 1, "tx_hash": "..." }] },
  "prices": { "mark_age": "0", "price_stale": false },
  "extension_consents": [{ "position": 0, "consent_hash": "hex", "new_maturity": "...", "ledger": 1, "at": "..." }],
  "records": [{ "record_id": "1", "lot_id": "1", "protection": "WarehousePledge", "commodity": "...",
    "unit": "Mt", "reference_quantity": "...", "reference_grade": "...", "region": "...",
    "site_hash": "hex", "control_kind": "Agent", "control_reference": "...", "perfection": "...",
    "release_condition": "hex", "status": "Active", "open": true, "perfected_at": "...",
    "attested_by": "G...", "attested_at": "...", "flagged_by": null,
    "registered_ledger": 1, "closed_ledger": null, "release_reason_hash": null, "released_by_consent": null,
    "complete": true, "needs_view": false,
    "docs": [{ "position": 0, "kind": "WarehouseReceipt", "sha256": "hex", "source": "register", "ledger": null }],
    "mark": { "value_per_unit": "...", "at": "...", "benchmark": "LME", "report_hash": "hex" },
    "lot": { "latest_inspection_id": "2", "latest_inspected_at": "...", "latest_quantity": "...", "complete": true },
    "counts_toward_value": true, "attestation_stale": false, "inspection_stale": false, "mark_stale": false,
    "valuation": { "counted_quantity": "...", "value_per_unit": "...", "mark_at": "...", "value": "...",
                   "stale": false, "flagged": false },
    "agent_release": "allowed|needs_consent",
    "inspections": [{ "inspection_id": "2", "inspector": "G...", "kind": "StockCount", "inspected_at": "...",
      "region": "...", "site_hash": "hex", "quantity": "...", "grade": "...", "certificate_hash": "hex",
      "certificate_no": "...", "entered_by": "G...", "entered_at": "...", "approved_by": null,
      "approved_at": null, "variance_reference_bps": null, "variance_previous_bps": null,
      "variance_grade_bps": null, "flagged": null, "resolution": null, "resolution_reason_hash": null,
      "resolved_at": null, "is_lot_latest": false, "complete": true, "needs_view": false }],
    "repayments": [{ "repayment_id": "3", "cash": "...", "interest_minted": "...", "fee_shares": "...",
      "value_date": "...", "ref_hash": "hex", "tx_hash": "...", "at": "...", "reversed_at": null }] }] }
```

- **Nulls.** `terms: null` means no terms. Then `valuation`, `margin_call` and `prices` are `null`, and
  `records` is `[]` in practice, since `register` needs terms. `valuation: null` means no snapshot yet;
  the loan's margin-call flags are then `false`, and the record `valuation` and `agent_release` fields are
  `null`. `loan_status: null` means the loan is not indexed in the loan registry. An unknown loan id still
  returns `200` with `terms: null` and `records: []`, as the issue says.
- **Records.** Records are ordered by `record_id`, open and closed. `open` is `status ∉ {Released,
  Enforced}`. `docs` are ordered by `position` and `inspections` by `inspection_id`. `flagged_by` is `null`
  when there is no flag (0). `is_lot_latest` is `inspection_id == lot.latest_inspection_id`. `repayments`
  is `[]` for a record with no sale. The issue asks for repayments on `Enforced` records; the join keys on
  `sale_id`, so it is served for any status.
- **Closed loans.** `close_loan` does not check open records (`loan-registry/src/lib.rs:564-614`). Records
  are served unchanged, open ones included, so the Security Agent can release them; with outstanding 0,
  `agent_release` is `allowed`. The loan carries no LTV or margin-call alarm: `valuation` is the contract's
  own (debt 0, so `ltv_bps` 0 and `coverage_bps` `u32::MAX`), `cure_overdue` and
  `ltv_above_ratio_no_onchain_call` are `false`, and a call still open on-chain is shown with
  `open_call_curable: true`.
- **Errors.** `400`: missing, malformed or unknown `chain_id` (`RequiredChain`), or a malformed `loan_id`.
  `404 {"error":"security_registry_not_configured"}`: the chain has no API SecurityRegistry key. That
  includes every EVM chain, so EVM behaviour is unchanged. `500`: a database error.

### Configuration

New optional API key `CHAIN_<id>_STELLAR_API_SECURITY_REGISTRY_ADDRESS`. It is read for Stellar chains
only. When unset or blank, no entry is made and the endpoint returns 404. An invalid Strkey fails boot,
like `…_STELLAR_API_POCKET_ADDRESS`. It must equal the worker's `…_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS`,
because the projection is keyed by `contract_address`.

### Out of scope

- Mark suggestions and `mark_due` (#1783), readiness (#1785), alerts (#1784), audit log (#1781) and CCR
  retirement (#1786). The response is shaped so that those issues only add fields.
- AccessManager roles and `can_call` (not indexed, by decision). The frontend gates actions with
  `can_call`.
- Record NFT holder (mint / burn are not indexed, by decision).
- Mapping operator wallets (`entered_by` / `approved_by` / `attested_by`) to accounts. Off-chain storage of
  certificate files.
- EVM SecurityRegistry (#1707, parked).
- Contract changes (frozen).
- Any migration. This issue is read-only over the #1779 tables.

## Assumptions and Risks

- **Projection lag.** The fold runs every 30 s and the valuation refreshes when a log row is newer or the
  last read is older than 5 min with debt > 0. After a write, the UI sees the new state within about one or
  two cycles. `refresh_pending` lets #1856–#1859 poll instead of guessing.
- **Snapshot vs now.** `valuation.*` is as of `detail_ledger`. The computed staleness flags use the API
  clock (`now`, which is in the response). The contract uses the ledger timestamp, so a flag can flip a few
  seconds apart from the contract's at the boundary. Both are labelled; parity tests compare
  `valuation.*` with `coverage_detail` at `detail_ledger` only.
- **Torn reads.** The worker rewrites a loan's rows in one transaction. The API reads every table in one
  `REPEATABLE READ, READ ONLY` transaction, so it never mixes two projection versions.
- **View-seeded loans.** Rows with `complete = false` have partial history (no opening `cure_by`, `view` doc
  provenance, missing `flagged`). These flags and `cure_by_source` are passed through instead of guessed.
- **`agent_release` is advisory.** It is as of the snapshot. The frontend still simulates
  `release` first (#1856 acceptance), so a stale hint only changes which button is offered.
- **AppState literal churn.** Adding `security_registry_addresses` touches about 14 test files that build
  `AppState`. #1781, planned in parallel, edits `packages/api/tests/dashboard_auditlog_chain.rs`; expect a
  trivial merge conflict on that literal.
- **Rollout.** There is no migration and the key is optional; unset ships dark, and pipeline-test returns
  404 until the key is set in eq-lab/argocd (API env, after the worker key). The previous image ignores the
  key. The API response is new, so nothing existing changes.

## Open Questions

_None_

### Resolved questions (human, 2026-11-06)

1. **Amount encoding:** exact 7-dp decimal strings, as planned.
2. **Auth:** public, like the sibling `/v1/loan-book/{loan_id}/…` reads; every field is on-chain data.
3. **Acceptance wording:** confirmed — the rounding tests pin the `shared::security_state` mirrors; the served
   `ltv_bps` / `coverage_bps` are read from the `coverage_detail` snapshot.
4. **Additions beyond the issue text:** keep all of them (`agent_release`, `open_call_curable`,
   `refresh_pending`, `inspection_stale`, `cure_by_source`, `margin_call.events[]`, `inspectors`,
   `security_registry`); they serve #1856–#1859 and #1784. Minimal endpoint surface is about routes, not
   fields.

## Implementation Steps

1. [x] **Pure contract mirrors.** Add `packages/shared/src/security_state.rs` and register it in
   `packages/shared/src/lib.rs`. Header: `// spec: docs/product-specs/loan-security-state.md#computed-fields`.
   No other comments.
   - `pub const UNIT: i128 = 10_000_000; pub const BPS_ONE: u128 = 10_000; pub const U32_MAX_BPS: u32 = u32::MAX;`
   - `pub fn ltv_bps(debt: u128, value: i128) -> u32` mirrors `lib.rs:954-965`: 0 without debt;
     `u32::MAX` when value ≤ 0 or on overflow; otherwise `div_ceil`.
   - `pub fn coverage_bps(debt: u128, value: i128) -> u32` mirrors `lib.rs:944-951`, plus the
     `debt == 0 → u32::MAX` case from `coverage` / `coverage_detail` (`lib.rs:738-745`, `781-785`).
   - `pub fn counts_toward_value(status: &str, protection: &str) -> bool`;
     `pub fn is_in_storage(protection: &str) -> bool` (`WarehousePledge | CollateralManagement`).
   - `pub fn attestation_stale(now: u64, attested_at: u64, interval: u64) -> bool`, which is
     `interval != 0 && now.saturating_sub(attested_at) > interval`.
   - `pub fn inspection_stale(now, protection, perfected_at, lot_latest_inspected_at: Option<u64>, interval) -> bool`.
   - `pub fn mark_stale(now, is_goods, mark_at: Option<u64>, price_stale_after) -> bool`, following
     `record_term`: a goods record with no mark is stale.
   - `pub fn mark_age(now, counted_goods_mark_ats: &[Option<u64>]) -> u64`: `u64::MAX` when any is
     `None`, `0` when empty, otherwise `now - min`.
   - `pub fn price_stale(mark_age: u64, price_stale_after: u64, any_unmarked: bool) -> bool`.
   - `pub struct CountedTerm { record_id: u32, goods: bool, counted_quantity: i128, value_per_unit: i128 }`
     and `pub fn counted_value_excluding(terms: &[CountedTerm], exclude: u32) -> Option<i128>`. It sums
     goods `qty × vpu` and other `qty × UNIT`, then divides by `UNIT` once; `checked_*` gives `None` on
     overflow, where the contract panics with `Overflow`.
   - `pub fn record_term_value(t: &CountedTerm) -> Option<i128>` for the per-record display value.
   - `pub enum AgentRelease { Allowed, NeedsConsent }` and
     `pub fn agent_release(status, protection, outstanding: u128, accrued: u128, terms: &[CountedTerm], record_id, advance_ratio_bps) -> AgentRelease`.
     It mirrors `ensure_releasable`: `PendingPerfection` or `InsuranceLossPayee` → allowed; outstanding 0 →
     allowed; otherwise `ltv_bps(outstanding + accrued, counted_value_excluding(..)) <= advance_ratio_bps`.
   - `pub fn cure_by(margin_call_at, open_events: &[(block_timestamp, cure_by)], snapshot: Option<(margin_call_at, cure_by)>) -> (Option<u64>, Option<&'static str>)`.
   - `pub fn format_7dp(raw: &BigDecimal) -> String`. It is exact (`raw / 1e7`, scale 7, plain string,
     never exponent). Place it here or in `packages/api/src/formatting.rs`; it must be pure.
2. [x] **Read SQL and repo.** Add the reads to `packages/shared/src/security_registry_repo.rs` as `pub const`.
   Every query binds `chain_id = $1 AND contract_address = $2`, and per-loan queries also bind
   `loan_id = $3`:
   - `GET_TERMS_SQL`;
   - `LIST_RECORDS_FOR_LOAN_SQL ORDER BY record_id`;
   - `LIST_DOCS_FOR_LOAN_SQL ORDER BY record_id, position`;
   - `LIST_INSPECTIONS_FOR_LOAN_SQL ORDER BY record_id, inspection_id`;
   - `LIST_LOTS_FOR_LOAN_SQL`;
   - `LIST_MARGIN_EVENTS_FOR_LOAN_SQL ORDER BY block_number, log_index`;
   - `LIST_CONSENTS_FOR_LOAN_SQL ORDER BY position`;
   - `GET_REGISTRY_STATE_SQL` (paused, inspectors, projected_log_id);
   - `GET_VALUATION_SQL` (every column plus `fetched_at`);
   - `LOAN_LOG_WATERMARKS_SQL`: max `contract_logs.id` for `params->>'loan_id' = $3` on the
     SecurityRegistry only, and on `ANY($4)` of SecurityRegistry plus the valuation's `loan_registry`.
   - `LIST_SALE_REPAYMENTS_SQL`: chain-scoped `CashRepaid` with `params->>'loan_id' = $2` and
     `params->>'sale_id' = ANY($3)`. It has a `LEFT JOIN LATERAL` to the earliest `CashRepaymentReversed` on
     the same contract, loan and `repayment_id`, and is ordered by `block_number, log_index`. It is not
     scoped to a minter address, so repayments booked on the pre-#42 minter still link.

   Add `pub struct LoanSecurityRows { terms, records, docs, inspections, lots, margin_events, consents,
   registry: Option<(RegistryStateRow, i64)>, valuation: Option<(ValuationRow, DateTime<Utc>)>,
   sr_log_id: i64, valuation_log_id: i64, repayments: Vec<SaleRepaymentRow> }`, reusing the #1779 row
   structs, and a new `SaleRepaymentRow`. Add
   `SecurityRegistryRepo::load_loan_security(chain_id, contract, loan_id) -> anyhow::Result<LoanSecurityRows>`.
   It opens one transaction with `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY` and runs the
   reads in order. The repayment read runs last and uses the record ids.
3. [x] **API config.** In `packages/api/src/config.rs`, add `security_registry_addresses: HashMap<i64, String>`
   to `ChainsConfig` and `fn load_security_registry_address(chain_id, kind, out) -> Result<()>`. It is a
   copy of `load_pocket_address` with key `CHAIN_{id}_STELLAR_API_SECURITY_REGISTRY_ADDRESS` and log
   "API SecurityRegistry scope loaded". Then wire `packages/api/src/main.rs` and add the
   `AppState.security_registry_addresses` field in `packages/api/src/lib.rs`.
4. [x] **Assembly (pure).** Add `packages/api/src/security_state.rs` and register it in `lib.rs`, next to
   `minter_cash_book.rs`. It holds the DTOs (`LoanSecurityResponse`, `SecurityTermsDto`,
   `SecurityValuationDto`, `MarginCallDto`, `MarginEventDto`, `PricesDto`, `ConsentDto`, `SecurityRecordDto`,
   `RecordDocDto`, `RecordMarkDto`, `LotDto`, `RecordValuationDto`, `InspectionDto`, `SaleRepaymentDto`, all
   `Serialize + ToSchema`). It also holds
   `pub fn build_security_response(chain_id, contract, loan_id: &str, loan_status: Option<String>, rows: &LoanSecurityRows, now: u64) -> LoanSecurityResponse`,
   which applies the read/computed table above:
   - Parse `counted_records` into `Vec<shared::security_registry::CountedRecordView>`. On a parse failure,
     log a `warn` and treat the record valuations as absent; never fail the request.
   - Join protection from the record rows into `CountedTerm.goods`.
   - Treat the loan as closed when `loan_status == Some("Closed")`.
   - Derive `last_margin_call_ltv_bps` from the latest `open` event and `last_price_stale` from the latest
     `price_stale` event.
   - Set `refresh_pending = sr_log_id > projected_log_id || (terms.is_some() && valuation.map_or(true, |v| valuation_log_id > v.source_log_id))`.
5. [x] **Route.** Add `packages/api/src/routes/loan_security.rs` with header
   `// spec: docs/product-specs/loan-security-state.md#api-contract`, and register it in
   `routes/mod.rs`, `main.rs` (`.nest("/v1", …)`) and the OpenAPI merge (`LoanSecurityDoc`, tag
   `LoanBook`).
   - `pub fn resolve_security_registry(chain: ConfiguredChain, map) -> Result<&str, ApiError>` returns
     `ApiError::NotFound("security_registry_not_configured")`.
   - The handler `get_loan_security(State, Path(loan_id), RequiredChain(chain))` works in this order:
     1. resolve the registry first, so the 404 needs no DB;
     2. parse `loan_id` with `BigDecimal` and return 400 when malformed;
     3. look up `loan_status` with `contract_logs_repo.latest_status_by_loans` on
        `loan_registry_address`;
     4. load the rows with `load_loan_security`;
     5. take `now` from `SystemTime`;
     6. call `build_security_response`.
   - The `#[utoipa::path]` lists 200 / 400 / 404 (`security_registry_not_configured`) / 500.
   - Code is comment-less apart from the header.
6. [x] **Env and test-state plumbing.**
   - Add `security_registry_addresses: HashMap::new()` to every `AppState { … }` literal under
     `packages/api/tests/` (`grep -l pocket_addresses packages/api/tests`).
   - Add a commented `CHAIN_99000001_STELLAR_API_SECURITY_REGISTRY_ADDRESS=CDTUMAT6…` line to `.env.example`
     next to the API Pocket key: "optional — `GET /v1/loan-book/{loan_id}/security`; must equal the
     indexer key".
7. [x] **Docs** (see Docs to Update). Run `cargo fmt`, `cargo clippy --all -- -D warnings`,
   `cargo test -p shared -p pipeline-api`, and
   `/Users/aabliazimov/Documents/work/pipeline/node_modules/.bin/tsx scripts/lint-docs.ts` from the
   worktree.

## Test Strategy

Pure unit tests only. No Postgres and no DB env var. Router tests use the existing lazy-pool pattern
(`PgPool::connect_lazy("postgres://localhost/test")`) only for paths that return before any query. No
comments in tests.

- **`packages/shared/tests/security_state.rs`** (new):
  - `ltv_bps`:
    - no debt → 0, also with value 0 or negative;
    - debt with value 0 or negative → `u32::MAX`;
    - rounding up, e.g. debt 1, value 3 → 3334; exact division is not bumped;
    - `debt × 10_000` overflowing `u128` → `u32::MAX`;
    - a ratio above `u32::MAX` → `u32::MAX`.
  - `coverage_bps`:
    - rounds down;
    - negative value → 0;
    - debt 0 → `u32::MAX`;
    - overflow → `u32::MAX`.
  - `counted_value_excluding`:
    - a single division by 1e7 differs from per-term flooring, e.g. two terms of 0.5 raw;
    - an unmarked goods term is 0;
    - a non-goods term is `qty × UNIT`;
    - `exclude` drops exactly one record;
    - overflow → `None`.
  - `agent_release`, one case per `ensure_releasable` branch, plus the LTV-equal-to-advance-ratio boundary
    (allowed).
  - `attestation_stale` / `inspection_stale` / `mark_stale`:
    - at `== interval` → false, at `+1` → true;
    - interval 0 is off;
    - only in-storage goods are inspection-stale;
    - the lot's latest inspection wins over `perfected_at`.
  - `mark_age`: empty → 0; an unmarked → `u64::MAX`; the oldest mark wins. `price_stale`: the formula.
  - `cure_by`:
    - the event value wins after a `set_terms` that changed `cure_period`, i.e. the snapshot `cure_by`
      differs;
    - fallback to the snapshot → `coverage_detail`;
    - mismatched `margin_call_at` → `null`;
    - no call → `null`.
  - `format_7dp`: `0`, `1`, `12345678901234567890123`, a negative value, no exponent.
- **`packages/shared/tests/security_registry_repo_sql.rs`** (extend), with needle tests:
  - every new read binds `chain_id = $1` and `contract_address = $2`, and per-loan reads bind
    `loan_id = $3`;
  - the `ORDER BY` clauses;
  - `GET_VALUATION_SQL` selects `fetched_at` and `counted_records`;
  - `LIST_SALE_REPAYMENTS_SQL` contains `event_name = 'CashRepaid'`, `params->>'sale_id' = ANY(`, the
    reversal `LEFT JOIN LATERAL` on `repayment_id`, and no `contract_address` filter on the `CashRepaid`
    side;
  - the read transaction statement contains `REPEATABLE READ` and `READ ONLY` (make it a `pub const`).
- **`packages/api/tests/loan_security.rs`** (new):
  - `resolve_security_registry`: an EVM chain → `security_registry_not_configured`; an unconfigured Stellar
    chain → the same; a configured one resolves.
  - A router test: `GET /v1/loan-book/7/security?chain_id=<evm>` → 404 with body
    `{"error":"security_registry_not_configured"}`; a missing `chain_id` → 400.
  - `build_security_response`:
    - empty rows → `terms: null`, `records: []`, and `valuation` / `margin_call` / `prices` null;
    - `valuation` fields are verbatim from the snapshot, including `ltv_bps` `4294967295` serialised as a
      JSON number and 7-dp strings;
    - per-record `valuation` joins `counted_records` by `record_id`; a record that does not count has
      `null`;
    - `counts_toward_value` for each status and protection, `InsuranceLossPayee` `Active` → false;
    - `attestation_stale` is `null` for a non-`Active` record.
  - `ltv_above_ratio_no_onchain_call`:
    - true above the ratio with no call;
    - false at equal;
    - false with a call open;
    - false without a valuation;
    - false on `Closed`.
  - `open_call_curable` and `cure_overdue` (edge at `now == cure_by` → false). A Closed loan with an open
    call and open records gives:
    - records served;
    - `agent_release: allowed`;
    - `cure_overdue: false`;
    - `open_call_curable: true`.
  - `cure_by_source` for `event` / `coverage_detail` / `null`.
  - `last_margin_call_ltv_bps` and `last_price_stale` pick the latest of their kind.
  - Docs and inspections keep order; `is_lot_latest`; `flagged_by` 0 or `None` → `null`.
  - Repayments attach to the matching record only, with `reversed_at`.
  - `refresh_pending` truth table.
  - Malformed `counted_records` JSON → the record valuations are `null` and no panic.
  - The OpenAPI doc contains `/v1/loan-book/{loan_id}/security`.
- **`packages/api/tests/chains_config.rs`** (extend), with the pocket tests as the template:
  - a Stellar key is parsed and normalised;
  - unset or blank → no entry;
  - a bad Strkey → error naming the key;
  - an EVM chain ignores the key.
- **EVM regression:** the existing suites compile and pass with the new `AppState` field; the EVM 404 test
  above pins that EVM gets no new behaviour.
- **Testnet parity** (manual, user-stories doc): with keys set, `valuation.ltv_bps` / `coverage_bps` equal
  `stellar contract invoke … -- coverage_detail --loan_id <id>` at `detail_ledger`, and the `ltv_bps` of
  the `SecurityMarginCall` event matches `margin_call.last_margin_call_ltv_bps`.

## Docs to Update

- **New** `docs/product-specs/loan-security-state.md` (≤ 150 lines), with these sections:
  - Overview;
  - Behavior: the read/computed table, closed loans, freshness and `refresh_pending`;
  - `#computed-fields`: the mirrors with `lib.rs` pointers;
  - `#api-contract`: request, errors, JSON shape, encoding;
  - Data Model (pointer to `docs/references/security-registry-events.md#projection-tables`);
  - Security (public, on-chain data only, no RPC, no writes; adjust after Open Question 2).

  Add the row to `docs/product-specs/index.md` (Loan Management).
- `docs/references/security-registry-events.md`: replace "No API key exists here (#1780)" with the API key
  and a link to the new spec.
- `docs/references/backend.md`:
  - env/addresses table row `collateral_registry`: API column →
    `…_STELLAR_API_SECURITY_REGISTRY_ADDRESS (optional, #1780; must equal the indexer key)`;
  - one sentence in "Stellar SecurityRegistry indexing" about the endpoint;
  - the rollout steps: set the API key after the worker key.
- `.env.example`: the API key line (step 6).
- `docs/product-specs/collateral-valuation.md`: a one-line pointer saying the Stellar SecurityRegistry
  state (LTV, terms, records) is served by `GET /v1/loan-book/{loan_id}/security`. No CCR change (#1786).
- **New** `docs/user-stories/epic-1775/1780-loan-security-state-api.md`, plus its row in
  `docs/user-stories/index.md` under Epic #1775. Stories:
  1. key unset or EVM → 404 `security_registry_not_configured`, and pipeline-test is unchanged;
  2. a loan with no terms → 200 empty;
  3. terms, a record and a revalue → served state, with parity against `coverage_detail`;
  4. margin call open → `cure_by` from the event, still after a `set_terms`;
  5. inspection entered, approved and flagged, then resolved → inline inspections and flag;
  6. an enforced record with a minter `repay(sale_id = record_id)` → repayment linked;
  7. a closed loan with an open record → served with `agent_release: allowed` and no alarm.
- OpenAPI: generated by utoipa from the route (`LoanSecurityDoc` merged in `main.rs`). There is no checked-in
  spec file.
- `docs/exec-plans/tech-debt-tracker.md`: note under TD-171 that the API's computed staleness uses the API
  clock, not the ledger timestamp.
