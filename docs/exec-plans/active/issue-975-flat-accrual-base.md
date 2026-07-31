# Issue #975: Loan interest accrues on declining outstanding principal, not the flat original senior tranche

Source: https://github.com/eq-lab/pipeline/issues/975

## Scope

Fix the interest-accrual base in the Stellar loan-registry contract (`eq-lab/pipeline-stellar-contracts`, `contracts/loan-registry/src/storage.rs`). Two functions compute the per-epoch interest on a **declining** base:

```rust
let outstanding = immutable.original_senior_tranche - cumulative.senior_principal_repaid;
let last_epoch_interest = factor * outstanding / ONE;
```

- `append_economics_epoch` (main lines 178–180)
- `calculate_max_interest` (main lines 210–212)

Both must accrue on the **flat** `original_senior_tranche`, matching the spec and the off-chain reference. `rollover` (`lib.rs`) routes through `append_economics_epoch`, so it is fixed transitively.

**In scope:**
- Replace the declining `outstanding` base with the flat `original_senior_tranche` in both functions.
- Drop the now-unused `get_cumulative_repayment` call in `append_economics_epoch` (in `calculate_max_interest`, `cumulative` is still needed for `cumulative.senior_interest`).
- A regression test in `contracts/loan-registry/src/test.rs` proving accrual stays on the flat base after a principal repayment.

**Out of scope:**
- Any spec change — the spec is already correct (see below); the contract was violating it.
- The off-chain reference (`packages/shared/src/loan_economics.rs`) — already correct (flat `senior_deployed`).
- The #967 maturity-cap work — **not on `main`** (main's `last_epoch_interest_factor` has no cap); this branch is cut from `origin/main` and is independent of the unmerged #967 branch.
- Any migration/redeployment of the contract (deployment is a separate ops concern).

## Assumptions and Risks

- **Resolved open question (issue note "confirm accrual base — contract vs spec"):** the spec is explicit and wins. `docs/product-specs/loans-data.md:77` — `originalSeniorTranche // ... (the accrual base)`; `:87` — `The accrual base is always originalSeniorTranche`; formulas at `loans-data.md:135` and `yield.md:124` both use `originalSeniorTranche * e.seniorInterestRateBps`. The off-chain `piecewise_interest` accrues on the flat `senior_deployed` with the comment "the accrual base never itself compounds across epochs — per spec it's always originalSeniorTranche". The contract is the sole outlier.
- **Behavioural note (not a risk to the fix):** in `record_payment` (`lib.rs`), `append_economics_epoch` is called **before** `cumulative.senior_principal_repaid` is updated, so the closing epoch already capitalizes on the pre-repayment base. The bug therefore only understates the **next** epoch's accrual — the regression test must advance time past a repayment to observe it.
- **Risk (low):** `immutable.original_senior_tranche - cumulative.senior_principal_repaid` is a `u128` subtraction; removing it also removes a latent underflow path (repaid can equal the tranche at full repayment). The flat base has no such subtraction, so this is strictly safer.
- **Risk (low):** existing test `interest_accrues_and_payment_is_recorded` asserts pre-repayment behaviour only (max_interest at t=YEAR before the payment); it is unaffected because the closing epoch capitalizes on the full base regardless. Verified against the numbers below.
- **Cross-repo mechanics:** the code + test live in `pipeline-stellar-contracts` (branch `fix/975-flat-accrual-base`, draft PR #29); the Issue lives in `eq-lab/pipeline`. Cross-repo `Closes` does not auto-close, so #975 is closed manually after merge. The exec plan itself lives in the `pipeline` repo under `docs/exec-plans/active/`.

## Open Questions

_None._

## Implementation Steps

1. **`contracts/loan-registry/src/storage.rs`, `append_economics_epoch` (main lines 176–180)** — remove the declining base:
   ```rust
   let factor = last_epoch_interest_factor(e, loan_id);
   let immutable = get_immutable(e, loan_id);
   let last_epoch_interest = factor * immutable.original_senior_tranche / ONE;
   ```
   Delete the `let cumulative = get_cumulative_repayment(e, loan_id);` and `let outstanding = …;` lines (cumulative is no longer used in this function).

2. **`contracts/loan-registry/src/storage.rs`, `calculate_max_interest` (main lines 210–212)** — same base swap:
   ```rust
   let factor = last_epoch_interest_factor(e, loan_id);
   let last_epoch_interest = factor * immutable.original_senior_tranche / ONE;
   ```
   Delete the `let outstanding = …;` line. Keep `cumulative` — it is still used for `- cumulative.senior_interest`.

3. Update the doc comments on both functions if they mention "outstanding"/declining base (they currently do not, but confirm the `append_economics_epoch` comment still reads correctly after the change).

## Test Strategy

Add a regression test to `contracts/loan-registry/src/test.rs` (Soroban in-crate `test.rs` convention — this repo's established pattern, distinct from the `pipeline` external-test rule). Model it on `interest_accrues_and_payment_is_recorded` using the existing `setup()`, `draw_default_loan`, `exec_via_access_manager`, and constants (`DEFAULT_SENIOR_TRANCHE = 1_000_000_000`, `DEFAULT_RATE = ONE/10`, `ONE = 1_000_000`, `YEAR = 31_557_600`).

**New test `interest_accrues_on_flat_original_tranche_after_principal_repayment`:**
1. Draw the default loan at t=0.
2. Advance to `t = YEAR`; repay `senior_principal_repaid = 100_000_000` (10% of the tranche), `senior_interest = 0` (isolate principal). This appends epoch 1, capitalizing epoch 0's `100_000_000` on the full base, and sets cumulative principal repaid to `100_000_000`.
3. Advance to `t = 2*YEAR`.
4. Assert `s.registry.max_interest(&loan_id) == 200_000_000`:
   - epoch 1 accrued (capitalized) = `100_000_000`,
   - open-epoch accrual on the **flat** base = `factor(=100_000) * 1_000_000_000 / ONE = 100_000_000`,
   - minus `senior_interest` paid (`0`) ⇒ `200_000_000`.
   Under the bug this reads `190_000_000` (open-epoch accrual on the declining `900_000_000` base = `90_000_000`), so the assertion fails pre-fix and passes post-fix.

Optionally assert the intermediate `max_interest == 100_000_000` at `t = YEAR` before the repayment, mirroring the existing test, to document that the closing epoch is unaffected.

Run: `cargo test -p loan-registry` (or the repo's `make test` / workspace equivalent) in `pipeline-stellar-contracts`, plus `cargo fmt --check` and `cargo clippy`.

## Docs to Update

- **None.** The product specs (`docs/product-specs/loans-data.md`, `docs/product-specs/yield.md`) already state the flat `originalSeniorTranche` base; this fix brings the contract into line with the existing spec rather than changing documented behaviour.
