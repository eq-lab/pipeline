# User story: #2124 — Waterfall keeps all interest when the fee cap binds

**Epic:** #2129
**Issue:** https://github.com/eq-lab/pipeline/issues/2124
**Status:** Initial

---

## Overview

When management + performance fees exceed `max_fee_bps` of the interest, `GET /v1/loan-book/{loan_id}/waterfall` moves the excess fee to the net coupon instead of dropping it into principal or equity. Spec: `docs/product-specs/yield.md` (Waterfall components).

Persona: Trustee on Record Repayment, or an API caller of `GET /v1/loan-book/{loan_id}/waterfall`.

---

## Story 1 — Suggested interest equals the headroom

**Given** a 1,000,000 senior loan at 5% with mgmt 3% and perf 20% fees, `max_fee_bps = 5000`, one year after origination and an `amount` of 50,000

**When** the Trustee opens Record Repayment

**Then:**

- Net coupon, management fee and performance fee sum to the 50,000 interest headroom
- Fees equal exactly `floor(50,000 × 5000 / 10,000) = 25,000` (mgmt 22,059 + perf 2,941) and the net coupon is 25,000
- Senior principal and equity are 0

---

## Story 2 — A later as-of still proposes interest

**Given** the Story 1 suggestion was recorded and a later `as_of` one year on

**When** the Trustee asks for the waterfall again

**Then:**

- The proposal is non-zero interest for the new headroom (25,000 / 22,059 / 2,941), never 0

---

## Story 3 — The recorded payment is accepted on-chain

**Given** the Story 1 split submitted through `recordPayment`

**When** the contract validates it

**Then:**

- `mgmt_fee + perf_fee + oet_alloc ≤ floor((senior_interest + mgmt_fee + perf_fee) × max_fee_bps / 10,000)` holds
- The call does not revert with `FeesExceedCap` or `InterestExceedsMax`
