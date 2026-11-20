# User Stories: #2123 — Waterfall: reject quotational offtaker overpayment like both contracts (OfftakerExceedsPrice)

Epic: [#2129 — Math correctness](https://github.com/eq-lab/pipeline/issues/2129)
Issue: [#2123](https://github.com/eq-lab/pipeline/issues/2123)
Spec: [docs/product-specs/yield.md](../../product-specs/yield.md#waterfall-components)

Trustee app (`packages/trustee`), Record Repayment on a loan, against an API that includes the #2123 fix.

---

## Story 1: Concentrate loan, amount above the remaining contracted price

**Persona:** Trustee previewing a final settlement on a metal-concentrate loan.

**Pre-conditions:** Loan whose collateral valuation mode is `MetalConcentrate`; `offtaker_outstanding` is positive.

**Steps:**

1. Open Record Repayment for the loan and enter an amount above the served offtaker outstanding.

**Expected outcomes:**

- `GET /v1/loan-book/{loan_id}/waterfall` answers `400` ("exceeds the loan's outstanding offtaker balance").
- The page shows "This amount is too high for this loan. Enter a smaller amount." and no split.
- Nothing is recordable.

---

## Story 2: Concentrate loan, exactly the remaining contracted price

**Persona:** Trustee previewing the last payment on a metal-concentrate loan.

**Pre-conditions:** Same loan as Story 1.

**Steps:**

1. Enter an amount equal to the served offtaker outstanding.

**Expected outcomes:**

- `/waterfall` answers `200` with the split and `offtaker_fully_received` set to `true`.
- The split can be recorded on-chain without `OfftakerExceedsPrice`.

---

## Story 3: Response shape

**Persona:** API consumer.

**Pre-conditions:** Any loan.

**Steps:**

1. Call `GET /v1/loan-book/{loan_id}/waterfall?chain_id=...&amount=...` with a valid amount.

**Expected outcomes:**

- The body has no `offtaker_overpaid` key.
- `offtaker_fully_received` is still served.
