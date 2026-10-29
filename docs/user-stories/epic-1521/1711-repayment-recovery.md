# User Stories: #1711 — Trustee repayment recovery (Minter reverse_repay, corrected repay)

Issue: [#1711](https://github.com/eq-lab/pipeline/issues/1711) (epic #1521, follow-up to #1655 and #1712)
Spec: [docs/product-specs/loan-repayment-recovery.md](../../product-specs/loan-repayment-recovery.md), [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#repayment-recovery-1711)

Trustee app (`packages/trustee`), loan detail page of a Stellar loan, with a Stellar wallet connected. The reversal is signed by a Risk Council wallet; the corrected repayment by a Cash reporter wallet. Both wallets must be able to sign into the app (trustee allow-list).

---

## Story 1: An eligible loan shows the recovery card, a healthy loan does not

**Persona:** Trustee.

**Pre-conditions:** A Stellar loan `Performing` on chain whose offtaker outstanding is `0` while its senior outstanding is above `0`; a second loan that is fully consistent.

**Steps:**

1. Open the first loan's detail page.
2. Open the second loan's detail page.

**Expected outcomes:**

- The first page shows a "Repayment recovery" card with an "Open recovery" button, after the Other-actions card.
- The second page shows no such card.
- The Record Repayment page of the first loan links its senior-outstanding notice to the loan detail page ("Open repayment recovery").

---

## Story 2: A Risk Council wallet with immediate access reverses with one signature

**Persona:** Risk Council member (wallet where `can_call(reverse_repay)` is immediate, the documented target; #1756 removed the delay).

**Steps:**

1. Click "Open recovery". Confirm the mis-split repayment (principal booked as equity) is listed first and preselected, with its split and the reversal effects.
2. Click "Reverse repayment" and approve the wallet prompt.

**Expected outcomes:**

- The effects list shows the cash removed from the bank, the capital wallet fee shares burned and the interest absorbed from the vault (or the Pocket unrelease for a carved-out loan), as served on chain.
- One wallet prompt appears, for an AccessManager `execute` of the Minter's `reverse_repay`; no schedule transaction precedes it.
- After indexing, the audit log shows `CashRepaymentReversed` and `PaymentUnrecorded`.

---

## Story 3: On a delayed deployment the reversal is scheduled, survives a reload, and executing early shows the not-ready error

**Persona:** Risk Council member on a deployment where the role is time-locked (24 h, #1756 open).

**Steps:**

1. Open the recovery dialog. The role line names the 24 h delay and the button reads "Schedule reversal"; click it and approve.
2. Reload the page and reopen the dialog.
3. Click "Execute reversal" before the ready time.
4. After the ready time (within 7 days), click "Execute reversal" and approve.

**Expected outcomes:**

- After step 2 the dialog shows "Scheduled. Executable from <UTC date-time>." and the button reads "Execute reversal", with no browser storage involved.
- Step 3 fails at simulation with "This reversal is not ready yet" and requests no signature.
- Step 4 reverses the repayment on chain.

---

## Story 4: After indexing, a Cash reporter wallet records the corrected repayment

**Persona:** Trustee whose wallet holds `CASH_REPORTER`.

**Pre-conditions:** Story 2 or 3 completed.

**Steps:**

1. Reopen the dialog (the card shows the awaiting-corrected-repayment state). Wait until the "Waiting for the backend" line clears.
2. Review the corrected split and value date, click "Record corrected repayment" and approve.
3. Open Record Repayment for the loan after indexing.

**Expected outcomes:**

- The corrected split puts the principal in senior principal repaid and uses the original value date.
- The dialog shows the transaction hash; the signed transaction is a Minter `repay`.
- The close checklist's senior-outstanding and nothing-to-mint items turn green.

---

## Story 5: A wallet without either role sees disabled actions

**Persona:** Trustee whose wallet holds neither `RISK_COUNCIL` nor `CASH_REPORTER`.

**Steps:**

1. Open the recovery dialog.
2. After a reversal has been done by another wallet, reopen it.

**Expected outcomes:**

- The role line reads "Only the Risk Council can reverse a repayment." and the reverse button is disabled.
- Step 2 shows "Only the Cash reporter can record the corrected repayment." and its button is disabled.
- No wallet prompt appears.

---

## Story 6: An EVM loan shows the Stellar-only reason

**Persona:** Trustee viewing an eligible loan on an EVM chain.

**Steps:**

1. Open the loan's detail page.

**Expected outcomes:**

- The Repayment recovery card is shown with the Stellar-only reason and "Open recovery" is disabled.
- No transaction is built or signed (TD-152).
