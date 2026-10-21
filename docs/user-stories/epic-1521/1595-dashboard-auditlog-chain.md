# User story: #1595 — Dashboard + AuditLog API: all-chains aggregation, CashRepaid yield, new indexer events in the audit feed

**Epic:** #1521 — LoanBook API — multi-chain
**Issue:** https://github.com/eq-lab/pipeline/issues/1595
**Status:** Initial

---

## Overview

`GET /v1/dashboard/summary`, `GET /v1/dashboard/tvl-history`, `GET /v1/dashboard/yield-history` and `GET /v1/audit-log` take an optional `chain_id`: omitted aggregates every configured chain, a configured id selects that chain, a well-formed id outside `CHAINS` answers `200` with a zeroed or empty response and no database access, and a malformed or repeated `chain_id` is `400`. There is no `DEFAULT_CHAIN_ID` fallback. The dashboard's cumulative yield now adds Minter `CashRepaid` mints (net of `CashRepaymentReversed`) to the historical `YieldMinted` rows (closes #1533). The audit feed gains `chain_id` on each item, the epic #1478 Minter / CollateralRegistry / DealTokenFactory events, and rollover / amendment rows that render their rate (bps) and maturity again (closes #1532). Backend-only; no Figma reference. The LP dashboard hooks and the Trustee `useAuditLog` already send `chain_id`, so both keep per-chain results.

Automated coverage is in `packages/api/tests/dashboard_auditlog_chain.rs` (chain selection, aggregation, yield netting, merge order, per-event rendering with parser-shaped params, OpenAPI flags).

---

## Story 1 — Dashboard aggregates all configured chains

**Given** `CHAINS=1,99000001` with deposits, active loans and repayments indexed on both chains

**When** `GET /v1/dashboard/summary` is called with no `chain_id`, then with `chain_id=1`

**Then:**

- Without `chain_id`, `tvl`, `outstanding_in_loans` and `cumulative_yield_total` are the per-chain values (each in base-6 USDC) summed
- `loan_book_yield` and `current_apy_net_to_splusd` are principal-weighted over the loans of both chains, and `null` when neither chain has an active loan
- With `chain_id=1`, the values equal chain 1's own

## Story 2 — Dashboard series share one grid

**When** `GET /v1/dashboard/tvl-history?days=30` and `GET /v1/dashboard/yield-history?days=30` are called with no `chain_id`

**Then:**

- Each point is the sum of the chains' running totals at the same timestamp; `max` / `min` / `average` come from the summed series
- The final point equals the summary's `tvl` / `cumulative_yield_total`

## Story 3 — Dashboard yield is no longer frozen

**Given** a chain with a historical `YieldMinted` row and a Minter `CashRepaid` row whose `PaymentRecorded` is on the configured LoanRegistry, and a second `CashRepaid` later reversed by `CashRepaymentReversed`

**When** `GET /v1/dashboard/summary?chain_id=<id>` and `GET /v1/dashboard/yield-history` are called

**Then:**

- `cumulative_yield_total` = historical `YieldMinted` + the live `CashRepaid` (`interest_minted` + fee leg), normalised per loan by chain kind (EVM 6, Stellar 7) and rounded exactly like the LoanBook `minted_yield`, so it equals the sum of the per-loan `minted_yield` figures; the reversed repayment is excluded after its reversal and the series steps down at the reversal time

## Story 4 — Chain selection and errors

**When** any of the four endpoints is called with `chain_id=abc`, with `chain_id` given twice, and with `chain_id=5`

**Then:**

- `abc` and a repeated `chain_id` return `400`
- `chain_id=5` returns `200`: a zeroed summary, an empty series with zero stats, or `{"items":[]}`; no database access happens

## Story 5 — Audit feed merges chains

**Given** audit rows on both chains

**When** `GET /v1/audit-log` is called with no `chain_id`

**Then:**

- Items from both chains are merged newest first (`block_timestamp`, then block number, then log index)
- Each item has `chain_id`, and amounts use that row's chain kind (the same raw `10000000` renders `10.000000` on an EVM row and `1.000000` on a Stellar row)

## Story 6 — Audit feed shows the epic #1478 events

**Given** indexed Minter, CollateralRegistry and DealTokenFactory rows on an EVM and a Stellar chain

**When** `GET /v1/audit-log` is called

**Then:**

- The Minter cash events, the eleven CollateralRegistry events and `DealRegistered` / `DebtSynced` / `CargoSynced` each render an `action` and `details`; rows with a `loan_id` have scope `Loan #<id>`, the others `Protocol`; permissionless `DebtSynced` / `CargoSynced` rows that moved nothing (`minted` and `clawed` / `burned` both zero) are omitted; negative cash amounts render as `-$12.34`
- No `DealTokenTransfer` row appears
- Historical `YieldMinted`, `LoanCCRUpdated` and `LoanLocationUpdated` rows still render

## Story 7 — Rollover and amendment show rate and maturity

**Given** a `LoanRolledOver` or `EconomicsAmended` row stored as `{loan_id, event:{new_rate, new_maturity_timestamp}, snapshot}` with `new_rate = 150000`

**When** `GET /v1/audit-log` is called

**Then:**

- `details.new_rate_bps` is `1500` and `details.new_maturity_timestamp` carries the stored value, not `null`
