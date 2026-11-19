# User story: #1941 — API: pending AccessManager operations on EVM chains (calldata)

**Epic:** #1937
**Issue:** https://github.com/eq-lab/pipeline/issues/1941
**Status:** Initial

---

## Overview

`GET /v1/loan-book` and `GET /v1/loan-book/{loan_id}/security` serve `pending_operations` for EVM chains as they do for Stellar (#1922), read from `access_manager_operations` (#1939). An EVM item carries `calldata` and `args_xdr: null`; a Stellar item the reverse. The Trustee pages that use them are #1942 and #1943. Spec: `docs/product-specs/loan-security-state.md#pending-operations`.

Persona: API consumer (the Trustee console, `curl`). Both endpoints are public. Stories 2 to 5 need a Risk Council schedule on the EVM AccessManager, which needs a deployment with a delayed role; Hoodi role delays are 0, so Hoodi serves none (accepted difference, Stellar keeps 24 h) and these stories run on a local Anvil with a delayed role. Story 2 also needs the EVM SecurityRegistry key from #1940 (`CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS`). Both run in the epic QA pass #1945.

---

## Story 1 — The EVM loan book rows carry LoanRegistry and Minter operations

**Given** a Risk Council `setDefault` (LoanRegistry) on loan 7 and a `reverseRepay` (Minter) on loan 8 are scheduled, and `CHAIN_<id>_EVM_API_MINTER_ADDRESS` is set

**When** `GET /v1/loan-book?chain_id=<hoodi>` is requested

**Then:**

- The row of loan 7 has an item with `function` `setDefault` and `target_kind` `loan_registry`; the row of loan 8 has `reverseRepay` with `target_kind` `minter`
- Each item has `calldata` as `0x` plus lowercase hex starting with the 4-byte selector, `args_xdr` is `null`, and `args` is the decoded array (`["7"]` for loan 7: ids are decimal strings)
- `caller` and `target` are EIP-55 and `operation_id` is 64 lowercase hex
- Every other row has `"pending_operations": []`

---

## Story 2 — The EVM security response lists the loan's SecurityRegistry operations

**Given** `setTerms` is scheduled on loan 7 and the API has the EVM SecurityRegistry key (#1940)

**When** `GET /v1/loan-book/7/security?chain_id=<hoodi>` is requested

**Then:**

- `pending_operations` has one item with `function` `setTerms`, `target_kind` `security_registry`, `calldata` set and `args_xdr` `null`; `args` has the loan id as a string and the terms as an object keyed by the Solidity names
- `resolveFlag` and `releaseWithConsent` appear the same way
- Operations on other loans, the LoanRegistry or the Minter are not in this response

---

## Story 3 — The state moves from waiting to ready to expired

**Given** a pending EVM operation with `ready_at` R

**When** the API is called before R, between R and R + 7 days, and at or after R + 7 days without anyone executing it

**Then:**

- `state` reads `waiting`, then `ready`, then `expired`
- At exactly R the state is `ready` and at exactly R + 604800 s it is `expired`

---

## Story 4 — Executed and canceled operations disappear

**Given** a pending operation visible in the loan book

**When** it is executed (through `AccessManager.execute` or a direct call on the target) or canceled, including an expired one that is canceled, and the sync task closes the row (about 15 s)

**Then:**

- The item is gone from the loan-book row and from `/security`
- Canceling an expired schedule works on EVM and removes it from the response

---

## Story 5 — A resolveFlag scheduled before its record was registered is resolved at read time

**Given** a `resolveFlag` schedule whose row has `loan_id` `NULL` and `record_id` set, and the record's `SecurityRecordRegistered` event is indexed later

**When** `GET /v1/loan-book/<loan>/security?chain_id=<hoodi>` is requested after the record is known

**Then:**

- The operation appears under the record's loan; while the record is unknown it appears nowhere

---

## Story 6 — Empty cases

**Given** an EVM chain without the worker's AccessManager key, an EVM chain without `CHAIN_<id>_EVM_API_MINTER_ADDRESS`, and a `setInspectors` schedule on the RecordNft

**When** `GET /v1/loan-book?chain_id=<hoodi>` is requested

**Then:**

- Every `loans[]` entry has `"pending_operations": []` for the first case
- Without the Minter key a `reverseRepay` is not served
- `setInspectors` is never served
- Setting the Minter key does not enable `GET /v1/cash-book`, the analytics Minter series or the attention-count Minter reads on the EVM chain

---

## Story 7 — Stellar responses are unchanged

**Given** the Stellar chain with pending operations

**When** `GET /v1/loan-book?chain_id=99000001` is requested

**Then:**

- Every item is as before, plus `"calldata": null`; `args_xdr` is still the base64 string
