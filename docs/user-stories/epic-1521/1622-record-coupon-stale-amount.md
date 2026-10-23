# User Stories: #1622 — Trustee: Record Coupon can submit a stale (pre-debounce) amount

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1622](https://github.com/eq-lab/pipeline/issues/1622)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#record-action-gating-1622-both-flows)

Trustee app (`packages/trustee`) against a staging API, signed in, on a loan's Record Coupon page. No Figma: this restores intended behaviour of the existing page.

---

## Story 1: A click during the debounce window cannot record the previous amount

**Persona:** Trustee recording a coupon.

**Pre-conditions:** Open `/loans/<id>/record-coupon`.

**Steps:**

1. Type `50,000` and wait until "Record on the ledger" is enabled.
2. Append a `0` (the input reads `500,000`) and try to click the button immediately.

**Expected outcomes:**

- The button is disabled the moment the input changes; the click does nothing and no wallet prompt opens.
- Once the preview for `500,000` resolves the button enables; recording sends `offtaker_received` for $500,000 with that amount's components.

---

## Story 2: Clearing the amount disables recording at once

**Persona:** Trustee correcting a typo.

**Pre-conditions:** Story 1 step 1 (button enabled at `50,000`).

**Steps:**

1. Clear the amount input.

**Expected outcomes:**

- The button is disabled immediately and stays disabled; nothing can be recorded.

---

## Story 3: The summary never contradicts the input

**Persona:** Trustee typing a new amount.

**Pre-conditions:** Story 1 step 1 (summary reads "Components sum to received $50,000").

**Steps:**

1. Change the amount to `500,000`.

**Expected outcomes:**

- The green summary (and the terminal hint, if shown) disappears while the new amount settles.
- It reappears reading "Components sum to received $500,000" once the preview resolves.

---

## Story 4: Record Repayment keeps the same gate

**Persona:** Trustee recording a final principal repayment.

**Pre-conditions:** Open `/loans/<id>/record-repayment` for a loan with an offtaker balance owed.

**Steps:**

1. Load the page and watch "Record on the ledger".

**Expected outcomes:**

- The button stays disabled until the prefilled full amount has settled and its preview resolved; it then records the prefilled amount.
