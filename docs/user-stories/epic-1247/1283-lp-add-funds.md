# User Stories: #1283 — LP: Add Funds wire-transfer modal + bank-transfer home states

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1283](https://github.com/eq-lab/pipeline/issues/1283)
Spec: [docs/frontend/bank-transfers.md](../../frontend/bank-transfers.md)

Both surfaces are presentational — no network call, no persistence, no auth. Neither is mounted on
any production route; both are reachable only at `http://localhost:5173/test?tab=auth` under the
dev server. Styling-only assertions (exact colors, radii, spacing) are out of scope — visual
fidelity is verified separately by the QA agent's Figma comparison against nodes `6701-97113`
(modal), `6701-98220`, `6701-97538`, `6701-97942`, `6701-98417`, `6701-97340`, and `6701-97136`
(card variants).

---

## Story 1: Opening the Funding details modal with the placeholder fixture shows all six wire details

**Persona:** Any visitor to the diagnostics page.

**Pre-conditions:** At `http://localhost:5173/test?tab=auth`.

**Steps:**

1. Click `Open Funding details modal`.

**Expected outcomes:**

- A dialog opens headed `Funding details`.
- Six rows are shown in order: `Company Name: Pipeline Trust LLC`, `Bank Name: HSBC Bank`,
  `Bank Address: London, 1st Canary Wharf`, `Account Number: 1234567890`,
  `IBAN: GB29 UKBP 1234 5678 9012 34`, `SWIFT / BIC code: UKBPLD2LXXX`.
- A note reads exactly "Transfers may take from the same day up to 5 business days".
- A full-width `Copy` button and a `Need help? Contact Support` footer are present.

---

## Story 2: Copy writes the serialized block to the clipboard and confirms

**Pre-conditions:** The Funding details modal is open (Story 1).

**Steps:**

1. Click `Copy`.

**Expected outcomes:**

- The clipboard receives the six rows as `"{label}: {value}"` lines joined by newlines.
- The button label changes to `Copied` and reverts to `Copy` after ~1.5 seconds.

---

## Story 3: The modal dismisses via ×, Escape, and the scrim, but not a click inside the panel

**Pre-conditions:** The Funding details modal is open.

**Steps:**

1. Click the `×` button. Reopen the modal.
2. Press Escape. Reopen the modal.
3. Click outside the panel (the scrim). Reopen the modal.
4. Click inside the panel, away from any control.

**Expected outcomes:**

- Steps 1–3 each close the dialog.
- Step 4 leaves the dialog open.

---

## Story 4: Contact Support is a real, inert-by-default control

**Pre-conditions:** The Funding details modal is open.

**Steps:**

1. Click `Contact Support`.

**Expected outcomes:**

- Nothing throws and nothing navigates — the seam has no destination wired in this issue (#1283
  does not resolve where Contact Support goes).

---

## Story 5: Each AddUsdCard variant shows its designed content and control set

**Pre-conditions:** At `http://localhost:5173/test?tab=auth`, viewing the "Wire transfers (#1283)"
block.

**Steps:**

1. Observe the five cards captioned `locked`, `verify`, `verifying`, `unlocked`, `funded`.

**Expected outcomes:**

- `locked`: `Add USD` / `Use a bank transfer` / `KYB verification required`; a circular
  `Add Funds` action that is **disabled**.
- `verify`: `Verify your account` / `Complete KYB to unlock bank transfers.`; a
  `Start Verification` action; the striped-check illustration is visible.
- `verifying`: `Verifying account…` / `We are reviewing your documents.`; a `View Status` action;
  the striped-check illustration is visible.
- `unlocked`: `Add USD` / `Use a bank transfer` / `Transfers unlocked`; a circular `Add Funds`
  action, **not** disabled.
- `funded`: `USD Balance` / `$1,000.00` (the preview fixture) / `on Trust account`; a circular
  `Add Funds` action plus a `Withdraw` link. `Withdraw` appears on no other variant.

---

## Story 6: Add Funds opens the same single Funding details modal from any unlocked/funded card

**Pre-conditions:** At `/test?tab=auth`.

**Steps:**

1. Click the `unlocked` card's `Add Funds`.
2. Without closing it, observe the dialog count.

**Expected outcomes:**

- Exactly one `dialog` role is present — clicking a different card's `Add Funds` never stacks a
  second modal.

---

## Story 7: Withdraw, Start Verification, and View Status are inert seams with named stand-ins

**Pre-conditions:** At `/test?tab=auth`.

**Steps:**

1. Click the `funded` card's `Withdraw`.
2. Click the `verify` card's `Start Verification`.
3. Click the `verifying` card's `View Status`.

**Expected outcomes:**

- Each click reveals its own stand-in confirmation line naming the owning follow-up issue
  (`Withdraw` → #1285; `Start Verification` and `View Status` → #1282). No navigation occurs from
  this page.

---

## Story 8: Every control on every card variant is safe to click with no handlers wired

**Pre-conditions:** Render `AddUsdCard` for each variant directly (not only via `/test`), with no
props beyond `variant`.

**Steps:**

1. Click every visible, enabled control on each variant.

**Expected outcomes:**

- Nothing throws. `locked`'s `Add Funds` is disabled and is not clicked. `funded` with no
  `usdBalanceLabel` renders `—`, never a fabricated number.
