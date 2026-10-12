# User story: #1433 — Stellar indexer realigned to the reworked LoanRegistry contracts

**Epic:** #1431 — Realign the indexer to the reworked LoanRegistry contracts
**Issue:** https://github.com/eq-lab/pipeline/issues/1433
**Status:** Initial

---

## Overview

This change realigns the Stellar arm's event parsers and on-chain readers against the
#36 `pipeline-stellar-contracts` deployment. No Figma reference is attached to this
Issue or to parent epic #1431 — it is backend-only.

The configured LoanRegistry on today's `.env` (`CHAINS="99000001"`) is still the #26,
pre-rework deployment (verified against the live contract interface), so the data loss
this Issue fixes is **latent, not active** — nothing has been silently dropped yet.
This change prepares the Stellar arm to decode the #36 contracts correctly once the
deployment is repointed (an operational step, out of scope here).

All Rust coverage is pure unit tests over fixtures built with `stellar-xdr` encode
helpers — no `DATABASE_URL`/`POSTGRES_URL` anywhere in this change's test suite. See
`packages/worker/tests/stellar_loan_parsers.rs`, `stellar_loan_reader.rs`,
`stellar_event_poller.rs`, `packages/shared/tests/contract_logs_repo.rs`, and
`packages/api/tests/audit_log.rs`.

---

## Story 1 — A loan drawn against the reworked contract is indexed, not silently dropped

**Given** the Stellar LoanRegistry contract has been repointed to a #36-generation
deployment
**And** a loan is drawn, emitting `loan_drawn` with the contract's current two-topic
shape (`[loan_drawn, loan_id]`, no `holder`)

**When** the worker's Stellar poller processes the event

**Then:**

- A `contract_logs` row is written with `event_name = "LoanDrawn"` and a populated
  `params.snapshot`, not silently skipped — this is the regression the Issue exists to
  fix (the pre-#1433 parser required a third `holder` topic that no longer exists)
- The loan appears in the Trustee Loan Book like any other drawn loan

---

## Story 2 — A loan default renders its outstanding/moved balances, not a stale CCR

**Given** a loan is moved into default on the reworked contract, emitting
`loan_defaulted` with `Map { outstanding, moved }` (no `ccr`)

**When** the event is indexed and later read back through `GET /v1/audit-log`

**Then:**

- The audit feed's `LoanDefaulted` entry projects `details.outstanding` and
  `details.moved` as decimal-dollar strings
- `details.ccr_bps` is absent on this row — it no longer exists on the reworked event
- A **pre-rework** `LoanDefaulted` row indexed before the repoint (carrying
  `params.ccr_bps`) still renders its `ccr_bps` in the feed unchanged — historical rows
  are not retroactively blanked

---

## Story 3 — Disbursements, reversals, write-downs, and interest adjustments appear in the Trustee audit feed

**Given** the reworked contract emits one of `Disbursed`, `Undisbursed`,
`PaymentUnrecorded`, `LoanWrittenDown`, or `InterestAdjusted` for a loan

**When** the event is indexed and the Trustee opens the Audit Log page
(`GET /v1/audit-log`)

**Then:**

- A new row appears for the event with a human-readable `action` (e.g. "Disbursed —
  $3,000.00", "Payment reversed", "Interest adjusted") and a curated `details` object
- The loan's `LoanSnapshot.disbursed` / `.repaid` / `.written_down` /
  `.interest_adjustment` fields (added by #1432) are updated by the same indexed event,
  so the loan book never serves a value that went stale after #1432 added the field but
  before the event that changes it was indexed
- `InterestSettled` is deliberately **not** indexed (D1) — it carries no field that
  mutates `LoanSnapshot`, and the contract always emits `LoanClosed` in the same call,
  which already triggers a snapshot

---

## Story 4 — Stellar amounts in the audit feed render at their true value, not 10x

**Given** the active chain is a Stellar deployment (`CHAIN_<id>_TYPE=stellar`) and a
`PaymentRecorded` or `Disbursed` row carries a 7-decimal raw on-chain amount

**When** the Trustee opens the Audit Log page

**Then:**

- The rendered dollar amount matches the true value (e.g. a $1,000 payment shows
  `"1000.000000"`), not 10x high — this repairs a pre-existing defect that was live
  on every Stellar amount in the feed, not just the five new events this Issue adds
- An EVM-chain row's rendering is byte-for-byte unchanged (EVM's 6-decimal convention
  was already correct)

---

## Notes

- No Figma reference exists for this Issue or its parent epic #1431 — this is a
  backend parser/reader realignment plus an API-layer scale fix, verified by automated
  test, not by visual diff.
- Repointing `.env` to the #36 deployment is explicitly **out of scope** (Q2) — an
  operational step owned by whoever runs the deployment. Until that happens, this
  change's parsers decode nothing on the currently configured contract (Q1), which
  matches current production behavior exactly (no regression).
- `YieldMinted` indexing is retired on the Stellar arm (the rework stopped emitting
  it); `WireIn`/`WireInAssigned` (#1416) keep working. Historical `YieldMinted` rows
  are unaffected and keep rendering in the audit feed and the Protocol Dashboard's
  cumulative-yield metrics.
- `TD-123`'s Stellar half is closed by this Issue — the six placeholder
  `MutableLoanDataView` fields (`current_rate`, `carved_out`, `disbursed`, `repaid`,
  `written_down`, `interest_adjustment`) are now decoded for real on this arm. The EVM
  half stays open for #1434.
