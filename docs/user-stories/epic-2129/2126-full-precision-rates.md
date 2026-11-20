# User story: #2126 — Rates keep their full 1e6 precision end to end

**Epic:** #2129
**Issue:** https://github.com/eq-lab/pipeline/issues/2126
**Status:** Initial

---

## Overview

The indexer and API carry a loan's on-chain rate as ppm (`ONE = 1,000,000`) instead of flooring it to whole bps, so the waterfall proposes exactly the interest the contract has accrued. Specs: `docs/product-specs/yield.md` (Waterfall components), `docs/product-specs/book-rate-weighting.md`, `docs/references/backend.md` (LoanRegistry rate ppm backfill).

Persona: Trustee on Record Repayment, or an API caller of `GET /v1/loan-book/{loan_id}/waterfall` and `GET /v1/loan-book`.

---

## Story 1 — A fractional-rate loan's waterfall equals the contract's accrued interest

**Given** a loan with 1,000,000 outstanding senior (6 dp) at a 7.255% rate (72,550 ppm), one contract year after its draw

**When** the Trustee opens Record Repayment

**Then:**

- Net coupon, management fee and performance fee sum to 72,550 (the contract's `_accruedInterest`), not 72,500
- After a mid-life `EconomicsAmended` to a fractional rate, the proposal still equals the contract value

---

## Story 2 — A default does not change the proposed interest

**Given** a fractional-rate loan with a `LoanDefaulted` event in the middle of its life

**When** the Trustee asks for the waterfall after the default

**Then:**

- The gross interest floors once over the whole epoch, as the contract does (a default does not open an epoch), so it is not 1 unit lower than the on-chain value

---

## Story 3 — The loan book shows the exact rate

**Given** a loan whose current rate is 72,550 ppm

**When** the LP or Trustee opens the loan book

**Then:**

- The per-loan `rate` reads `0.072550`
- The book `avg_yield` weights the exact ppm: two equally outstanding loans at 72,550 and 100,000 ppm give `0.086275`

---

## Story 4 — Existing loans are corrected on the next worker start

**Given** snapshot rows written before this change, with only the floored bps fields

**When** the worker starts

**Then:**

- Each loan whose stored bps matches the on-chain rate gets `senior_interest_rate_ppm` and `current_rate_ppm` written on every row
- A restart finds nothing left to backfill; a loan that fails the check is skipped with a warning and retried on the next start
