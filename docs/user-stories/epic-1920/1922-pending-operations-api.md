# User story: #1922 — API: pending AccessManager operations inline in loan-book and loan security responses

**Epic:** #1920
**Issue:** https://github.com/eq-lab/pipeline/issues/1922
**Status:** Initial

---

## Overview

`GET /v1/loan-book/{loan_id}/security` and every `loans[]` entry of `GET /v1/loan-book` carry `pending_operations`, read from `access_manager_operations` (#1921). The Trustee pages that show them are #1923 and #1924. Spec: `docs/product-specs/loan-security-state.md#pending-operations`.

Persona: API consumer (the Trustee console, `curl`). Both endpoints are public. Stories 2 to 5 need Risk Council writes on the testnet AccessManager and run in the epic QA pass #1925 or on stage. Stage uses `chain_id=99000001`.

---

## Story 1 — The security response lists the loan's pending SecurityRegistry operations

**Given** the Risk Council scheduled `set_terms` on loan 0 and the indexer has projected it

**When** `GET /v1/loan-book/0/security?chain_id=99000001` is requested

**Then:**

- `pending_operations` is an array with one item whose `function` is `set_terms`, `target_kind` is `security_registry`, `state` is `waiting` and `args` is the argument array the console sent
- `operation_id` is 64 lowercase hex, `args_xdr` is base64, `ready_at` and `expires_at` are ISO-8601 UTC and `expires_at` is seven days after `ready_at`
- Operations on other loans or on the LoanRegistry and Minter are not in this response

---

## Story 2 — The loan book carries every loan-scoped operation per row

**Given** pending `amend_economics` (LoanRegistry) on loan 0 and `reverse_repay` (Minter) on loan 1

**When** `GET /v1/loan-book?chain_id=99000001` is requested

**Then:**

- The row of loan 0 has the `amend_economics` item with `target_kind` `loan_registry`, the row of loan 1 has the `reverse_repay` item with `target_kind` `minter`
- Every other row has `"pending_operations": []`, never `null` or a missing key
- Items are ordered by `ready_at`, then `operation_id`, then `nonce`

---

## Story 3 — The state moves from waiting to ready to expired

**Given** a pending operation with `ready_at` R

**When** the API is called before R, between R and R + 7 days, and at or after R + 7 days without anyone executing it

**Then:**

- `state` reads `waiting`, then `ready`, then `expired`
- At exactly R the state is `ready` and at exactly R + 604800 s it is `expired`
- The expired item stays in the array until a later schedule of the same operation id supersedes it

---

## Story 4 — A resolve_flag scheduled before its record was registered is resolved at read time

**Given** a `resolve_flag` schedule whose `access_manager_operations` row has `loan_id` `NULL` and `record_id` set, and the record's `SecurityRecordRegistered` event is indexed later

**When** `GET /v1/loan-book/<loan>/security?chain_id=99000001` is requested after the record is known

**Then:**

- The `resolve_flag` operation appears under the record's loan
- While the record is unknown the operation appears nowhere

---

## Story 5 — Executed and canceled operations disappear

**Given** a pending operation visible in both responses

**When** the Risk Council executes it (or cancels it) and the sync task closes the row (about 15 s)

**Then:**

- The item is gone from `/security` and from the loan-book row
- Re-scheduling the same call later shows only the new item, not the old one

---

## Story 6 — Empty cases

**Given** an EVM chain, a Stellar chain without the worker's AccessManager key, and a loan with no pending operation

**When** `GET /v1/loan-book` and the `/security` route (Stellar only) are requested for them

**Then:**

- Every `loans[]` entry has `"pending_operations": []`
- `/security` of a loan with no pending operation returns `"pending_operations": []` with status 200
- `/security` for an EVM chain still answers `404 security_registry_not_configured`
