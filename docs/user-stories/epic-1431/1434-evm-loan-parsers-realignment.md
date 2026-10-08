# User story: #1434 — EVM indexer realigned to the reworked LoanRegistry contracts

**Epic:** #1431 — Realign the indexer to the reworked LoanRegistry contracts
**Issue:** https://github.com/eq-lab/pipeline/issues/1434
**Status:** Initial

---

## Overview

This change realigns the EVM arm's event parsers and on-chain reader against the
post-rework `pipeline-contracts` (`c4d064c`, the "Contracts setup rework" series
#41–#49), and adds a Minter parser group (`WireIn`/`WireInAssigned`) replacing the
retired `YieldMinted`/`PipelineYieldMinter` surface. No Figma reference is attached to
this Issue or to parent epic #1431 — it is backend-only.

**Deployment reality**: no EVM chain runs anywhere today. `CHAINS` in both `argocd`
environments (test and prod) configures Stellar only; the only historical EVM
deployment (`hoodi-v4`) is four months stale and pre-rework, and is not in `CHAINS`.
Nothing breaks when this change lands, anywhere — it prepares the EVM arm for a future
deployment onto the current contracts (#1436).

All Rust coverage is pure unit tests over ABI-encoded fixtures — no
`DATABASE_URL`/`POSTGRES_URL` anywhere in this change's test suite. See
`packages/worker/tests/parsers.rs`, `loan_registry_reader.rs`, `loan_mapper.rs`, and
`packages/api/tests/audit_log.rs`.

---

## Story 1 — A loan drawn against the reworked contract is indexed, with its real metadata URI

**Given** the EVM LoanRegistry contract emits the reworked `LoanDrawn(uint256 indexed
loanId, string metadataURI)` (two topics; the URI is no longer a dead indexed hash)

**When** the worker's EVM poller processes the event

**Then:**

- A `contract_logs` row is written with `event_name = "LoanDrawn"`, `params.metadata_uri`
  populated from the event data, and a fully populated `params.snapshot`
- The snapshot's `senior_interest_rate_bps` is the on-chain ppm rate divided by 100 (a
  10% loan reads `1000`, not `100000`) — the fix for the rate half of #765

---

## Story 2 — A loan default renders its outstanding/moved balances, not a stale CCR

**Given** a loan is moved into default on the reworked contract, emitting
`LoanDefaulted(uint256 indexed loanId, uint256 outstanding, uint256 moved)` (no
`ccrBps`)

**When** the event is indexed and later read back through `GET /v1/audit-log`

**Then:**

- The audit feed's `LoanDefaulted` entry projects `details.outstanding` and
  `details.moved` as decimal-dollar strings
- `details.ccr_bps` is absent on this row — it no longer exists on the reworked event
- A **pre-rework** `LoanDefaulted` row indexed before this change (carrying
  `params.ccr_bps`) still renders its `ccr_bps` in the feed unchanged

---

## Story 3 — Disbursements, reversals, write-downs, and interest adjustments appear in the Trustee audit feed

**Given** the reworked contract emits one of `Disbursed`, `Undisbursed`,
`PaymentUnrecorded`, `LoanWrittenDown`, or `InterestAdjusted` for a loan

**When** the event is indexed and the Trustee opens the Audit Log page
(`GET /v1/audit-log`)

**Then:**

- A new row appears for the event with a human-readable `action` (e.g. "Disbursed —
  $3,000.00", "Payment reversed", "Interest adjusted") and a curated `details` object
- `PaymentUnrecorded`'s EVM row carries only `outstanding` (no amounts — the on-chain
  event itself carries none); the projection shows `details.outstanding` and omits
  `senior_interest`/`senior_principal_repaid` rather than rendering them as null
- The loan's `LoanSnapshot.disbursed` / `.repaid` / `.written_down` /
  `.interest_adjustment` fields (added by #1432) are updated by the same indexed event
- `InterestSettled` is deliberately **not** indexed (D1) — it fires inside the same
  call as `LoanClosed`, which already triggers a snapshot

---

## Story 4 — A loan's cumulative repayment total is correct even though the contract has no getter for it

**Given** `cumulativeRepaymentData()` no longer exists on the reworked contract (the
replacement `RepaymentTotals` is a private, lossy 3-field mapping)

**When** a `LoanDrawn` or lifecycle event is indexed for a loan with prior
`PaymentRecorded`/`PaymentUnrecorded` history

**Then:**

- The snapshot's 7-field repayment total is reconstructed from indexed
  `PaymentRecorded` rows minus any `PaymentUnrecorded` reversals, block-pinned and
  de-duplicated by `repayment_id` so re-processing never double-counts
- `senior_principal_repaid` always matches the contract's own `repaid` ledger (it
  self-heals even if a row was never indexed); the other six fields do not self-heal —
  logged as tech debt (R1) with a reconciliation signal
- The Stellar arm is unaffected — its on-chain getter is still live and authoritative

---

## Story 5 — Bank wires booked through the Minter are indexed under one name across both chains

**Given** the Minter contract (`PipelineMinter`, successor to `PipelineYieldMinter`)
emits `WireInRecorded(uint256 indexed id, address indexed receiver, uint256 amount,
uint64 valueDate, bytes32 refHash)` or `WireInAssigned(uint256 indexed id, address
indexed receiver)`

**When** the event is indexed

**Then:**

- The stored `event_name` is `"WireIn"` (not `"WireInRecorded"`) for the first event,
  and `"WireInAssigned"` for the second — matching what the Stellar arm already writes,
  so the relayer's wire-in matching phase reads one name set across chains
- `ref_hash` is stored as lowercase hex with no `0x` prefix, matching the format the
  Stellar parser and `lp_bank_deposit_repo.rs`'s join both expect
- `YieldMinted` is not emitted or indexed on the reworked contract; historical
  `YieldMinted` rows are unaffected and keep rendering in the audit feed and the
  Protocol Dashboard's cumulative-yield metrics

---

## Story 6 — Canonical status/closure-reason ordinals flow straight through, no translation

**Given** `StatusUpdated`/`LoanClosed` events carry the reworked contract's enum
ordinals (`LoanStatus`: `Approved`=0 … `Closed`=4; `ClosureReason`: `None`=0 …
`Cancelled`=3 … `OtherWriteDown`=5)

**When** the event is indexed

**Then:**

- Every ordinal maps straight to its canonical name with no pre-rework translation —
  ordinal 0 renders `"Approved"`, ordinal 3 (`ClosureReason`) renders `"Cancelled"`
- The now-deleted `translate_pre_rework_status`/`translate_pre_rework_closure_reason`
  functions are gone from the codebase entirely

---

## Notes

- No Figma reference exists for this Issue or its parent epic #1431 — this is a
  backend parser/reader realignment plus an API-layer scale fix, verified by automated
  test, not by visual diff.
- This change fixes the rate half of #765 in code (the missing ÷100 on
  `senior_interest_rate_bps`/`current_rate`) but does **not** close it — the symptom
  was observed on `hoodi-v4`, which runs in no environment and cannot be re-verified,
  and the LTV half of #765 (monetary decimal scale) is untouched. See the exec plan's
  decision D7 and the comment posted on #765.
- `TD-123`'s EVM half is closed by this Issue — the six placeholder
  `MutableLoanDataView` fields are now decoded for real on this arm, matching #1433's
  Stellar half.
- The relayer (including its EVM yield-mint phase, which targets the now-deleted
  `PipelineYieldMinter`) stays out of scope — tracked as tech debt, not fixed here.
