# Issue #901: Stellar loan-registry amounts likely decoded at native 7-decimal SAC scale, not canonical 6-decimal

Source: https://github.com/eq-lab/pipeline/issues/901

## Scope

Fix the Stellar indexer's decode layer (`packages/worker/src/indexer/stellar/loan_registry_reader.rs`) so the monetary fields of `ImmutableLoanData` and `RepaymentData` are normalized from the Soroban contract's native 7-decimal USDC-SAC scale to the canonical 6-decimal scale that `base6_to_decimal_string` and every downstream API field assume — mirroring the conversion already applied to `senior_interest_rate` in the same function.

**In scope:**
- Decode-time normalization of `original_facility_size`, `original_senior_tranche`, `original_equity_tranche`, `original_offtaker_price` (`decode_immutable_loan_data`) and all seven `RepaymentData` fields (`decode_cumulative_repayment_data`).
- Unit tests proving the conversion (extend `packages/worker/tests/stellar_loan_reader.rs`).
- A one-off backfill of any existing Stellar `contract_logs` rows carrying un-normalized values (testnet only — no mainnet Stellar `LoanRegistry` deployment exists yet, per `pipeline-stellar-contracts/deployments/` — confirmed only a `testnet` folder present).
- `docs/product-specs/loans-data.md` — document the cross-chain scale convention explicitly so this doesn't need re-discovering.

**Out of scope:**
- `MutableLoanData` — has no currency fields (only counters, status, the `ONE`-scaled CCR ratio which is already correctly converted, location, `metadata_uri`). No change needed there.
- `USDC_BASE_DIVISOR`/`base6_to_decimal_string` (`packages/api/src/formatting.rs`) — stays as-is; it's correct once its input is canonical 6-decimal.
- EVM decode path — unaffected; EVM's `uint256` fields are genuinely 6-decimal by the EVM contract's own convention.
- Building new per-chain-configurable "asset decimals" plumbing for the worker (see Assumptions — a hardcoded constant is the right scope here).

## Assumptions and Risks

- **The issue's own "Needs final confirmation" step has not yet been independently verified against a live/testnet Stellar loan.** The evidence gathered when filing #901 is strong and cross-repo (this repo's own decode-asymmetry + the actual Soroban contract's integration test reusing a 7-decimal deposit amount directly as a loan-facility amount), but it is inference from code, not an observed live discrepancy. **Flagged as an Open Question below** — recommend the human approving this plan explicitly accept the static evidence as sufficient, or request a live testnet check first.
- **No existing per-chain "asset decimals" config exists in the `worker` crate.** The API crate's `capital_allocation.rs::normalize_to_canonical` + `CANONICAL_AMOUNT_DECIMALS`/`asset_decimals` pattern lives in `packages/api` only, driven by `CHAIN_<id>_API_STELLAR_ASSET_DECIMALS` env config — that config is a different, API-only concept (per-deployment custody/ramp tracking) and not reachable from the worker without new cross-crate plumbing. Since Stellar's native USDC SAC decimals (7) is a fixed, well-known protocol constant — not something that varies per-deployment the way custody addresses do — this plan hardcodes the conversion factor as a documented constant in the Stellar reader module rather than building new config. This is a scope decision, not left open.
- **Backfill mechanism:** `contract_logs.params` stores `LoanSnapshot` as JSONB (`params->'snapshot'->>'field'`, confirmed via existing queries in `contract_logs_repo.rs`), so a **direct SQL migration** dividing the affected numeric JSONB fields by 10 for Stellar chain rows is structurally feasible and does **not** depend on RPC replay. This matters because Soroban RPC only retains ~7 days of event history (documented in `.env.example`), so a from-scratch reindex-via-resync would not reach older events at all — a SQL backfill sidesteps that limitation entirely. **Flagged as an Open Question below** — needs confirmation that testnet Stellar loan data is disposable/re-seedable, in which case a backfill migration may be unnecessary (simpler to redraw test loans than write and verify a JSONB-mutating migration).
- **No mainnet Stellar `LoanRegistry` deployment exists yet** (only a `testnet` deployments folder found in the sibling `pipeline-stellar-contracts` repo) — so there is no real-money data affected by this bug today. This lowers urgency/risk but the fix should land before any mainnet Stellar loan draw.
- **`Cargo.lock`/workspace impact:** none — this is a pure logic change in an existing module, no new dependencies.

## Open Questions

1. Should implementation proceed directly on the static cross-repo evidence in #901 (indexer decode asymmetry + the Soroban contract's own integration test reusing a 7-decimal deposit amount as a loan-facility amount), or does a human want to first confirm against a live/testnet drawn loan before this fix lands? (The issue explicitly listed this as a pre-implementation confirmation step.)
2. Is a JSONB backfill migration for existing testnet `contract_logs` Stellar rows actually needed, or is testnet Stellar loan data disposable (redraw fresh test loans post-fix instead of migrating old rows)? Affects whether Implementation Step 5 below is required.

## Implementation Steps

