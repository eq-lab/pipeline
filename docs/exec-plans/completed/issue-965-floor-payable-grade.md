# Issue #965: Payable grade is not floored at zero — a metal below its minimum deduction subtracts value

Source: https://github.com/eq-lab/pipeline/issues/965

## Scope

Fix a valuation bug in `ConcentrateInputs::valuate` (`packages/shared/src/collateral_valuation/mod.rs`). The per-metal `payable_grade = grade * payable_pct - min_deduction` is never clamped at zero. When a metal's grade sits below its minimum deduction (a normal, non-exotic case — e.g. silver at 85% payable less 30 g/dmt zeroes out below ~35.3 g/dmt Ag), `payable_grade` goes negative, which:

- **understates** `gross_value` (a negative contribution instead of zero), and
- **credits** a negative `refining_charge` the contract never grants.

The physical offtake pays **zero** for such a metal, never negative. The fix clamps `payable_grade` at zero, mirroring the penalty loop directly below (which already does `.max(BigDecimal::zero())` on its `steps`).

**In scope:**
- One-line clamp in `valuate`.
- A regression unit test for a metal below its minimum deduction.
- A one-line clarification to the spec formula noting the zero floor.

**Out of scope:**
- Any change to penalty, treatment-charge, or haircut math.
- Any change to `compute_collateral` assembly or the DB/repo layer.
- Behaviour when *every* metal floors to zero (the existing NSR/haircut waterfall handles a zero/negative NSR unchanged; `ccr_bps` already guards non-positive collateral).

## Assumptions and Risks

- **Assumption:** Clamping per metal (not on the summed `gross_value`) is correct — each metal is an independent payable line, so one metal below its floor must not net against another metal's positive contribution. This matches the offtake and the issue's stated expectation.
- **Assumption:** Only `gross_value` and `refining_charge` are affected per metal; both are driven by the same `payable_oz`, so clamping `payable_grade` fixes both in one place.
- **Risk (low):** The existing worked-example test (`concentrate_matches_spec_worked_example`) uses grades well above their deductions, so it is unaffected by the clamp. Verified: gold 50 g/t × 0.80 − 1 = 39 > 0; silver 200 × 0.90 − 5 = 175 > 0.
- **Risk (none identified):** No callers depend on a negative `payable_grade`/`refining_charge`; a negative refining charge is nonsensical, so nothing legitimately relies on the current behaviour.

## Open Questions

_None._

## Implementation Steps

1. **`packages/shared/src/collateral_valuation/mod.rs`, line 164** — clamp `payable_grade` at zero:
   ```rust
   let payable_grade =
       (&m.grade_g_per_t * &m.payable_pct - &m.min_deduction_g_per_t).max(BigDecimal::zero());
   ```
   `BigDecimal::zero()` is already in scope (used on line 176 and elsewhere in the file). Keep the surrounding lines (`payable_mass`, `payable_oz`, `gross_value`, `refining_charge`) unchanged.

2. **Doc comment** — update the formula in the `valuate` doc comment (line 155) from
   `payable_oz = (grade * payable_pct - min_deduction) * quantity / 31.1035`
   to note the floor, e.g. `payable_oz = max(0, grade * payable_pct - min_deduction) * quantity / 31.1035`, so the code comment matches the behaviour.

3. **`docs/product-specs/collateral-valuation.md`, line 40** — update the formula in the waterfall block from
   `payable_metal    = (grade * payable_pct - min_deduction) * quantity`
   to
   `payable_metal    = max(0, grade * payable_pct - min_deduction) * quantity`
   and add a short sentence noting that a metal whose grade is below its minimum deduction pays zero (never negative), matching the offtake — consistent with how penalty `steps` already floor at zero.

## Test Strategy

Add a unit test to `packages/shared/tests/collateral_valuation.rs` (external test file per project convention; pure unit test, no DB). Use the existing `gold_pyrite_example()`/`bd()`/`approx()` helpers.

- **New test `metal_below_min_deduction_contributes_zero`:** build a `ConcentrateInputs` with a single metal whose `grade_g_per_t * payable_pct < min_deduction_g_per_t` (e.g. the issue's repro: grade 35.00, payable 0.85, min deduction 30 → payable grade −0.25). Assert:
  - `gross_value == 0` (exactly zero, or `approx` to 0.0), and
  - `refining_charge == 0`,
  rather than the negative values the bug produced (issue repro: gross −175,542.95, refining credit −16.72 at qty 5,200 / price 4,200 / rc 6).
- **Optional second assertion in the same test:** a two-metal input where one metal floors to zero and the other is positive — assert the floored metal adds nothing and the positive metal's contribution is unchanged from valuing it alone (proves per-metal, not summed, clamping).
- **Regression guard:** confirm `concentrate_matches_spec_worked_example` still passes unchanged (grades are above their deductions, so the clamp is a no-op there).

Run: `cargo test -p shared --test collateral_valuation` plus the repo's standard fast lint/build gate.

## Docs to Update

- `docs/product-specs/collateral-valuation.md` — formula on line 40 + one clarifying sentence (step 3 above).
- Doc comment in `packages/shared/src/collateral_valuation/mod.rs` `valuate` (step 2 above).
