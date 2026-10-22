# User Stories: #1620 — Loan submission economics are human-unit USDC, converted exactly at draw

Issue: [#1620](https://github.com/eq-lab/pipeline/issues/1620) (critical — wrong amount on-chain)
Spec: [docs/frontend/trustee-flows.md#data-layer-useloansubmissions](../../frontend/trustee-flows.md#data-layer-useloansubmissions)

Trustee app (`packages/trustee`) + LP dashboard (`packages/frontend`) against staging. **Existing
staging submissions were typed under the old base-unit reading and now display 10^7× too large;
re-enter them in human units before running these.** Story 3 sends a real `draw_loan` on the
Stellar testnet with the trustee wallet.

---

## Story 1: The form takes human-unit USDC and rejects what the chain can't represent

**Persona:** Trustee submitting a loan.

**Steps:**

1. On `/origination/new` read the four money labels; type `1200000.00` in Facility size, `1000000.00` senior, `200000.00` equity, `1250000.00` offtaker price.
2. Change Facility size to `0.1234567`, then to `1,200,000`.

**Expected outcomes:**

- Labels read "… (USDC, up to 6 decimals)"; the placeholder is `1200000.00`.
- Step 1 submits; the POST body carries the strings exactly as typed.
- Step 2: each value shows "Must be a USDC amount with at most 6 decimals, e.g. 1200000.00." and Submit stays disabled — nothing is truncated.

---

## Story 2: Review screens show the submitted dollars

**Persona:** Trustee reviewing the Story 1 submission.

**Expected outcomes:**

- The origination table's Facility reads `$1.2M`; the detail page's Loan Terms read Facility `$1,200,000`, Senior `$1,000,000`, Equity `$200,000`, Offtaker price `$1,250,000`.
- The LP Protocol Dashboard's In Origination tab shows Facility `$1.2M` for the same row.

---

## Story 3: Approve draws the exact on-chain amount

**Persona:** Trustee approving the Story 1 submission (Stellar target).

**Steps:**

1. Approve & draw; inspect the `draw_loan` invocation in the Stellar explorer.

**Expected outcomes:**

- The economics map carries `original_facility_size = 12000000000000` (12,000,000,000,000 base units = $1.2M at 7 decimals), senior `10000000000000`, equity `2000000000000`, offtaker `12500000000000`.
- After indexing, the Loans page shows the loan with Senior outstanding `$1.00M`-scale figures, not `$0.10`.
