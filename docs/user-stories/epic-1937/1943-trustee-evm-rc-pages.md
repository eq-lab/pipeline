# User story: #1943 — Trustee: Risk Council hub, escalate, reterm, writedown and repayment recovery on EVM loans

**Epic:** #1937
**Issue:** https://github.com/eq-lab/pipeline/issues/1943
**Status:** Initial

---

## Overview

The Risk Council hub (`/risk-council`), Escalate to Default, Amend economics, Default resolution and the repayment-recovery card and dialog on `/loans/$id` work for EVM loans, one-to-one with the Stellar flows (#1761, #1924, #1711). The wallet-connect package gains the LoanRegistry Risk Council bindings, the Minter recovery bindings and a chunked log scan. The Trustee hooks pick the arm by chain and the chain gate opens every Risk Council function and pending row on the configured EVM chain. Recovery step 2 (the corrected `Minter.repay`) stays Stellar-only until #1574. Spec: `docs/frontend/trustee-flows.md#risk-council-actions` (section "EVM"), `#risk-council-pending-operations` and `#repayment-recovery-1711`, `docs/product-specs/loan-repayment-recovery.md`, client: `docs/frontend/wallet-flows.md#trustee-evm-contract-client`.

Persona: Risk Council member on the Trustee console, signed in on the EVM chain, with an EVM wallet. The stories need the EVM role delays and roles from #1944, the stage env with `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_LOAN_REGISTRY_ADDRESS`, `VITE_EVM_MINTER_ADDRESS` and `VITE_EVM_START_BLOCK` (the LoanRegistry deploy block), and a Minter with `extsload` (contracts PR #54). They run in the epic QA pass #1945. Stage chain `99000001` (Stellar) is the regression reference: its pages must not change.

---

## Story 1 — The hub shows the full Risk Council view on an EVM session

**Given** the session is on the EVM chain and the loan book has pending operations

**When** the member opens `/risk-council`

**Then:**

- The intro, the role line, the "Scheduled operations" table with decoded EVM rows (for example "Amend economics", "New rate: … (… bps)") and the per-loan index render
- "Scheduled by" shows "· this wallet" for the connected wallet even when the address case differs
- Each row links to the page that owns it, and the "Inspector panel" link is present

---

## Story 2 — Escalate on an EVM `Performing` loan

**Given** an EVM loan with on-chain status `Performing` or `WatchList`

**When** the member opens `/risk-council/escalate/<id>?chain=<hoodi>` and clicks "Declare default"

**Then:**

- The chain-state rows (Status, Outstanding principal, Written down, Pocket opened) come from `mutableLoanData` and `loanMoney`
- A confirm dialog asks "Declare default on Loan #N? The pocket opens on the first default." before any wallet prompt
- One `AccessManager.execute(LoanRegistry, setDefault(id))` is signed for an immediate role; a delayed role signs `AccessManager.schedule(...)` ("Schedule default")

---

## Story 3 — Amend economics on EVM

**Given** an EVM loan that is not `Closed` or `Approved`

**When** the member enters a new rate and a maturity date and clicks the amend button

**Then:**

- The call is `amendEconomics(id, rateBps * 100, maturity)` (rate 14.5% is `145000`), executed or scheduled per role
- The pending row shows "New rate: … (… bps)" and "New maturity" and, for the scheduling wallet, Execute

---

## Story 4 — Adjust interest on EVM with a negative delta

**Given** an EVM loan

**When** the member enters a negative USD delta (6 decimals) and a reason

**Then:**

- The reason hash is shown, and the call is `adjustInterest(id, delta, 0x<hash>)` with the delta at 6 decimals (`-1.5` is `-1500000`)
- The pending row shows the signed delta at 6 decimals and the shortened hash

---

## Story 5 — Default resolution on EVM

**Given** an EVM loan in `Default`

**When** the member opens `/risk-council/writedown/<id>`

**Then:**

- The write-down amount is prefilled from the chain outstanding at 6 decimals; an edited amount converts at 6 decimals (`$1,000.000001` is `1000000001`)
- Close defaulted sends `Default` (ordinal 4) or `OtherWriteDown` (ordinal 5); its Execute is enabled only when the chain outstanding is `0`
- Cure schedules or executes `cure(id)`

---

## Story 6 — After the ready time the scheduling wallet executes an EVM LoanRegistry row from the page card

**Given** a `ready` LoanRegistry row scheduled by wallet A on an EVM loan (address case does not matter)

**When** wallet A clicks "Execute" on the row

**Then:**

- Before the prompt the console checks the target, the wallet, the recomputed operation id and the schedule
- One transaction, `AccessManager.execute(LoanRegistry, <served calldata>)`, is signed with the calldata unchanged
- Wallet B sees "Only the scheduling wallet (0x…) can execute this." with Execute disabled

---

## Story 7 — A row aimed at another LoanRegistry is disabled

**Given** a served row whose target is not the configured `VITE_EVM_LOAN_REGISTRY_ADDRESS`

**When** the member views the row

**Then:**

- Execute is disabled with "This operation targets another LoanRegistry (0x…) than this console is configured for." and no RPC call or signature is requested

---

## Story 8 — Repayment recovery on an eligible EVM loan

**Given** an EVM loan with the offtaker fully paid, senior principal outstanding, status `Performing`..`Default`, and a mis-split repayment

**When** the member opens the "Repayment recovery" dialog from the loan detail page

**Then:**

- The card is enabled (not the Stellar-only state) and the dialog lists the repayments at 6 decimals, mis-split first, preselected
- The effects show the cash removed, the fee shares burned and, for a carved-out loan, the Pocket unrelease from the Minter's record
- "Reverse repayment" executes `reverseRepay` through the AccessManager (or "Schedule reversal" then "Execute reversal" after the ready time)
- After a reload the reversed repayment is preselected
- If the start block is set too late, the dialog shows "Failed to load the repayments." and the details name the missing repayment and `VITE_EVM_START_BLOCK`

---

## Story 9 — A scheduled `reverseRepay` row executes from the dialog

**Given** a `reverseRepay` row scheduled by the connected wallet

**When** the member clicks Execute on the row in the dialog's "Scheduled operations" block

**Then:**

- The served calldata is sent unchanged; a revert shows its decoded copy (for example the bank-cash message for `MinterInsufficientBankCash`)

---

## Story 10 — Step 2 on EVM shows the Stellar-only reason until #1574

**Given** a repayment is reversed on an EVM loan

**When** the member looks at step 2

**Then:**

- The record button is disabled and the reason reads "On-chain actions run on Stellar only — …"; nothing is signed

---

## Story 11 — A Trustee-only wallet sees every action read-only

**Given** the connected wallet has no Risk Council role (`canCall` is `(false, 0)`)

**When** the member opens the hub, the three pages and the recovery dialog

**Then:**

- Every action shows its no-role copy and a disabled button; the served evidence still renders

---

## Story 12 — A wallet on the wrong network is asked to switch before signing

**Given** the EVM wallet is on another chain than the deployment's

**When** the member triggers any of the actions above

**Then:**

- The wallet is asked to switch to the deployment's chain before the transaction is simulated and signed; a rejection shows the wallet-rejection copy and sends nothing

---

## Story 13 — The Stellar stage chain is unchanged

**Given** a session on the Stellar stage chain (`99000001`)

**When** the member uses the hub, the three pages and the recovery dialog

**Then:**

- Behaviour, copy and amounts (7 decimals) are as before; an EVM chain id other than the configured one still shows the Stellar-only reason