1. **Add a documented scale constant** in `packages/worker/src/indexer/stellar/loan_registry_reader.rs`, near the top of the file:
   ```rust
   /// Soroban `LoanRegistry`'s monetary fields (`ImmutableLoanData`, `RepaymentData`) are
   /// stored at the native USDC-SAC scale (7 decimals on Stellar), not the canonical
   /// 6-decimal scale `base6_to_decimal_string` and every downstream API field assume
   /// (matching EVM's native `uint256` USDC convention). Confirmed against the actual
   /// contract's own integration test (`pipeline-stellar-contracts/contracts/
   /// integration-tests/src/full_user_flow.rs::Setup::add_yield`, which reuses a
   /// 7-decimal-scaled deposit amount directly as a loan-facility amount). See #901.
   const STELLAR_USDC_SCALE_ADJUSTMENT: u128 = 10; // 10^(7 - 6)
   ```

2. **Normalize the four `ImmutableLoanData` monetary fields** in `decode_immutable_loan_data`: divide each raw `u128` by `STELLAR_USDC_SCALE_ADJUSTMENT` *before* lifting to `U256`, i.e.
   ```rust
   let original_facility_size = U256::from(
       map_u128(&map, "original_facility_size", "ImmutableLoanData")? / STELLAR_USDC_SCALE_ADJUSTMENT,
   );
   ```
   applied identically to `original_senior_tranche`, `original_equity_tranche`, `original_offtaker_price`. Add a one-line comment pointing at the new constant's doc comment (avoid repeating the full rationale four times). Leave `senior_interest_rate`/timestamps untouched (already correctly handled / not currency).

3. **Normalize all seven `RepaymentData` fields** in `decode_cumulative_repayment_data` the same way: `offtaker_received`, `senior_principal_repaid`, `senior_interest`, `equity_distributed`, `mgmt_fee`, `perf_fee`, `oet_alloc`.

4. **Update `packages/worker/tests/stellar_loan_reader.rs`** — the existing `decode_immutable_loan_data_happy_path` test uses fixture values (`10_000_000_000_000_000_000` etc.) that don't reveal scale; either:
   - Rescale the existing test's expected assertions to reflect the `/10` conversion (simplest — the fixture's proportions, e.g. senior/facility = 80%, still hold after dividing all four by 10), or
   - Add a **new**, explicitly scale-focused test using a realistic round-number fixture (e.g. raw `10_000_000_000` u128 in → expect `U256::from(1_000_000_000)` out, i.e. "$1,000 at 7-decimal in → $1,000 at 6-decimal out" with the numbers chosen so the reader can eyeball the conversion). Add an equivalent test for `decode_cumulative_repayment_data`.
   Prefer the second (additive) approach — it keeps the existing happy-path test's intent (full-range u128 decode correctness) separate from the new scale-conversion intent, and gives future readers a self-evident regression guard.

5. **Backfill existing testnet `contract_logs` Stellar rows** (only if Open Question 2 resolves to "yes, migrate rather than redraw"): a one-off SQL migration in `packages/shared/migrations/` dividing the eight affected JSONB numeric string fields (`params->'snapshot'->'original_facility_size'`, `...original_senior_tranche`, `...original_equity_tranche`, `...original_offtaker_price`, `...repayment.offtaker_received`, `...repayment.senior_principal_repaid`, `...repayment.senior_interest`, `...repayment.equity_distributed`, `...repayment.mgmt_fee`, `...repayment.perf_fee`, `...repayment.oet_alloc`) by 10, scoped to Stellar chain ids (the `99_000_000+` sentinel range — confirm the exact predicate against `shared::chains::parse_chain_type`/`ChainKind::Stellar`). Use `jsonb_set` with a numeric-string division (Postgres JSONB stores these as strings per `NUMERIC(78,0)`-style convention elsewhere in this schema — verify the stored representation before writing the `UPDATE`, since dividing a *string* requires a cast, not arithmetic on the JSONB value directly).

## Test Strategy

- `packages/worker/tests/stellar_loan_reader.rs`: new/updated assertions per Implementation Step 4 for both `decode_immutable_loan_data` and `decode_cumulative_repayment_data`, proving the `/10` conversion is applied to every monetary field and *not* applied to `senior_interest_rate_bps`/timestamps/counters.
- Run `cargo test -p pipeline-worker` and confirm no other worker test (e.g. `packages/worker/tests/stellar_loan_parsers.rs`, `loan_mapper.rs` tests) encodes an assumption about the old un-normalized scale that would now fail for the wrong reason — grep for `original_facility_size`/`original_senior_tranche`/repayment-field literals across `packages/worker/tests/` before finalizing.
- If the backfill migration (Step 5) is implemented: a targeted manual check — apply the migration against a copy of the dev DB (or a fresh migrate-up), then confirm `GET /v1/loan-book` for an existing Stellar-chain loan (if any test data exists) now returns figures consistent with its known intended dollar amounts.
- `cargo clippy --all -- -D warnings` and the standard `/test-fast` gate before marking done.

## Docs to Update

- `docs/product-specs/loans-data.md` — add an explicit note next to the existing EVM `uint256 originalFacilitySize; // 6-decimal USDC units` comment (line ~76) stating that Stellar's native contract representation is 7-decimal (matching its USDC SAC), and that the indexer normalizes to the same canonical 6-decimal scale on read, so the shared `LoanSnapshot`/API schema stays chain-agnostic. This directly prevents the ambiguity that prompted #901.
- No frontend/design-doc changes — this is a backend data-correctness fix with no API shape change (same field names/types, just correct values for Stellar).
- On completion, move this plan to `docs/exec-plans/completed/` (manager step).
