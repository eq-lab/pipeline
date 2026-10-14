# User story: #1483 — EVM indexer: the remaining Minter cash events

**Epic:** #1478 — Index the remaining Minter and registry events
**Issue:** https://github.com/eq-lab/pipeline/issues/1483
**Status:** Initial

---

## Overview

The EVM poller routes every `PipelineMinter` log through `parse_minter_event`, which now
decodes sixteen events: the existing `WireInRecorded` (stored as `WireIn`) and
`WireInAssigned`, plus fourteen new ones stored under their Solidity names. Every row is
a `contract_logs` row. Params follow one convention shared with the Stellar arm (#1480):
snake_case keys, decimal strings for amounts, ids, signed deltas and `value_date`,
lowercase hex hashes with no `0x`, enum ordinals rendered as names (`"Unknown"` for an
out-of-range ordinal), and `lp` in EVM checksum form.

No Figma reference exists — this is backend-only, verified by pure unit tests over
ABI-encoded fixtures in `packages/worker/tests/evm_minter_parsers.rs`.

**Deployment note:** hoodi-v5 (2026-10-08) deploys the reworked `PipelineMinter`,
`PipelineCollateralRegistry` and `PipelineDealTokenFactory`, but this change ships dark:
no environment configures an EVM chain, and rows only appear once a chain points
`CHAIN_<id>_EVM_INDEXER_MINTER_ADDRESS` at a post-rework minter. Logs emitted before the
cursor are not backfilled.

---

## Story 1 — A disbursement and its reversal are indexed with their linkage

**Given** the Minter emits `CashDisbursed(loanId, entryId, amount, valueDate, refHash)` and
later `CashDisbursementReversed(loanId, entryId, originalId, amount, refHash)`

**When** the poller processes both logs

**Then:**

- Two rows exist, `CashDisbursed` and `CashDisbursementReversed`
- The reversal's `params.original_id` equals the disbursement's `params.entry_id`
- `loan_id`, `entry_id`, `original_id` and `amount` are decimal strings

---

## Story 2 — A repayment carries its sale link

**Given** the Minter emits `CashRepaid` and later `CashRepaymentReversed`

**Then:**

- `CashRepaid.params` has `loan_id`, `repayment_id`, `sale_id`, `cash`, `interest_minted`,
  `fee_shares`, `value_date`, `ref_hash`; `sale_id` is the link to the CollateralRegistry
  `Liquidated` event (#1484)
- Values up to `U256::MAX` are stored without truncation
- `CashRepaymentReversed.params` has `loan_id`, `repayment_id`, `cash`, `ref_hash`

---

## Story 3 — The wire-out lifecycle and returned wires

**Given** an LP wire-out is requested and then settled or cancelled, and a wire-in is returned

**Then:**

- `WireOutRequested.params` = `id`, `lp` (checksum address), `amount`
- `WireOutSettled.params` = `id`, `amount`, `value_date`, `ref_hash`
- `WireOutCancelled.params` = `id`
- `WireInReturned.params` = `id`, `amount`, `ref_hash`

---

## Story 4 — Ramps open and close with a direction name

**Given** a ramp opens with direction ordinal 0 or 1 and later closes at a loss

**Then:**

- `RampOpened.params.direction` is `"UsdcToBank"` or `"BankToUsdc"` (`"Unknown"` otherwise)
- `RampClosed.params` = `id`, `received`, `loss`, `ref_hash`
- The lossy close tx also yields `LossAbsorbed` (`requested`, `pulled`) and
  `CashRecorded` with `reason = "Expense"`, each as its own row with its own `log_index`

---

## Story 5 — Income, expense, corrections and mint corrections

**Given** the Minter emits `CashRecorded`, `CashCorrected` or `MintCorrected`

**Then:**

- `CashRecorded.params.reason` is one of `Disbursed`, `DisbursementReversed`, `Income`,
  `Expense`, `Correction`, `Unknown`; on EVM only `Income` and `Expense` are emitted
- `delta` is a signed decimal string (`"-500000"` for an expense)
- `CashCorrected.params` = `original_id`, `entry_id`, `delta` (signed), `reason_hash`
- `MintCorrected.params` = `amount`, `ref_hash`

---

## Story 6 — The params match the Stellar arm, with one exception

**Then:**

- For every event present on both chains, `event_name` and the `params` keys and encodings
  match #1480 key for key
- Exception: EVM stores corrections as `CashCorrected` (with `original_id` and
  `reason_hash`), Stellar stores them as `CashRecorded` with `reason = "Correction"` and no
  `original_id`; a correction-aware consumer reads both
- Stellar `Snapshot` is not indexed on either arm

---

## Notes

- Out of scope: consumers (the Trustee audit feed allow-list, wire-in matching TD-116, any
  cash-ledger projection) — new rows stay invisible to them.
