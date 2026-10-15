# User story: #1526 — LoanBook readers scoped to the configured LoanRegistry

**Epic:** #1520 — LoanBook readers realignment
**Issue:** https://github.com/eq-lab/pipeline/issues/1526
**Status:** Initial

---

## Overview

Backend only, no Figma reference. The LoanBook endpoints (`/v1/loan-book`, per-loan financials, waterfall, CCR history, collateral valuation, trustee per-loan guard) read only the rows emitted by the chain's configured LoanRegistry, set through the required `CHAIN_<id>_EVM_API_LOAN_REGISTRY_ADDRESS` / `CHAIN_<id>_STELLAR_API_LOAN_REGISTRY_ADDRESS`. Portfolio, dashboard, capital allocation and financial position stay chain-scoped until #1538. Execute against a local stack.

---

## Story 1 — Loan book is unchanged with the matching registry

**Given** the API runs with the registry key set to the registry the local indexer indexes

**When** `GET /v1/loan-book` is called as an authorised user

**Then:**

- The same loans are returned as before the change
- The API startup log shows `API LoanRegistry scope loaded` with the configured address for each chain

## Story 2 — A different registry address empties the loan book only

**Given** the registry key is set to a valid address that is not the indexed registry

**When** `GET /v1/loan-book` and `GET /v1/dashboard/summary` are called

**Then:**

- The loan book is empty
- The dashboard summary is unchanged from Story 1

## Story 3 — API refuses to start without the key

**Given** the registry key is unset for a chain listed in `CHAINS`

**When** the API is started

**Then:**

- Startup fails with an error naming the missing `CHAIN_<id>_<TYPE>_API_LOAN_REGISTRY_ADDRESS` key

## Story 4 — Per-loan endpoints stay scoped

**Given** the registry key matches the indexed registry

**When** `GET /v1/loan-book/{loan_id}/financials` and `GET /v1/loan-book/{loan_id}/waterfall` are called for an indexed loan

**Then:**

- Both return the loan as before
- With a non-matching registry key both return 404 `not indexed`
