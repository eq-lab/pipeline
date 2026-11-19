# User story: #1942 — Trustee: Risk Council security page and inspectors on EVM loans

**Epic:** #1937
**Issue:** https://github.com/eq-lab/pipeline/issues/1942
**Status:** Initial

---

## Overview

`/risk-council/security/$id` and `/risk-council/inspectors` work for EVM loans, one-to-one with the Stellar pages (#1858, #1923). The wallet-connect package gains a reusable EVM write client, the AccessManager bindings and the SecurityRegistry and RecordNft encoders. The Trustee hooks pick the arm by chain, the chain gate is lifted for the four SecurityRegistry functions only, and the EVM hides of the security data (Security card, loans table LTV column) are lifted. Spec: `docs/frontend/trustee-flows.md#risk-council-security-actions` and `#risk-council-pending-operations`, client: `docs/frontend/wallet-flows.md#trustee-evm-contract-client`.

Persona: Risk Council member on the Trustee console, signed in on the EVM chain, with an EVM wallet. The stories need the backend's dual-ABI support for the deployed pre-#55 SecurityRegistry (Hoodi has the 12-field `Terms`, #2070) and the stage env with `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_SECURITY_REGISTRY_ADDRESS` and `VITE_EVM_SECURITY_RECORD_NFT_ADDRESS`. They run in the epic QA pass #1945. Stage chain `99000001` (Stellar) is the regression reference: its pages must not change.

---

## Story 1 — An EVM loan's security page shows the served terms and the LTV line

**Given** an EVM loan with security terms and a valuation

**When** the member opens `/risk-council/security/<id>?chain=<hoodi>`

**Then:**

- "Current security terms" lists the served terms, including "Default ratio" and "Originator fee rate", and the LTV line
- The Set terms form shows 12 inputs and a payment-term select, prefilled from the served terms
- The loan detail Security card and Security records card render for the same loan

---

## Story 2 — With an immediate role, Set terms executes at once

**Given** the connected wallet has the Risk Council role with delay 0

**When** the member changes a field and clicks "Set terms"

**Then:**

- The wallet is asked to sign one transaction, `AccessManager.execute(SecurityRegistry, setTerms(...))`, after a simulation
- The button shows the wallet and confirming stages, then the new terms show after the next fold (up to a minute)
- A revert shows its decoded name as copy (for example the ratio-order message for `SecurityRegistryInvalidRatio`)

---

## Story 3 — With a delayed role, Schedule terms creates a row

**Given** the Risk Council role has a delay D

**When** the member clicks "Schedule terms"

**Then:**

- One transaction, `AccessManager.schedule(SecurityRegistry, calldata, 0)`, is signed
- The "Scheduled operations" card shows a row "Set terms" with "Waiting · executable from …" and the arguments, including the two EVM rows
- Set terms shows "A terms change is already scheduled — see above. …"

---

## Story 4 — After the ready time the scheduling wallet executes the row with nothing retyped

**Given** the row is `ready` and the connected wallet is the scheduler (address case does not matter)

**When** the member clicks "Execute" on the row

**Then:**

- Before the prompt the console checks the registry target, the paused flag, the wallet, the recomputed operation id and the schedule
- One transaction, `AccessManager.execute(SecurityRegistry, <served calldata>)`, is signed with the calldata unchanged
- The row shows "Executed" with the hash until the API stops serving it

---

## Story 5 — Another wallet sees the other-wallet copy

**Given** a `ready` row scheduled by wallet A

**When** wallet B opens the page

**Then:**

- The row shows "Only the scheduling wallet (0x…) can execute this." and Execute is disabled
- No RPC call or signature is requested

---

## Story 6 — An expired row and a paused registry block Execute

**Given** a row whose state is `expired`, or a registry with `paused = true`

**When** the member views the row

**Then:**

- Execute is disabled; for the paused registry the notice reads "The SecurityRegistry is paused. Executing is blocked until it resumes."
- Scheduling stays possible while paused

---

## Story 7 — A cancelled-but-served row shows "No longer scheduled"

**Given** the Guardian or the Admin cancelled the operation after the last served fold (`getSchedule` reads 0)

**When** the member clicks Execute

**Then:**

- Nothing is sent and the row shows "No longer scheduled — cancelled by the Guardian or the Admin, or executed from another session."

---

## Story 8 — Resolve flag and release with consent

**Given** a flagged record and an open record

**When** the member resolves the flag with an outcome and a reason, and releases a record with a consent reference

**Then:**

- Each goes through the same immediate or scheduled path as Story 2 and 3, with the outcome as an enum ordinal and the hash as `bytes32`
- Release asks for confirmation ("Release record #N? This burns the record NFT and cannot be undone.") before any wallet prompt, for a form and for a pending row

---

## Story 9 — The inspector panel lists and changes the RecordNft panel

**Given** the session is on the EVM chain

**When** the member clicks "Inspector panel" on the Risk Council hub (`/risk-council`, which on EVM shows only the Stellar-only reason line and this link) and arrives at `/risk-council/inspectors`

**Then:**

- The current panel is read from `RecordNft.inspectors()` and listed as EIP-55 addresses
- The add field reads "Add inspector (EVM address)"; a Stellar address is refused with "Enter a valid EVM address (0x…)." and a lowercase copy of a listed address is refused as already on the panel
- An added address is checksummed, and Set inspectors (or Schedule inspector panel) sends `setInspectors` to the RecordNft through the AccessManager

---

## Story 10 — A Trustee-only wallet sees every action read-only

**Given** the connected wallet has no Risk Council role (`canCall` is `(false, 0)`)

**When** the member opens the security page and the inspector panel

**Then:**

- Every action shows its no-role copy and a disabled button; the served evidence still renders

---

## Story 11 — An EVM margin-call loan is shown consistently

**Given** an EVM loan with `margin_call_open = true`

**When** the member opens Overview, Loans and the loan detail

**Then:**

- Needs Attention lists the loan with the chain name in its subtitle
- The Loans table shows the LTV column with the cell and the "Margin call" flag
- The Security card shows the margin-call state

---

## Story 12 — A wallet on the wrong network is asked to switch before signing

**Given** the EVM wallet is on another chain than the deployment's

**When** the member triggers any of the actions above

**Then:**

- The wallet is asked to switch to the deployment's chain before the transaction is simulated and signed; a rejection shows the wallet-rejection copy and sends nothing
