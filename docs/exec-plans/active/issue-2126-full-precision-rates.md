# Issue #2126: Loan readers floor 1e6 rates to whole bps, so the API under-proposes interest

Source: https://github.com/eq-lab/pipeline/issues/2126

Epic: #2129 (Math correctness). Branch `fix/2126-full-precision-rates`.

## Scope

**Decision (human, 2026-11-19):** carry the full 1e6 rate (ppm, `ONE = 1_000_000`) end to end. Do not floor it to whole bps. Accrual and the waterfall must match each contract's accrual exactly.

**Decision (human, 2026-11-20):** no `epoch.current_apy_ppm` field. The financials endpoint and the Trustee coupon estimate stay on the floored bps; there is no frontend change.

**Contract accrual (frozen, read from the sibling repos):**

- EVM `pipeline-contracts/src/loanRegistry/LoanRegistryUpgradeable.sol:17-18,652-654`: `_epochInterest = (block.timestamp − effectiveFrom) × seniorInterestRate × principal / (YEAR × ONE)`, with `YEAR = 31_557_600` and `ONE = 1_000_000`. Integer division, so each epoch is floored. `_appendEconomicsEpoch` adds the floored value to `accruedInterest`. `_accruedInterest` returns the floored cumulative value plus the floored open epoch, minus recorded interest and fees, plus `interestAdjustment`, clamped at 0, and 0 when Closed.
- Stellar `pipeline-stellar-contracts/contracts/loan-registry/src/storage.rs:267-270,281-377`: `epoch_interest = elapsed × rate × outstanding / (YEAR × ONE)` (u128, floored) with the same constants (`lib.rs:30-32`). It is the same formula as EVM.
- Epoch boundaries on both chains: a disbursement, undisbursement, recorded payment, unrecorded payment or write-down calls `_advanceEpoch` / `advance_epoch`, and so does a rollover or amendment through `_setTerms` / `set_terms` once an epoch is open. **`_setDefault` / `set_default` and `cure` do not open an epoch**, so the contract floors the time before and after a default as one epoch.

**What changes:**

1. **Readers.** Both readers keep the raw ppm values: EVM `packages/worker/src/indexer/loan_registry_reader.rs` (`ppm_to_bps` is removed) and Stellar `packages/worker/src/indexer/stellar/loan_registry_reader.rs` (`/ 100` at :207 and :275 is removed). The view fields are renamed so that every reader of them fails to compile until it is reviewed: `senior_interest_rate_bps` → `senior_interest_rate_ppm`, and `current_rate` → `current_rate_ppm`.
2. **Storage.** The snapshot is the `contract_logs.params.snapshot` JSONB; there is no table column. `LoanSnapshot` gets two additive optional fields, `senior_interest_rate_ppm` and `current_rate_ppm`. The worker keeps writing the floored bps fields (`senior_interest_rate_bps`, `current_rate`) as before. An older API binary needs them during a rollback, because `senior_interest_rate_bps` has no serde default.
3. **Backfill.** A one-shot, idempotent pass at worker startup, per chain, before the poller starts. It reads `immutable_loan_data` for each loan on the configured LoanRegistry whose snapshot rows lack the ppm keys. The data is immutable, so a current-state read is correct on both chains. It writes `senior_interest_rate_ppm` on every row. `current_rate_ppm` is derived per row from the indexed `EconomicsAmended` / `LoanRolledOver` `new_rate` (raw ppm, already stored), falling back to genesis. The new readers write both keys for new rows.
4. **Rate events.** `new_rate` is already stored raw (ppm) on both chains, so nothing changes at ingest. The consumers stop converting it to bps: `LoanAccrual`, `rate_bps_at` and `build_epochs`.
5. **Accrual, the core of the fix.** `shared::book_weighting::LoanAccrual` works in ppm with the denominator `1_000_000 × CONTRACT_YEAR_SECS`. `accrued_floored_per_segment` floors per **contract epoch**: a `LoanDefaulted`-only breakpoint no longer splits a floor segment. This removes a residual drift of at most 1 unit, separate from the bps floor; the test replica `contract_cap` in `packages/api/tests/waterfall_accrual.rs:118` already skips `LoanDefaulted`. Fee accrual (`simple_interest`, off-chain bps fee schedule) is unchanged.
6. **Waterfall.** Kept to a minimal edit. The two `LoanAccrual::new(s.senior_interest_rate_bps, …)` calls become `LoanAccrual::from_ppm(s.genesis_rate_ppm(), …)`, and three module-doc phrases that say "floored bps" / "`rate_bps / 10_000`" are corrected. All other math stays inside `LoanAccrual`.
7. **API.**
   - `GET /v1/loan-book`: per-loan `rate`, `avg_yield`, and through it the dashboard `loan_book_yield` / `current_apy_net_to_splusd`. Same fields and the same 6-decimal fraction strings, which now hold the exact ppm (6 dp fraction = 1 ppm).
   - `/v1/stats/yield` (`portfolio.rs`): `apy` and `accrued` use ppm.
   - `GET /v1/loan-book/{id}/financials` `epoch.current_apy_bps`: kept, still an integer, now `ppm / 100` floored. No new field and no new routes.
