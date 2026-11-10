# User Stories: #1761 — Trustee Risk Council pages on the AccessManager model

Issue: [#1761](https://github.com/eq-lab/pipeline/issues/1761) (epic #1795)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#risk-council-actions), [docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md) §"Type 3", [docs/product-specs/trustee-risk-watchlist.md](../../product-specs/trustee-risk-watchlist.md) §"Escalation"

Trustee app (`packages/trustee`), Risk Council pages `/risk-council`, `/risk-council/escalate/{id}`, `/risk-council/reterm/{id}` and `/risk-council/writedown/{id}` with `?chain=` of a Stellar loan, Stellar wallet connected. A Risk Council wallet calls the AccessManager: one `execute` when its `can_call` is immediate, otherwise `schedule`, then `execute` after the delay. Wallets that run these stories must be in the API trustee allow-list. There is no Safe, proposal, vote or timer. Status values are the on-chain ones.

---

## Story 1: A Trustee-only wallet sees every Risk Council page read-only

**Persona:** Trustee whose wallet has no Risk Council role (`can_call` returns `immediate: false, delay: 0`).

**Steps:**

1. Open the Risk Council hub.
2. Open Escalate, Amend economics and Default resolution for a Stellar loan.

**Expected outcomes:**

- The hub shows "Risk Council actions belong to the Risk Council. Pending operations are visible to the scheduling wallet only." with "—" in the Scheduled operations table; the loan index still lists each loan with its links.
- Escalate reads "Declaring a default belongs to the Risk Council."; Amend economics reads "Changing loan economics belongs to the Risk Council."; Default resolution reads "Writing down, closing a defaulted loan and curing belong to the Risk Council."
- Every action button is disabled, the chip reads "Risk Council only", and no wallet prompt appears.
- The loan evidence and the chain-state rows render.

---

## Story 2: A Risk Council wallet with a delay schedules a default and sees it after a reload

**Persona:** Risk Council member on a deployment where the role is delayed (24 h, #1756 open), loan `WatchList` on chain.

**Steps:**

1. Open Escalate to Default. The role line names the 24 h delay and the Guardian/Admin cancel right; the button reads "Schedule default".
2. Click it, confirm "Declare default on Loan #{id}? The pocket opens on the first default." and approve the wallet prompt.
3. Reload the page.

**Expected outcomes:**

- Step 2 sends an AccessManager `schedule` of the registry's `set_default` with the loan id; the stage text moves through "Waiting for wallet signature…", "Submitting on-chain…", "Confirming…" and the hash is shown.
- After step 3 the role line reads "Scheduled. Executable from <UTC date-time>." and the button reads "Execute default", with no browser storage involved.
- Escape or a click on the dialog backdrop cancels without any prompt.

---

## Story 3: Executing after the ready time declares the default

**Persona:** The same Risk Council wallet.

**Steps:**

1. After the ready time, click "Execute default", confirm and approve.
2. Wait for the refetch.

**Expected outcomes:**

- The chain-state rows read Status "Default" and Pocket opened "Yes"; Outstanding principal is shown as read from chain.
- The page now reads "This loan is in Default." with a link to the Default resolution page, and the button is disabled.
- Executing before the ready time fails with "This operation is not ready yet…" and requests no signature.

---

## Story 4: Amend economics is scheduled and found again after re-entering the values

**Persona:** Risk Council member (delayed role), loan not `Closed` or `Approved`.

**Steps:**

1. Open Amend economics. The Current terms card shows the chain rate, maturity, accrued interest and the signed interest adjustment.
2. Enter a new rate (for example `14.5`, echoed as "= 1450 bps") and a new maturity date. Click "Schedule amendment" and approve.
3. Reload, re-enter the same rate and date.

**Expected outcomes:**

- The button stays disabled until both fields are valid; an invalid rate shows the inline error.
- The transaction is a `schedule` of `amend_economics` with the rate as bps × 100 and the date as UTC midnight seconds.
- After step 3 the card shows "Scheduled. Executable from …" and "Execute amendment"; after the execute the Current terms card shows the new rate and maturity.

---

## Story 5: Adjust interest is scheduled with a reason

**Persona:** Risk Council member (delayed role).

**Steps:**

1. In the Adjust interest card enter a delta (for example `-1,000.50`, a waiver) and a reason. The sha256 hex of the trimmed reason appears under the field.
2. Click "Schedule adjustment" and approve. After the ready time click "Execute adjustment".

**Expected outcomes:**

- The button stays disabled until the delta is a non-zero amount and the reason is non-empty.
- The transaction is `adjust_interest` with the signed delta in 7-decimal units and that hash; the Interest adjustment row shows the new signed value after the refetch.

---

## Story 6: Write-down is scheduled and executed, and the outstanding principal reads 0

**Persona:** Risk Council member (delayed role), loan `Default` on chain.

**Steps:**

1. Open Default resolution. The Write down amount is prefilled with the chain's outstanding principal.
2. Click "Schedule write-down" and approve; after the ready time click "Execute write-down" and approve.

**Expected outcomes:**

- The transaction is `write_down` with the entered USD amount in 7-decimal units.
- After the refetch Written down shows the amount and Outstanding principal reads `$0.00`.

---

## Story 7: Close-defaulted can be scheduled early, but its execute waits for zero outstanding principal

**Persona:** Risk Council member (delayed role), loan `Default` with outstanding principal above zero.

**Steps:**

1. In the Close defaulted loan card pick a reason (`Default` is preselected; "Other write-down" is the alternative) and click "Schedule close".
2. After its ready time, while outstanding principal is still above zero, look at the button.
3. After Story 6 brings outstanding to zero, click "Execute close".

**Expected outcomes:**

- Step 1 succeeds (scheduling is not closing). The card lists "Risk Council only · 24 hours" for both reasons.
- Step 2: "Executable once the outstanding principal is zero." and the button is disabled.
- Step 3: the loan reads Closed with the closure reason; a close left past 7 days after its ready time fails with the "expired, schedule it again" copy.

---

## Story 8: Cure returns the loan to WatchList with the pocket still open

**Persona:** Risk Council member (delayed role), loan `Default`.

**Steps:**

1. In the Cure card read the effects, click "Schedule cure" and approve; after the ready time click "Execute cure".

**Expected outcomes:**

- The effects read "The loan returns to WatchList. The pocket stays open; later repayments still go to the pocket holders."
- After the refetch Status reads WatchList and Pocket opened still reads Yes.

---

## Story 9: The hub lists pending declared defaults and cures, and operations scheduled from this session

**Persona:** Risk Council member (delayed role), signed in on the Stellar chain.

**Steps:**

1. Schedule a `set_default` on one loan (Story 2) and a `write_down` on another, then open the hub without reloading.
2. Reload the hub.

**Expected outcomes:**

- Step 1 lists both operations with the loan, action, verbatim arguments (USD amount for the write-down), "Executable from …" and "Scheduled".
- Step 2 still lists the `set_default` (found deterministically) but not the `write_down`, which only this session knew about. The footnote says other operations need an indexer.
- The Loans table shows each loan's on-chain status with "Declare default" / "Resolve default" and "Amend economics" links that carry the chain; a Closed loan has none.
- With nothing pending the table reads "No scheduled operations found."

---

## Story 10: A schedule cancelled by the Guardian shows "No longer scheduled"

**Persona:** Risk Council member (delayed role) whose operation was scheduled from this session.

**Steps:**

1. Schedule a cure. Have the Guardian or the Admin cancel it on chain.
2. Wait at least 15 seconds after scheduling and refetch (revisit the page).

**Expected outcomes:**

- The card shows "No longer scheduled — cancelled by the Guardian or the Admin, or executed from another session." and the button offers "Schedule cure" again.
- The chain-state card next to it shows what actually happened.

---

## Story 11: An EVM loan or EVM session is read-only with the Stellar-only reason

**Persona:** Trustee viewing an EVM loan, or signed in on an EVM chain.

**Steps:**

1. Open a Risk Council page for an EVM loan (`?chain=` of an EVM chain).
2. Sign in on an EVM chain and open the hub.

**Expected outcomes:**

- Step 1: the loan evidence renders, the chain-state card shows "—", every action card is disabled and prints "On-chain actions run on Stellar only — this loan lives on …" (TD-152).
- Step 2: only the header and the same reason line render. No chain reads and no transaction are built.

---

## Story 12: After #1756 the default path is a single execute

**Persona:** Risk Council member on a deployment where `can_call(set_default)` is immediate.

**Steps:**

1. Open Escalate to Default for a `WatchList` loan. The chip reads "Risk Council · executes at once" and the button reads "Declare default".
2. Click it, confirm and approve.

**Expected outcomes:**

- One wallet prompt appears, for an AccessManager `execute` of `set_default`; no `schedule` transaction precedes it.
- The chain-state rows show Status "Default" and Pocket opened "Yes" after the refetch.
