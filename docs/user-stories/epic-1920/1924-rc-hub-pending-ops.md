# User Stories: #1924 — Trustee: Risk Council hub and loan pages list pending operations from the API and execute from any session

Issue: [#1924](https://github.com/eq-lab/pipeline/issues/1924) (epic #1920)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#risk-council-pending-operations), [docs/product-specs/loan-security-state.md](../../product-specs/loan-security-state.md#pending-operations)

Trustee app (`packages/trustee`), Stellar wallet connected, session on the Stellar chain. The Risk Council hub (`/risk-council`) and the loan surfaces (`/risk-council/escalate/{id}`, `/risk-council/reterm/{id}`, `/risk-council/writedown/{id}`, `/risk-council/security/{id}`, and the "Repayment recovery" dialog on `/loans/{id}`) read `pending_operations` from `GET /v1/loan-book` (#1922). They need the worker's AccessManager indexer key (#1921) and the AccessManager id `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`. The delay is 24 h on test and prod; a scheduled operation expires 7 days after its ready time. Wallets that run these stories must be in the API trustee allow-list. Execute needs a wallet signature and testnet writes, so the stories run in the epic QA pass.

---

## Story 1: The hub lists an operation scheduled from another browser after a reload

**Persona:** any trustee wallet; an `amend_economics` for a loan was scheduled by a Risk Council wallet from another browser.

**Steps:**

1. Open `/risk-council` (a fresh browser, no earlier session).

**Expected outcomes:**

- The "Scheduled operations" table has the columns Loan, Action, Arguments, Scheduled by, Executable from, State.
- The row reads "Amend economics", with the new rate in bps and the maturity date, the scheduler's short address under "Scheduled by", the UTC ready time under "Executable from" and "Waiting" or "Ready" under State.
- The row has a link that opens `/risk-council/reterm/{id}` for that loan, carrying the chain.
- There is no Execute button on the hub.

---

## Story 2: An expired row is listed and reads "Expired"

**Persona:** any trustee wallet; an operation was not executed within 7 days of its ready time.

**Steps:**

1. Open `/risk-council`.

**Expected outcomes:**

- The row is listed with "Expired" under State.
- Its link opens the page that owns the function; that page shows "Expired — schedule it again" and a disabled Execute.

---

## Story 3: A Trustee-only wallet sees the rows and the role line

**Persona:** a wallet with the Trustee role but not the Risk Council role, or no wallet connected.

**Steps:**

1. Open `/risk-council`.

**Expected outcomes:**

- The same rows appear as for a Risk Council wallet; there is no row of dashes.
- The role line reads "Risk Council actions belong to the Risk Council." and does not mention the scheduling wallet.
- "Scheduled by" shows the scheduler's short address and has no "· this wallet" suffix.

---

## Story 4: The scheduler executes `amend_economics` from the Amend economics card without retyping

**Persona:** the Risk Council member who scheduled `amend_economics`, in a new browser session; and a second Risk Council wallet.

**Steps:**

1. Open `/risk-council/reterm/{id}`. The "Scheduled operations" card is the first card of the right column, above "Amend economics".
2. After the ready time (up to 30 s after the flip), click "Execute" on the row and approve.
3. Open the same page with the second Risk Council wallet.

**Expected outcomes:**

- The row shows "New rate" in % and bps and "New maturity", "Scheduled by <short address> · this wallet". The button is enabled only for this ready row; nothing was typed in the form.
- The transaction is an AccessManager `execute` of `amend_economics` with the scheduled arguments. The row then reads "Executed" with "Submitted · <tx hash>" and disappears once the API stops serving it.
- For a `Closed` or `Approved` loan the ready row is disabled with "Not available for a Closed loan." (or Approved).
- The second wallet sees the row, with "Execute" disabled and "Only the scheduling wallet (<short address>) can execute this."

---

## Story 4a: A `write_down` of the same loan shows a link on the Amend economics page

**Persona:** Risk Council member; the loan has a pending `write_down` and a pending `amend_economics`.

**Steps:**

1. Open `/risk-council/reterm/{id}` and read the "Scheduled operations" card.
2. Click "Open Default resolution" on the `write_down` row.
3. On the Default resolution page, execute the `write_down` row when it is ready.

**Expected outcomes:**

- Both operations are listed. `amend_economics` has "Execute"; `write_down` shows its state line and the link "Open Default resolution", with no Execute button.
- The link opens `/risk-council/writedown/{id}` for the same loan and chain, where the same operation has "Execute".
- A pending `set_terms` of the loan shows "Open Security"; a pending `reverse_repay` shows "Open loan · Repayment recovery". No link row ever opens a wallet prompt.

---

## Story 5: `close_defaulted` is blocked until the outstanding principal is zero

**Persona:** Risk Council member on `/risk-council/writedown/{id}` for a `Default` loan with a ready `close_defaulted` row.

**Steps:**

1. Open the page while the on-chain outstanding principal is above `0`.
2. Repeat after a write-down brings the outstanding principal to `0`.

**Expected outcomes:**

- In the first case the row's "Execute" is disabled and reads "Executable once the outstanding principal is zero."
- In the second case "Execute" is enabled.
- The `write_down` and `cure` rows are not blocked by that gate; for a loan that is not in `Default` they show "This loan is not in Default." and are disabled.

---

## Story 6: A `set_default` row executes after the confirm dialog and disappears

**Persona:** Risk Council member on `/risk-council/escalate/{id}` for a `WatchList` loan with a ready `set_default` row.

**Steps:**

1. Click "Execute" on the `set_default` row.
2. Confirm, then approve in the wallet.

**Expected outcomes:**

- The first click opens "Declare default on Loan #{id}? The pocket opens on the first default." with Cancel and Execute; Escape and the backdrop cancel with nothing sent.
- After Confirm and the wallet approval the row reads "Executed" with the transaction hash, then disappears once the API stops serving it. The loan moves to Default.
- If the loan is already in `Default`, the ready row is disabled and reads "This loan is in Default."

---

## Story 7: The recovery dialog lists a `reverse_repay` scheduled by another wallet

**Persona:** the Risk Council member who scheduled `reverse_repay` from the "Repayment recovery" dialog; another trustee wallet opening the same loan.

**Steps:**

1. Open the loan detail page and click "Open recovery". Read "Scheduled operations" at the top of step 1.
2. After the ready time, click "Execute" on the `reverse_repay` row as the scheduler and approve.

**Expected outcomes:**

- The row reads "Reverse repayment · repayment #N" with the repayment number, the reference hash shortened to 10 hex characters and "…", and "Scheduled by". Another wallet sees "Execute" disabled with "Only the scheduling wallet (<short address>) can execute this."
- After the scheduler executes, the dialog shows "Repayment #N is reversed on-chain" and the step-1 button is gone; step 2 can proceed.
- Operations of the same loan that belong to other pages (for example `amend_economics`) show a link to their page instead of Execute.
- With no pending operation the block reads "No scheduled operations found."

---

## Story 8: A just-scheduled write-down shows the session note, then the indexed row

**Persona:** Risk Council member (delayed role) on `/risk-council/writedown/{id}` and then on the hub.

**Steps:**

1. Schedule a write-down and approve.
2. Right away look at the "Scheduled operations" card and at `/risk-council`; look again after about a minute.

**Expected outcomes:**

- Right after the schedule the row appears on both with "Scheduled from this console. The list catches up within a minute." on the page, and the same row in the hub table.
- Once the indexer has the operation the note is gone, the row is listed once, and Execute works from any session.

---

## Story 9: The hub footnote names the inspector panel and `set_inspectors` is not listed

**Persona:** Risk Council member who scheduled an inspector panel change.

**Steps:**

1. Open `/risk-council` after scheduling a `set_inspectors` operation.

**Expected outcomes:**

- The footnote reads "Inspector panel changes are not tied to a loan and are not listed here; open the Inspector panel to check one."
- The inspector operation is not a row of the table.
- The "Inspector panel" link at the top of the page opens the panel page.