8. **Frontends.**
   - The Trustee "Scheduled coupon" and the epoch labels keep reading the floored `current_apy_bps` (no `current_apy_ppm` field, decision 2026-11-20).
   - LP and Trustee views that format the `rate` / `avg_yield` strings need no code change. They already parse decimal fractions, and `formatBpsRate` accepts fractional bps.
   - The reterm card already formats the on-chain ppm (`chain.currentRate / 100`).

**Out of scope:**

- Rate input UIs (`percentToBps`, `RATE_PERCENT_PATTERN`, origination `senior_interest_rate_bps`, wallet-connect `rateBps × 100`). They encode whole bps exactly.
- The loan-submission DTO (`EconomicsInput.senior_interest_rate_bps`).
- The off-chain fee schedule (`*_fee_rate_bps`).
- One-decimal display rounding (`toFixed(1)`) and the trustee coupon's `/365` estimate. Both are in the epic's "low-severity display" batch.
- Audit-log `new_rate_bps` / `economics_rate_pct`. No frontend reads them, so they stay stable and floored; logged as tech debt.
- Snapshot rows from earlier (pre-rework) LoanRegistry addresses. They keep the `bps × 100` fallback, and the API is scoped to the current registry (#1538).
- Contract changes. The contracts are frozen.

## Assumptions and Risks

- **Siblings land first.** #2123, #2124 and #1547 edit `packages/api/src/routes/waterfall.rs`, `packages/api/tests/waterfall.rs`, `packages/api/tests/waterfall_accrual.rs` and `docs/product-specs/yield.md`. #1547 also edits both reader files, `packages/worker/src/indexer/mod.rs`, `packages/worker/src/indexer/stellar/poller.rs` (it adds a supervised `max_fee_bps` settings task right after the loan-mapper deps) and the reader tests.
  - Rebase onto `main` after they merge, before implementing.
  - Keep the waterfall edit to the two constructor calls plus the doc phrases.
  - Put the backfill call next to, not inside, #1547's settings task.
  - `LoanAccrual::new` is **removed** (replaced by `from_ppm`), so a sibling branch that adds a bps call fails to compile instead of silently accruing at 1/100 of the rate.
- **No headroom margin.** The waterfall headroom now equals the contract's `_accruedInterest` at `as_of` exactly. Before, for loans with a fractional rate, the floored bps left a small margin. `as_of` may still be up to 300 s in the future (`AS_OF_FUTURE_SKEW_SECS`). If the Trustee mines before `as_of`, the contract's accrued value is lower and `recordPayment` can revert with `LoanRegistryInterestExceedsMax`. This was already true for whole-bps loans, so behaviour is unchanged; documented, no fix here.
- **Real exposure is small.** Every loan drawn through the pipeline API already has a whole-bps genesis rate (`draw_loan_args_at` sends `bps × 100`), and the trustee and risk-council forms only send whole bps. Fractional ppm only comes from direct contract calls or scripts, or from future inputs. Until the backfill runs, the fallback `bps × 100` is exact for every API-originated loan.
- **Backfill guard.** A loan is backfilled only if `genesis_ppm / 100 == stored senior_interest_rate_bps`. That proves the read hit the right contract and loan. A mismatch, or an RPC or decode error, is logged at `warn`, the loan is skipped, and it is retried on the next start. The derived `current_rate_ppm` is **not** checked against the stored `current_rate`. On Stellar, `mutable_loan_data` is current-state (TD-19), so stored `current_rate` values can reflect a later state. The derived value is the rate in force at the row's position, which is what the contract used.
- **Carry-forward.** `compose_lifecycle_snapshot` carries `senior_interest_rate_ppm` forward from the prior row. A loan whose backfill failed keeps `None` on new rows until the next startup backfill succeeds, and the API falls back to `bps × 100` meanwhile.
- **Test fixtures.** About 22 test files build `LoanSnapshot` literally (see the `senior_interest_rate_bps:` grep). Each gains `senior_interest_rate_ppm: None, current_rate_ppm: None`. This is mechanical, but it touches files the siblings edit; rebase first.
- **Tests.** No DB access and no env-var DB URLs. The backfill's SQL is not exercised by tests; only its pure planning function is.

## Open Questions

None. The `epoch.current_apy_ppm` question was answered "no" on 2026-11-20 (steps 9 and 13 dropped).

## Implementation Steps

Rebase `fix/2126-full-precision-rates` onto `main` once #2123, #2124 and #1547 have merged, then do the steps below.

1. **Shared rate primitives** (`packages/shared/src/loan_economics.rs`)
   - Add `pub const RATE_ONE: i64 = 1_000_000;`. Rename the existing `ECONOMICS_RATE_ONE` to it, or alias it, and update its users.
   - Keep `economics_rate_to_bps` as is (audit log only).
   - Add `pub fn ppm_to_bps_floor(ppm: u32) -> u32 { ppm / 100 }`. The worker uses it to keep writing the legacy bps fields.
   - `Epoch.rate_bps` → `Epoch.rate_ppm: u32`.
   - `build_epochs(origination_date, original_maturity_date, genesis_rate_ppm: u32, events)` stores `e.new_rate as u32` with no conversion. Use `u32::try_from(e.new_rate).unwrap_or(0)`; an unparseable rate already decodes to 0.

2. **Snapshot** (`packages/shared/src/loan_snapshot.rs`)
   - Add `#[serde(default)] pub senior_interest_rate_ppm: Option<u32>` next to `senior_interest_rate_bps`, and `#[serde(default)] pub current_rate_ppm: Option<u32>` next to `current_rate`.
   - Add accessors on `LoanSnapshot`:
     - `genesis_rate_ppm() -> u32`: `senior_interest_rate_ppm.unwrap_or(senior_interest_rate_bps * 100)`.
     - `current_rate_ppm() -> u32`: `current_rate_ppm`, else `current_rate * 100` when `current_rate > 0`, else `genesis_rate_ppm()`. This replaces the fallback rule in `book_weighting::current_rate_bps`.
   - Do not add doc comments to these accessors (comment-less rule). The field docs already in the file stay; update the `current_rate` field doc to say it is the floored bps mirror.

3. **`LoanAccrual` in ppm** (`packages/shared/src/book_weighting.rs`)
   - Replace `LoanAccrual::new(initial_bps, events)` with `LoanAccrual::from_ppm(initial_rate_ppm: u32, events)`, and remove `new`.
   - Internal `rate_bps` → `rate_ppm`. Rate events set `cur_rate = new_rate as u32` with no `economics_rate_to_bps`.
   - Method `rate_bps_at` → `rate_ppm_at`, and free fn `rate_bps_at` → `rate_ppm_at(initial_ppm, events, t)`.
   - `current_rate_bps(snapshot)` → `current_rate_ppm(snapshot)`, which delegates to the snapshot accessor; alternatively drop it and call the accessor.
   - Add `ppm_to_fraction_string(ppm: &BigDecimal) -> String`: `ppm / 1_000_000`, `with_scale_round(6, HalfUp)`. `bps_to_fraction_string` loses its last caller and is removed.
   - Rate integrals use a new private `rate_denominator() = RATE_ONE × CONTRACT_YEAR_SECS`. `accrued`, `accrued_floored_per_segment` and `accrued_over_intervals(initial_ppm, …)` use it. `simple_interest` / `accrual_denominator` keep `BPS_DENOM × CONTRACT_YEAR_SECS` because the waterfall's bps fee rates use them.
   - **Epoch-exact flooring.** Record, per breakpoint, whether it opens a contract epoch: true when any event at that timestamp is in `OUTSTANDING_EVENT_NAMES` other than `LoanDefaulted`, or in `RATE_EVENT_NAMES`. In `accrued_floored_per_segment(until)`, accumulate the unfloored numerators of consecutive segments up to the next epoch-opening breakpoint, or up to `until`. Floor once per epoch, as `numerator / rate_denominator()` rounded `Down`.
   - Optional: compute the floor with integer division (`BigInt` `div_floor`) so it does not depend on BigDecimal's division precision.
   - `outstanding_at`, `outstanding_seconds` and `numerator` are otherwise unchanged.

4. **Worker readers**
   - `packages/worker/src/indexer/loan_metadata.rs`: `ImmutableLoanDataView.senior_interest_rate_bps` → `senior_interest_rate_ppm: u32`, and `MutableLoanDataView.current_rate` → `current_rate_ppm: u32`. Fix the field doc that says "Basis points — both reader arms divide…" to say raw ppm.
   - EVM `loan_registry_reader.rs`: delete `ppm_to_bps` and its doc, and pass `d.seniorInterestRate` / `d.currentRate` through.
   - Stellar `stellar/loan_registry_reader.rs`: drop `/ 100` at :207 and :275, and fix the two comments that justify the conversion.

5. **Mapper** (`packages/worker/src/indexer/loan_mapper.rs`)
   - `compose_drawn_snapshot` writes `senior_interest_rate_bps: ppm_to_bps_floor(immutable.senior_interest_rate_ppm)`, `senior_interest_rate_ppm: Some(immutable.senior_interest_rate_ppm)`, `current_rate: ppm_to_bps_floor(mutable.current_rate_ppm)` and `current_rate_ppm: Some(mutable.current_rate_ppm)`.
   - `compose_lifecycle_snapshot` carries `senior_interest_rate_bps` and `senior_interest_rate_ppm` forward from `prior` and writes both current-rate fields from `mutable`.

6. **Backfill: repo queries** (`packages/shared/src/contract_logs_repo.rs`, in `ContractLogsRepo`)
   - `list_loans_missing_rate_ppm(chain_id, contract_address) -> Vec<BigDecimal>`: distinct `params->>'loan_id'` over rows with `event_name = ANY(LOAN_LIFECYCLE_EVENT_NAMES)`, `params ? 'snapshot'` and `NOT (params->'snapshot' ? 'senior_interest_rate_ppm')`.
   - `list_rate_backfill_rows(chain_id, contract_address, loan_id) -> Vec<RateBackfillRow>`. Each row carries `id`, `event_name`, `params->'event'->'new_rate'` (via `json_i64`, matching `EconomicsEventRow::from_event_json`), `snapshot->'senior_interest_rate_bps'` and `has_ppm`. All lifecycle rows of the loan, ordered by `(block_number, log_index)`, so a rate event that already carries ppm still advances the rate.
   - `set_snapshot_rate_ppm(tx, id, genesis_ppm, current_ppm)`: `UPDATE contract_logs SET params = jsonb_set(jsonb_set(params, '{snapshot,senior_interest_rate_ppm}', to_jsonb($2::bigint)), '{snapshot,current_rate_ppm}', to_jsonb($3::bigint)) WHERE id = $1`. The only precedent for updating `contract_logs` is `kyc_repo.rs:865`.
   - `RateBackfillRow` is a plain struct in the same file.

7. **Backfill: worker module** (new `packages/worker/src/indexer/rate_ppm_backfill.rs`, `pub mod` in `indexer/mod.rs`)
   - Pure function `pub fn plan_rate_ppm_backfill(genesis_ppm: u32, rows: &[RateBackfillRow]) -> Result<Vec<(i64, u32)>, String>`:
     - `Err` when any row's stored `senior_interest_rate_bps != genesis_ppm / 100` (the guard).
     - Otherwise walk the rows in order. `cur = genesis_ppm`; a rate-event row (`LoanRolledOver` / `EconomicsAmended` with `new_rate`) sets `cur = new_rate` **before** its own row is emitted, because its snapshot is read after `_setTerms`. Emit `(id, cur)` for each row that lacks ppm. A rate event with no parseable `new_rate` keeps the previous rate.
   - Async `pub async fn run_rate_ppm_backfill<A: LoanAddress, Id: LoanId>(chain_id, contract: &A, repo: &ContractLogsRepo, pool: &PgPool, resolver: &dyn ImmutableDataResolver<A, Id>)`:
     1. List the loans.
     2. For each loan: `Id::from_bigdecimal`, then `resolver.immutable_loan_data`.
     3. Fetch the rows and plan.
     4. Write all of the loan's rows in one transaction.
     5. Log `info` with the counts per chain. Per-loan failures are `warn` and skipped, never fatal.
   - Wire it in two places:
     - EVM `run_indexer_job` (`indexer/mod.rs`), right after the resolvers are built (before the Arcs move into the parser builder, so before the poller and the `loan-registry-settings` task start). Await it inline with `loan_registry_address` and `immutable_resolver`.
     - Stellar `run_stellar_indexer_job` (`stellar/poller.rs`), inside the `loan_registry_id` branch after `reader` is built, with `StellarAddress(lr_id.clone())`.

8. **API consumers**
   - `packages/api/src/routes/waterfall.rs`, minimal edit:
     - :387 and :466 (line numbers before the rebase): `LoanAccrual::new(s.senior_interest_rate_bps, &event_refs)` → `LoanAccrual::from_ppm(s.genesis_rate_ppm(), &event_refs)`.
     - Module doc, stage 1: "so with the floored bps rate it never exceeds the on-chain cap" → "at the full 1e6 rate, once per contract epoch, so it equals the on-chain `_accruedInterest`".
     - Module doc, Units: "`rate_bps / 10_000`" → "`rate / 1_000_000`".
     - No other change.
   - `packages/api/src/routes/portfolio.rs`:
     - `LoanAccrual::from_ppm(loan.snapshot.genesis_rate_ppm(), …)`.
     - `apy` = weighted mean of `rate_ppm_at(t)` / `1_000_000`, keeping the 8-dp rounding.
     - Update the `# Formulas` doc block (`R_bps` → `R_ppm`, `/ 10_000` → `/ 1_000_000`).
   - `packages/api/src/routes/loan_book.rs`:
     - `EntryComputation.rate_bps` → `rate_ppm`.
     - `build_loan_entry` uses `s.current_rate_ppm()` and `ppm_to_fraction_string`.
     - `rate_pairs` take the ppm values, and `avg_yield` uses `ppm_to_fraction_string`.
     - The `rate` / `avg_yield` field docs stay accurate as written.
   - `packages/api/src/routes/loan_financials.rs`:
     - `current_epoch` passes `s.genesis_rate_ppm()` to `build_epochs`.
     - `EpochView` keeps `current_apy_bps: ppm_to_bps_floor(current.rate_ppm)`; no new field.
   - `packages/api/src/routes/audit_log.rs`: unchanged (out of scope).

9. **Dropped** (Trustee frontend; no `current_apy_ppm` field).

10. **Fixtures.** Add `senior_interest_rate_ppm: None, current_rate_ppm: None` to every `LoanSnapshot` literal. Run `grep -rln "senior_interest_rate_bps:" packages --include='*.rs'`; it lists 25 files after the rebase.

11. **Lint and build**
    - `cargo clippy --workspace --all-targets -- -D warnings`
    - `cargo fmt --all`
    - `cargo test -p shared -p pipeline-api -p pipeline_worker` (or the workspace names)
    - `npx tsx scripts/lint-docs.ts`

## Test Strategy

All tests are pure unit tests in `packages/<pkg>/tests/`, with no DB and no env vars.

- **`packages/api/tests/waterfall_accrual.rs`.** The existing `contract_cap(genesis_ppm, events, until)` is the contract replica: it skips `LoanDefaulted` and floors per epoch with `YEAR × 1_000_000`.
  - Replace `non_whole_bps_genesis_rate_floors_below_the_ppm_cap` with `non_whole_bps_genesis_rate_matches_the_ppm_cap`. The snapshot has `senior_interest_rate_ppm: Some(112_550)` and the assertion becomes `suggested_interest == contract_cap(112_550, …)`.
  - Add the issue example: rate 72,550, outstanding `1_000_000_000_000` (EVM 6 dp), one `CONTRACT_YEAR`. Expected gross `72_550_000_000`; the old bps path gave `72_500_000_000`, $50 less.
  - Add `default_does_not_split_the_contract_epoch`: outstanding `1_234_567_891`, rate 72,550, `LoanDefaulted` at +100 d, `as_of` = +200 d + 17 s. The expected accrual is `49_044_757` (one epoch). The old per-breakpoint floor gives `49_044_756`. Recompute both values in the test with the replica; do not hard-code them unchecked.
  - Change `suggested_interest_never_exceeds_the_contract_cap_across_scenarios` to assert **equality** of the gross accrual (`LoanAccrual::accrued_floored_per_segment`) with `contract_cap` for every scenario. Add fractional rates, a mid-life `EconomicsAmended` to a fractional ppm, a rollover, a write-down, and multi-draw cases.
  - Add a fallback case: the snapshot has no ppm (`None`) and bps 1125, so accrual equals `contract_cap(112_500, …)`.
- **`packages/api/tests/book_rate_weighting.rs`**
  - Port `LoanAccrual::new(1000, …)` → `from_ppm(100_000, …)` and `rate_bps_at` → `rate_ppm_at`. Assert that a `new_rate` of 112,550 stays 112,550; it no longer becomes 1,125.
  - `current_rate_ppm` fallback chain: `Some` ppm, then legacy `current_rate` bps ×100, then genesis.
  - Keep the `economics_rate_to_bps` assertions; the function still exists.
- **`packages/api/tests/loan_book.rs`.** A loan with `current_rate_ppm: Some(72_550)` serves `rate == "0.072550"`. `avg_yield` weights in ppm, e.g. two loans 72,550 and 100,000 with equal outstanding give `"0.086275"`.
- **`packages/api/tests/loan_financials.rs`.** Genesis `Some(72_550)` with no events gives `current_apy_bps == 725`. An `EconomicsAmended` with `new_rate` 112,599 gives `1125`.
- **`packages/api/tests/portfolio_compute.rs` / `yield_apy_semantics.rs`.** Existing whole-bps expectations stay unchanged once the fixtures carry `None`. Add one fractional-rate `accrued` case.
- **`packages/shared/tests/loan_economics.rs`.** `build_epochs` keeps the raw ppm (`240_000` → `rate_ppm == 240_000`).
- **`packages/shared/tests/loan_snapshot.rs`.** An old JSON row without the ppm keys deserializes to `None`. A round trip keeps `Some`. Test both accessors.
- **`packages/worker/tests/loan_registry_reader.rs` and `stellar_loan_reader.rs`.** Decoding `seniorInterestRate = 72_550` / `currentRate = 112_599` yields the raw values; before, these were `725` / `1125`.
- **`packages/worker/tests/loan_mapper.rs`**
  - The drawn snapshot writes both bps (floored) and ppm.
  - The lifecycle snapshot carries `senior_interest_rate_ppm` from `prior` and takes `current_rate_ppm` from `mutable`.
  - A prior with `None` stays `None`.
- **New `packages/worker/tests/rate_ppm_backfill.rs`**, for `plan_rate_ppm_backfill`:
  - Genesis only: every row gets genesis.
  - An amendment mid-history: rows from the amendment row onward get its `new_rate`.
  - A rollover then an amendment.
  - A guard mismatch (stored bps ≠ genesis/100) returns `Err`.
  - Rows with an unparseable `new_rate` keep the previous rate.
- **Manual check** (no DB in tests).
  - On a local or dev stack after deploy, confirm the worker logs the backfill counts per chain.
  - `SELECT count(*) FROM contract_logs WHERE params ? 'snapshot' AND NOT (params->'snapshot' ? 'senior_interest_rate_ppm')` drops to the pre-rework rows only.
  - `GET /v1/loan-book/{id}/waterfall` for a loan matches `loanMoney(loanId).accruedInterest` (EVM) or `accrued_interest(loan_id)` (Stellar) at the same timestamp.

## Docs to Update

- `docs/product-specs/yield.md` §"Waterfall components", the `senior_gross_interest` row at :48. Replace "at the floored bps rate, so it never exceeds the on-chain cap" with: the full 1e6 rate, floored once per contract epoch (epochs open on disburse / undisburse / record / unrecord / write-down / rollover / amend, not on default), equal to `_accruedInterest`. This file conflicts with #2124 and #1547 edits.
- `docs/product-specs/book-rate-weighting.md`:
  - `current_rate` is the snapshot's full ppm (`current_rate_ppm`, falling back to legacy bps ×100, then genesis).
  - The `/v1/stats/yield` `apy` uses `new_rate` ppm untruncated; remove "ppm → bps truncated … 112,550 → 1,125".
  - `accrued` = `∫ outstanding × rate_ppm dt / (1_000_000 × YEAR)`.
- `docs/product-specs/loans-data.md` §"Maturity-capped accrual ceiling" / the struct snippets: add one sentence that on-chain rates are `u32` fixed-point with `ONE = 1_000_000` (bps × 100), and that the indexer and API carry them unfloored.
- `docs/references/backend.md`, LoanRegistry indexer section:
  - The snapshot fields `senior_interest_rate_ppm` / `current_rate_ppm`, with the legacy bps fields kept as floored mirrors.
  - The startup backfill (what it reads, the guard, idempotence, retry on restart, pre-rework rows untouched).
  - How to verify, using the SQL count above.
- `docs/user-stories/epic-2129/2126-full-precision-rates.md` (new, same template as `2127-trustee-facility-tiles.md`). Stories:
  - A fractional-rate loan's waterfall proposes interest equal to the contract's accrued interest.
  - The loan book shows the exact rate fraction.

  Add a row to `docs/user-stories/index.md` under "Epic #2129 — Math correctness".
- `docs/exec-plans/tech-debt-tracker.md`, TD-197 (next free number on origin/main):
  - Audit-log `EconomicsAmended` / `LoanRolledOver` `new_rate_bps` and `economics_rate_pct` still floor ppm to bps / 2-dp percent (display only, no consumer).
  - Snapshot rows from pre-rework LoanRegistry addresses are not backfilled and keep the `bps × 100` fallback.
