# User story: #1480 — Stellar indexer indexes the remaining minter cash events

**Epic:** #1478 — Index the remaining contract events
**Issue:** https://github.com/eq-lab/pipeline/issues/1480
**Status:** Initial

---

## Overview

Backend-only change; no Figma reference. The Stellar worker now writes 13 more minter events into
`contract_logs` next to `WireIn` / `WireInAssigned`. Nothing reads the rows yet. Coverage is pure unit
tests with locally built `RawEvent`s in `packages/worker/tests/stellar_minter_cash_parsers.rs`
(no RPC, no DB, no env vars). Shapes are specified in `docs/references/backend.md` ("Stellar (Soroban) events").

---

## Story 1 — Every collected minter event becomes a row with the cross-arm shape

**Given** the minter contract id is configured and a transaction emits any of `wire_in_returned`,
`cash_disbursed`, `cash_disbursement_reversed`, `cash_repaid`, `cash_repayment_reversed`,
`wire_out_requested`, `wire_out_settled`, `wire_out_cancelled`, `ramp_opened`, `ramp_closed`,
`cash_recorded`, `mint_corrected`, `loss_absorbed`

**When** the Stellar poller processes the event

**Then:**

- A `contract_logs` row is written with the EVM PascalCase `event_name` (e.g. `CashDisbursed`).
- `params` has exactly the EVM snake_case keys; ids, amounts and dates are decimal strings; `ref_hash` is 64-char lowercase hex.
- Run: `cargo test -p pipeline-worker --test stellar_minter_cash_parsers`.

---

## Story 2 — Enums and signed values are preserved

**Given** a `cash_recorded` event with `kind = Expense` and a negative `delta`, and a `ramp_opened` with `direction = BankToUsdc`

**When** they are parsed

**Then:**

- `params.reason = "Expense"`, `params.delta` keeps its minus sign, `params.direction = "BankToUsdc"`.
- A `Correction` kind is stored as `CashRecorded` with `reason = "Correction"` (no `CashCorrected` rename).

---

## Story 3 — Malformed events are rejected, uncollected ones are ignored

**Given** an event with a wrong-typed id, a missing data field, or a `ref_hash` that is not 32 bytes

**When** it is dispatched from the minter

**Then:** no row is produced (a warn is logged for a collected topic).

**Given** `snapshot`, `treasury_set`, `rate_limit_applied` or `tx_limit_set` from the minter, or `cash_disbursed` from the LoanRegistry id

**Then:** no minter row is produced and no warn is logged for the uncollected topics.
