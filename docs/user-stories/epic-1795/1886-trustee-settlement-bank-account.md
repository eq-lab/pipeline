# User story: #1886 — Trustee sees the LP's settlement bank account

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1886
**Status:** Initial

---

## Overview

An LP saves one USD settlement bank account through the LP app (#1885). The Trustee console shows the full account on the LP detail page, in the KYB verdict dialogs, and on Pending bank wire-outs (a row disclosure and the settle dialog), so the Trustee knows where to send the wire. Values are shown as served, with a copy button on IBAN, account number, SWIFT/BIC and routing number. Spec: `docs/frontend/trustee-flows.md#settlement-bank-account` and `docs/product-specs/kyb-lp-verification.md#settlement-bank-account`.

All checks use the real API on staging, no localStorage mocks. Open DevTools Network before starting.

**Prerequisites and live-testing risks:**

- An LP that saved an account through #1885 (LP app, while the record is open). LPs that passed KYB before #1812 have none (TD-182) and show the empty state: that is expected, not a defect.
- No wire-out exists on testnet until a lender calls `request_wire_out` (see the prerequisites in [1764-trustee-wire-outs.md](./1764-trustee-wire-outs.md)). Stories 5–8 need one, for an LP that has an account; until then they are covered by unit tests only.
- The LP list's "Bank Info Available" column stays "—" (not served on `GET /v1/lps`, #1275). That is out of scope here.

---

## Story 1 — LP detail shows the account

**Given** a Trustee opens an LP that saved a settlement bank account

**When** the LP detail page loads

**Then:**

- Network shows `GET /v1/lps/{id}` carrying `settlement_bank_account_details`
- A "Settlement bank account" card sits between the profile / KYB cards and the KYB documents card
- It lists Account holder name, Bank name, Bank address, IBAN, Account number, SWIFT/BIC code and Routing number (ABA), each equal to the Network value, with "—" for a null field
- No masked summary is shown

---

## Story 2 — LP detail with no account

**Given** a Trustee opens an LP with no settlement bank account

**When** the page loads

**Then:**

- The card reads "No settlement bank account on file."
- Nothing else on the page is blocked

---

## Story 3 — Copy an identifier

**Given** the account card (or a dialog or sub-row) shows an account

**When** the Trustee clicks the copy button beside the IBAN

**Then:**

- A toast reads "IBAN copied", without the value
- Pasting elsewhere gives exactly the served IBAN
- Account number, SWIFT/BIC and routing number behave the same; names, bank name and address have no copy button, and a null field has none either

---

## Story 4 — KYB review dialogs

**Given** an UnderReview LP with an account and every document verified

**When** the Trustee opens Confirm KYB passed, then Request changes, then Reject account

**Then:**

- Each dialog shows a "Settlement bank account" block with the account
- Confirm KYB passed adds "Passing KYB also verifies this settlement bank account."; the other two do not
- Opening a document's Verify or Reject dialog shows no account block
- For an LP with no account the block reads "No settlement bank account on file." and the decision is still allowed

---

## Story 5 — Pending wire-out with an account

**Given** a Pending wire-out whose lender has an account

**When** the Trustee reads the row and clicks "Show bank account"

**Then:**

- Network shows `wire_outs[]` with `bank_account` on that row
- The account is not on screen until the toggle is clicked; the sub-row spans the table and "Hide bank account" collapses it
- The toggle works while Settle is disabled (no wallet connected, for instance)
- Clicking Settle shows the same account under "Destination bank account"

---

## Story 6 — Pending wire-out whose lender has no account

**Given** a Pending wire-out whose lender has no account

**When** the Trustee reads the row and opens Settle

**Then:**

- The row shows the "No bank account on file" chip and no toggle
- The dialog shows "—" and "No bank account on file for this lender. Do not send a wire until one is added; cancel the request to return the PLUSD."
- Settle is not blocked by the missing account

---

## Story 7 — Pending wire-out not linked to a lender

**Given** a Pending wire-out with no resolved lender

**When** the Trustee reads the row and opens Settle

**Then:**

- The row shows no chip and no toggle
- The dialog shows "—" and "This wire-out is not linked to a lender, so no bank account is served."

---

## Story 8 — Settled and cancelled rows show nothing

**Given** Settled and Cancelled wire-outs are listed

**When** the Trustee reads those rows

**Then:**

- Neither row shows a toggle or the "No bank account on file" chip
- Network shows no `bank_account` on them

---

## Story 9 — No value leaks

**Given** any of the views above

**When** the Trustee copies an identifier and inspects the page

**Then:**

- The Console shows no log carrying a bank value
- No URL, `title` attribute, `data-*` attribute or toast carries a bank value
