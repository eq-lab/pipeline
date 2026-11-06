# User story: #1788 — Stellar DealTokenFactory: DEBT-only DealRegistered after contracts #38

**Epic:** #1776
**Issue:** https://github.com/eq-lab/pipeline/issues/1788
**Status:** Initial

---

## Overview

After contracts #38 the Stellar `DealRegistered` event carries only `debt` (the collateral token is removed). The indexer accepts both the legacy `{debt, cargo}` and the HEAD `{debt}` shape from the same factory address and tracks only the DEBT token of a HEAD deal; `cargo` is stored as JSON `null`. Spec: `docs/references/backend.md#stellar-deal-token-factory-indexing`.

Checks run on pipeline-test (Stellar testnet 99000001 and Hoodi 560048) against the worker log and `GET /v1/audit-log`.

---

## Story 1 — A HEAD register_deal is indexed

**Given** the factory is on the contracts #38 build and the worker runs this change

**When** `register_deal` is called on testnet

**Then:**

- `contract_logs` has a `DealRegistered` row for the loan with `params.debt` set and `params.cargo` null
- The worker log has no "deal-token-factory event recognised by name but not decodable" warning for it

---

## Story 2 — DEBT movements of a HEAD deal are indexed

**Given** the HEAD deal from Story 1

**When** `sync_debt` mints or claws back DEBT

**Then:**

- `DealTokenTransfer` rows exist with `token_kind = "debt"` and the deal's `loan_id`
- `mint` rows have `from` null; `clawback` rows have `to` null

---

## Story 3 — Restart keeps both deal shapes tracked

**Given** the contract_logs hold legacy deals (with `cargo`) and the HEAD deal

**When** the worker restarts

**Then:**

- The `Stellar deal-token set seeded from contract_logs` line counts two tokens per legacy deal and one for the HEAD deal
- The HEAD deal's DEBT movements are still indexed

---

## Story 4 — Hoodi seed is unchanged

**Given** the same worker restart

**When** the EVM startup log is read

**Then:** the `deal-token registry seeded` count for 560048 equals its value before the deploy

---

## Story 5 — Trustee audit log shows the HEAD deal

**Given** the HEAD `DealRegistered` row

**When** a trustee opens the audit log

**Then:**

- The row reads "Deal tokens registered"
- `GET /v1/audit-log` returns `details.cargo = null` for it
