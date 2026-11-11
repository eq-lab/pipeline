# User story: #1893 — Trustee: update_mutable sends the 3-arg layout, Update lifecycle works on Stellar

**Epic:** #1776
**Issue:** https://github.com/eq-lab/pipeline/issues/1893
**Status:** Initial

---

## Overview

The Update lifecycle dialog on `/loans/$id` calls the deployed LoanRegistry `update_mutable(loan_id: u32, status: LoanStatus, metadata_uri: String)`. It collects the target status and the metadata URI only, reads both current values from the on-chain `mutable_loan_data`, and never wipes the stored URI by default. Spec: `docs/frontend/trustee-flows.md#wired-actions` (Update lifecycle).

Persona: trustee on pipeline-test with a Stellar trustee wallet that holds `TRUSTEE`, signed in on the Stellar chain.

**Precondition:** a loan must be drawn and disbursed on registry `CDWN5B3FFX25TSL6T2NEW5LPTW4VYFUXCXPMNIFRBMJYILEOAL5TVXZQ` before Stories 1, 2, 4, 5 and 6 can run. The registry had none as of 2026-11-11 (`next_loan_id` = 0).

---

## Story 1 — A Performing loan moves to Watchlist

**Given** a Performing loan open on `/loans/$id`

**When** the trustee clicks **Update lifecycle**, selects **Watchlist** and clicks **Update loan**, then signs

**Then:**

- The transaction succeeds
- `mutable_loan_data(loan_id).status` is `WatchList` and its `metadata_uri` is unchanged
- After the refetch the loan-book chip shows Watchlist

---

## Story 2 — A Watchlist loan moves back to Performing

**Given** the Story 1 loan

**When** the trustee opens **Update lifecycle**, sees exactly **Active** and **Watchlist** with Watchlist preselected, selects **Active** and submits

**Then:**

- `mutable_loan_data(loan_id).status` is `Performing`
- The metadata URI is unchanged

---

## Story 3 — No CCR or location inputs, URI prefilled

**Given** any Performing or Watchlist loan

**When** the trustee opens **Update lifecycle**

**Then:**

- The dialog has no CCR, location type, location identifier or tracking URL input
- The status is preselected to the on-chain status
- The field **Metadata URI (replaces the stored value)** holds the on-chain `metadata_uri` exactly
- **Update loan** is disabled because nothing changed

---

## Story 4 — Clearing the metadata URI blocks submit

**Given** the dialog from Story 3 and a loan with a non-empty stored URI

**When** the trustee changes the status and then clears the metadata URI field

**Then:**

- **Update loan** is disabled while the field is blank
- Typing a URI back enables it

---

## Story 5 — A metadata-only update replaces the URI

**Given** a Performing loan

**When** the trustee keeps the status, types a new URI and submits

**Then:**

- `mutable_loan_data(loan_id).metadata_uri` equals the new value and the status is unchanged
- The next open of the dialog prefills the new value

---

## Story 6 — An Approved (Disbursing) loan offers only Approved

**Given** a loan whose on-chain status is `Approved`

**When** the trustee opens **Update lifecycle**

**Then:**

- The status selector has the single option Approved
- **Update loan** is disabled until the metadata URI changes
- A Closed loan shows "This loan's on-chain status does not allow a lifecycle update." and a disabled submit

---

## Story 7 — The encoding reaches the registry

**Given** the trustee `G…` wallet and the AccessManager executor `CDP7TUNB…`

**When** a script simulates `execute(CDWN5…, "update_mutable", [u32 loan_id, vec[symbol "WatchList"], string], G…)` without submitting

**Then:**

- With no loan the simulation fails with `Error(Contract, #1)` (`NonExistentLoanId`), not `UnexpectedSize` / `MismatchingParameterLen`
- With a Performing loan it succeeds
