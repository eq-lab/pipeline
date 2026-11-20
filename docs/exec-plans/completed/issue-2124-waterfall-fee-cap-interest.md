# Issue #2124: Waterfall: interest leaks into principal/equity when the fee cap binds

Source: https://github.com/eq-lab/pipeline/issues/2124

Parent epic: #2129 (math correctness, 2026-11-19 review). Siblings in the same file:
#1547 (read on-chain `max_fee_bps` instead of `ASSUMED_MAX_FEE_BPS`) and #2123 (offtaker
ceiling for quotational loans).

## Scope

`compute_waterfall` (`packages/api/src/routes/waterfall.rs`) loses interest when the
per-payment fee cap binds. `cap_interest_fees` shrinks mgmt + perf to
`floor(coupon × max_fee_bps / (10_000 − max_fee_bps))` but does not give the removed amount
back to the coupon, so it falls through to OET / principal / equity. The issue example
(1,000,000 senior, 5%, mgmt 3%, perf 20%, `max_fee_bps = 5000`, one year, headroom 50,000)
proposes coupon 16,000 + fees 15,999 (14,117 + 1,882) and leaks 18,001. On the next call the
coupon target clips to 0, the fee limit becomes 0, and the API proposes 0 interest.

### What the deployed contracts enforce (frozen, read only)

Both chains enforce the same rules. EVM `pipeline-contracts`
`src/loanRegistry/LoanRegistryUpgradeable.sol` `_validateRepayment` (lines 548-583, the same
at deployed `f92d719` and at `main` `150631a`). Stellar `pipeline-stellar-contracts`
`contracts/loan-registry/src/lib.rs` `validate_repayment` (lines 853-894):

1. `senior_interest ≤ accrued_interest`, where
   `accrued_interest = max(0, gross + interest_adjustment − recorded(senior_interest + mgmt_fee + perf_fee))`
   (EVM `_accruedInterest`; Soroban `storage.rs::accrued_interest`). Only `senior_interest` is
   checked against it.
2. `mgmt_fee + perf_fee + oet_alloc ≤ fee_cap`, where
   `fee_cap = floor((senior_interest + mgmt_fee + perf_fee) × max_fee_bps / 10_000)`
   (integer division, so it rounds down; the check reverts only on `>`, so equality is
   accepted). `max_fee_bps` is `uint32` / `u32`, 5000 on Hoodi and on Stellar
   testnet/futurenet/mainnet.
3. In `Default`: fees, OET and equity must be 0.

For integers, `F ≤ floor(I × b / 10_000)` (with `I = c + F`) is the same condition as the
current code's `F ≤ floor(c × b / (10_000 − b))`. The current limit is correct. The defect is
that it shrinks `I` instead of moving the excess from fees to the coupon.

### Target behaviour

Write `I = c + mgmt + perf` (the interest tier) and `F = mgmt + perf`.

- **Headroom (API policy, unchanged):** `I ≤ headroom`. This is stricter than the contract's
  `c ≤ headroom`. It is kept because the contract counts fees against the same accrued pool, so
  recording fees on top of a full-headroom coupon would charge more than accrued interest. The
  issue example (50,000 total = headroom) confirms this reading.
- **Fee cap:** `F + oet ≤ floor(I × max_fee_bps / 10_000)`.
- **Never shrink `I` for the cap.** When `F` exceeds the cap, set `F` to exactly
  `floor(I × max_fee_bps / 10_000)` and move the rest to the coupon (`c = I − F`). Interest
  then goes to principal or equity only when the amount is larger than the headroom-bounded
  interest tier.
- Example: `I = 50,000` gives cap 25,000, mgmt 22,059, perf 2,941, coupon 25,000, leak 0.
  This matches the issue table. The contract check is `25,000 ≤ floor(50,000 × 5000 / 10_000) = 25,000`.

This reverses the "freed amounts cascade to the equity residual" clause of #1524 decision R2
(`docs/exec-plans/completed/issue-1524-loanbook-outstanding.md`). The issue asks for that
reversal explicitly.

### In scope

- Replace `cap_interest_fees` with a pure, `pub` rebalancing helper that takes `max_fee_bps`
  as a parameter. Thread the same parameter into `oet_room_under_cap`.
- Update the module-doc "Contract bounds" paragraph in `waterfall.rs`, `yield.md`, and
  trustee-dashboard flow note A.
- Regression tests: the issue example (shortfall, exact-interest, full repayment), the
  next-call-after-leak scenario, the second year, Stellar raw scale, and direct tests of the
  helper with `max_fee_bps` ∈ {0, 2000, 5000, 10000}. Update three existing tests that pin the
  leaking behaviour.
- A user-stories doc for epic #2129.

### Out of scope

