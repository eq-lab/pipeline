# User Stories: #1623 — Trustee: coupon covering principal goes to equity while the screen says it repays senior; loan can't be closed

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1623](https://github.com/eq-lab/pipeline/issues/1623)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#record-coupon--interest-only-context-dependent-third-row)

Trustee app (`packages/trustee`) against a staging API, signed in, on a Stellar loan with senior principal outstanding. No Figma: the notice reuses the page's existing warning styling.

---

## Story 1: An interest-only coupon records with principal 0

**Persona:** Trustee recording the scheduled coupon.

**Pre-conditions:** Open `/loans/<id>/record-coupon?chain=<stellar>`.

**Steps:**

1. Enter an amount around the scheduled coupon (not above interest + OET).
2. Check the Network tab for the `/waterfall` response.

**Expected outcomes:**

- `senior_principal_returned` is `"0"`; no principal notice is shown.
- The green summary reads "Components sum to received $X" and "Record on the ledger" is enabled.
- Recording sends `senior_principal_repaid: "0"` and the six components sum to `offtaker_received`.

---

## Story 2: A coupon covering senior principal is blocked

**Persona:** Trustee holding a wire of at least interest + senior principal.

**Pre-conditions:** Story 1 pre-conditions.

**Steps:**

1. Enter an amount of at least interest + outstanding senior (for example `1,900,000` against $1,840,000 senior).

**Expected outcomes:**

- A warning notice states the amount includes the served senior principal figure (for example $1,840,000) and that a coupon records interest only.
- "Record Repayment" in the notice links to `/loans/<id>/record-repayment` for the same chain.
- The green summary is hidden and "Record on the ledger" stays disabled.
- The old "This coupon fully repays senior principal" hint never appears.
- Changing to an interest-only amount removes the notice immediately and re-enables recording once the preview settles.

---

## Story 3: After an interest-only coupon the loan can still be closed

**Persona:** Trustee finishing the loan.

**Pre-conditions:** An interest-only coupon was recorded (Story 1); the offtaker still owes at least the outstanding senior.

**Steps:**

1. Open `/loans/<id>/record-repayment`.
2. Record the prefilled full-balance repayment.

**Expected outcomes:**

- The amount form is shown (not the fully-repaid notice) and the payload's `senior_principal_repaid` equals the waterfall principal.
- After the refetch, senior outstanding and unminted yield read zero and "Close loan" enables.

---

## Story 4: A stuck loan explains why it cannot be closed

**Persona:** Trustee opening a loan stranded by an earlier over-sized coupon.

**Pre-conditions:** `offtaker_outstanding` is `0` while `senior_outstanding` is above `0`.

**Steps:**

1. Open `/loans/<id>/record-repayment`.

**Expected outcomes:**

- The "Offtaker fully repaid" notice is followed by "Senior principal of $X is still outstanding on-chain, so this loan can't be closed from the app. Escalate to the Risk Council."
- With senior also at zero the extra line is absent. Close loan stays disabled while senior is above zero.