- Reading `max_fee_bps` from chain (#1547). This plan only makes that change a one-line swap.
- Offtaker ceiling and `offtaker_overpaid` (#2123).
- The headroom fit before the cap (fees first when `F_target > headroom`, else coupon clipped
  to `headroom − F_target`) and the proportional shortfall split. Both stay as they are. The
  new step runs after them and keeps `I` unchanged.
- OET priority. OET stays a lower tier that only uses room left under the cap. When the cap
  binds, OET gets 0 and its target goes to principal / equity, as today. OET is not interest,
  so this is not the leak the issue describes.
- The `Default` path (`default_breakdown`). It records no fees, so the cap is always met.
- Any contract or frontend change.

## Assumptions and Risks

- **A1: the contract formula is identical on both chains and at the deployed EVM commit.**
  Verified: `git show f92d719:src/loanRegistry/LoanRegistryUpgradeable.sol` lines 554-572
  match `main`. Stellar `main` `e9881ac` lines 877-882. No chain-specific branch is needed.
- **A2: rounding.** The cap uses floor, like the contract. `F` is set to exactly the cap.
  `perf = floor(cap × perf_in / F_in)` and `mgmt = cap − perf`. That makes mgmt the ceiling of
  its proportional share, which is always ≤ `mgmt_in` because `cap < F_in`. So both fee legs
  stay within their targets, `F` takes the whole cap, and `c + mgmt + perf = I` holds exactly.
- **A3: rebalancing is applied after the proportional shortfall split.** The cap is checked
  against what is actually paid. The rebalance keeps `I`, so the result stays within headroom
  and within `amount`. Truncation dust (≤ 2 units) from the proportional split still flows to
  OET, as in `interest_tier_shortfall_dust_flows_to_the_next_tier_not_lost`. That is unchanged.
- **R1: fee revenue.** When the configured fee rates always exceed the cap (as in the example:
  fees are 68% of gross with a 50% cap), unpaid mgmt / perf targets build up across payments.
  They are never caught up, because the cap binds every time. The coupon (vault) receives that
  interest. This is the economic result of the contract's cap, not a new policy. The cap was
  already set at that level and the Trustee can still override (flow note A).
- **R2: merge conflicts with #1547 and #2123** (the epic says to land them one after another).
  To keep conflicts small:
  - `compute_waterfall`'s signature does **not** change. Inside it, one line
    `let max_fee_bps = ASSUMED_MAX_FEE_BPS;` feeds both helpers. #1547 replaces that line with a
    parameter or the on-chain value and changes the signature itself.
  - The helpers take `max_fee_bps: u32` (the on-chain type on both chains), so #1547 passes the
    value it reads without conversion.
  - `ASSUMED_MAX_FEE_BPS` changes from `i64` to `u32` so it fits the helper parameter. In tests,
    `BigDecimal::from(ASSUMED_MAX_FEE_BPS)` still compiles because `From<u32>` exists. #1547 may
    delete the constant. That is a trivial conflict.
  - #2123 edits stage 3 (lines ~435-462) and the module-doc stage-3 text. This plan edits lines
    ~503-543 and 602-634 and the "Contract bounds" paragraph. Test-file conflicts are limited to
    appended tests. #2123 may change `waterfall_accrual.rs::run` (it uses
    `PricingBasis::Quotational` with `HUGE_AMOUNT`, which #2123 will reject). This plan only
    edits the assertions of `over_recorded_fee_legs_*` in that file.
  - Whichever lands second rebases. #1547's tests can call the new
    `fit_interest_to_fee_cap(.., max_fee_bps)` directly with other bps values.
- **R3: comment rule.** AGENTS.md asks for comment-free code. `waterfall.rs` already has a
  large legacy module doc. Edit only the paragraph that becomes wrong ("Contract bounds") and
  add no new doc comments on the new helper. The rationale lives in `yield.md` and in this plan.
- **A4: no DB or env access in tests.** All tests are pure calls to `compute_waterfall` or the
  helper, in `packages/api/tests/`.

## Open Questions

_None_

## Implementation Steps

1. **`packages/api/src/routes/waterfall.rs`: constant type.** Change
   `pub const ASSUMED_MAX_FEE_BPS: i64 = 5_000;` to `pub const ASSUMED_MAX_FEE_BPS: u32 = 5_000;`.

2. **Replace `cap_interest_fees` (lines ~602-622) with a pure `pub` helper:**

   ```rust
   pub fn fit_interest_to_fee_cap(
       coupon: BigDecimal,
       management_fee: BigDecimal,
       performance_fee: BigDecimal,
       max_fee_bps: u32,
   ) -> (BigDecimal, BigDecimal, BigDecimal)
   ```

   - `fees = mgmt + perf` and `total = coupon + fees`.
   - If `i64::from(max_fee_bps) >= BPS_DENOM` or `fees.is_zero()`, return the inputs unchanged.
   - `cap = trunc(total × max_fee_bps / BPS_DENOM)` (floor, as the contract does).
   - If `fees <= cap`, return the inputs unchanged.
   - Otherwise `perf' = trunc(cap × perf / fees)`, `mgmt' = cap − perf'` and
     `coupon' = total − cap`. Return `(coupon', mgmt', perf')`.
   - Postconditions (the tests check these): `coupon' + mgmt' + perf' == total`,
     `mgmt' ≤ mgmt`, `perf' ≤ perf`, and `mgmt' + perf' ≤ floor(total × max_fee_bps / 10_000)`.

3. **`oet_room_under_cap` (lines ~624-634):** add a `max_fee_bps: u32` parameter and use it in
   place of `ASSUMED_MAX_FEE_BPS`. Keep the formula `max(0, floor((c + F) × b / 10_000) − F)`.

4. **`compute_waterfall`, interest-tier block (lines ~523-543):**
   - Add `let max_fee_bps = ASSUMED_MAX_FEE_BPS;` once, just before the cap step. This is the
     single line #1547 replaces.
   - Replace

     ```rust
     let (management_fee, performance_fee) =
         cap_interest_fees(&senior_coupon_net, management_fee, performance_fee);
     ```

     with

     ```rust
     let (senior_coupon_net, management_fee, performance_fee) =
         fit_interest_to_fee_cap(senior_coupon_net, management_fee, performance_fee, max_fee_bps);
     ```

     (rebind all three).
   - Pass `max_fee_bps` to `oet_room_under_cap`.
   - Leave the headroom fit (lines ~503-510), the proportional split (lines ~523-535), the
     `remaining` bookkeeping, OET, principal and equity unchanged.

5. **Module doc "Contract bounds" paragraph (lines ~85-89):** rewrite it in 2-3 sentences. The
   interest tier `c + mgmt + perf` is bounded by the headroom. The contract fee cap
   `mgmt + perf + oet ≤ floor((c + mgmt + perf) × max_fee_bps / 10_000)` is met by moving any
   fee excess to the coupon, so the tier total stays the same. OET uses only the room left
   under the cap. Point to `docs/product-specs/yield.md` § Waterfall components. Do not touch
   the stage-3 text (#2123 owns it).

6. **`cargo clippy --all -- -D warnings`** and **`cargo test -p pipeline-api --test waterfall
   --test waterfall_accrual`**. Then run the full `cargo test -p pipeline-api`.

## Test Strategy

All tests are pure unit tests in the existing files. No DB, no env.

### New tests in `packages/api/tests/waterfall.rs` (section "Fee cap binds: interest is not leaked (#2124)")

Fixture for the issue example: `snapshot("1000000", "0", 500)`, `fees(300, 2000, 0)`,
`ONE_YEAR_LATER`, `genesis(&s)` and `PricingBasis::Fixed`. Targets: gross 50,000, mgmt 30,000,
perf 4,000, coupon 16,000, headroom 50,000. Expected values below were checked by hand and with
a script.

1. `fee_cap_issue_2124_example_pays_all_headroom_as_interest`: `amount = 50000` gives coupon
   25,000, mgmt 22,059, perf 2,941, OET 0, principal 0, equity 0. Fees equal exactly 25,000,
   and `assert_within_fee_cap` passes. Before the fix this was 16,000 / 14,117 / 1,882 with
   18,001 in principal.
2. `fee_cap_issue_2124_full_repayment_leaks_nothing_to_principal_or_equity`:
   `amount = 1050000` gives the same interest split, principal 1,000,000, equity 0, and
   `senior_principal_fully_repaid`.
3. `fee_cap_shortfall_pays_the_whole_amount_as_interest`: `amount = 30000` gives coupon 15,000,
   mgmt 13,236, perf 1,764, and principal 0.
4. `fee_cap_next_call_after_a_leaked_payment_still_proposes_interest` (the issue's "next call"
   row): `snapshot_with_repayment` with recorded senior_interest 16,000, mgmt 14,117, perf
   1,882 (what the old API proposed), principal repaid 0, same `as_of`, and `amount = 100000`.
   Headroom is 18,001. Expect coupon 9,001, mgmt 7,942, perf 1,058 (interest 18,001, not 0),
   OET 0, principal 81,999. Assert within the fee cap.
5. `fee_cap_second_year_pays_the_new_headroom_as_interest`: recorded 25,000 / 22,059 / 2,941,
   `as_of = ORIGINATION + 2 * CONTRACT_YEAR`, and `amount = 50000`. Expect 25,000 / 22,059 /
   2,941 again.
6. `fee_cap_binds_at_stellar_raw_scale`: `snapshot("10000000000000", "0", 500)`, `fees(300,
   2000, 0)`, and `amount = 500000000000`. Expect coupon 250,000,000,000, mgmt 220,588,235,295,
   perf 29,411,764,705, and principal 0.

### Direct tests of `fit_interest_to_fee_cap` (same file; import it from `pipeline_api::routes::waterfall`)

Inputs `(16000, 30000, 4000)`. Each case also asserts the four postconditions from step 2.

7. `max_fee_bps = 5000` gives `(25000, 22059, 2941)`.
8. `max_fee_bps = 2000` gives `(40000, 8824, 1176)` (the Anvil / Stellar-test value, a preview
   for #1547).
9. `max_fee_bps = 0` gives `(50000, 0, 0)`.
10. `max_fee_bps = 10000` gives the inputs unchanged.
11. Not binding: `(88000, 10000, 22000)` at 5000 gives the inputs unchanged.
12. Odd total: `(16001, 30000, 4000)` at 5000 gives `(25001, 22059, 2941)`. Fees equal
    `floor(50001 × 5000 / 10000) = 25000`, so the floor direction is pinned.
13. Zero fees: `(500, 0, 0)` at 5000 gives the inputs unchanged (no division by zero).

### Existing tests whose expected values change

Each currently pins the leak.

- `packages/api/tests/waterfall.rs::heavy_waiver_scales_fees_to_the_cap_and_frees_the_rest_to_equity`.
  Rename it to `heavy_waiver_shifts_capped_fees_to_the_coupon`. Gross 20,000 (mgmt target
  10,000, perf 2,000, coupon 8,000) gives coupon 10,000, mgmt 8,334, perf 1,666, OET 0,
  principal 1,000,000, and equity 3,980,000. The total of 5,000,000 is still asserted.
- `packages/api/tests/waterfall.rs::interest_adjustment_is_cumulative_against_recorded_interest`.
  Headroom 50,000, targets coupon 22,000, mgmt 10,000, perf 18,000 (fees 28,000 > cap 25,000).
  Coupon goes from 22,000 to 25,000. Also assert mgmt 8,929 and perf 16,071.
- `packages/api/tests/waterfall_accrual.rs::over_recorded_fee_legs_drop_the_coupon_and_scale_the_fees`.
  Rename it to `over_recorded_fee_legs_still_pay_the_headroom_under_the_fee_cap`. Headroom
  10,000,000,000 gives coupon 5,000,000,000, mgmt 0, perf 5,000,000,000, and
  `suggested_interest(&b) == room`. Before the fix all three were 0.

Every other existing test keeps its values. With `fees(100, 2000, 50)` at 12%, fees are 26.7%
of gross, so the cap does not bind. `oet_is_trimmed_to_the_room_left_under_the_cap` and
`prior_recorded_amounts_and_adjustment_clamp_the_coupon_to_the_headroom` were recomputed and do
not change. If any other assertion fails, recompute it with the algorithm above. Do not loosen it.

## Docs to Update

- `docs/product-specs/yield.md` § Waterfall components, the paragraph after the table (line
  ~56). After "(net coupon first, then fees)", add:

  > The contract fee cap `mgmt_fee + perf_fee + oet_alloc ≤ floor((senior_interest + mgmt_fee + perf_fee) × max_fee_bps / 10_000)` is met by moving any fee excess above the cap to the net coupon. The suggested interest total is never reduced for the cap, and OET only uses the room left under it (#2124).
- `docs/product-specs/trustee-dashboard.md` flow note A (the **Shipped** sentence, line ~77):
  add one clause saying the baseline respects the registry fee cap by moving the excess fee to
  the net coupon, and link to `yield.md`.
- `docs/user-stories/epic-2129/2124-waterfall-fee-cap-interest.md` (new; create the directory
  if it does not exist yet). Use the format of `docs/user-stories/epic-2029/*.md`. Persona:
  Trustee on Record Repayment, or an API caller of `GET /v1/loan-book/{id}/waterfall`.
  - Story 1: a loan whose fees are above `max_fee_bps` of interest. The suggested coupon +
    fees equal the interest headroom, and fees equal exactly
    `floor(interest × max_fee_bps / 10_000)`.
  - Story 2: after recording that suggestion, a later as-of proposes non-zero interest.
  - Story 3: the recorded payment is accepted on-chain (no `FeesExceedCap` /
    `InterestExceedsMax`).
- `docs/user-stories/index.md`: add an "Epic #2129 — Math correctness" section (if no sibling
  has added it yet) with a row for #2124, status `Initial`.
- No `known-bugs.md` or `tech-debt-tracker.md` entry: this fixes the bug and adds no shortcut.
  The `max_fee_bps` assumption is already tracked by #1547.
