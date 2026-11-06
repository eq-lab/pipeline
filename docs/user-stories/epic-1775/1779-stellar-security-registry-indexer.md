# User story: #1779 — Stellar SecurityRegistry indexer: events, record enrichment, projection tables

**Epic:** #1775
**Issue:** https://github.com/eq-lab/pipeline/issues/1779
**Status:** Initial

---

## Overview

The worker indexes the 22 business events of the Stellar SecurityRegistry into `contract_logs`, fills what events do not carry with view snapshots, and projects records, terms, inspections, lots, docs, margin-call history, extension consents and a per-loan valuation into projection tables that #1780 (API), #1781 (audit log), #1784 and #1785 read. Spec: `docs/references/security-registry-events.md`.

Persona: operator (worker logs, env key, database). There is no UI or API in this issue. The key is `CHAIN_<id>_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS`; unset ships dark. Stories 3 to 6 need testnet writes on the SecurityRegistry, which do not exist yet (at ledger 5 585 892 the contract had emitted nothing and `next_loan_id()` of the loan registry was 0); they run in the epic QA pass #1777.

---

## Story 1 — The key is set and the indexer is enabled

**Given** the testnet SecurityRegistry id from `.env.example` set as `CHAIN_99000001_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS`, after the interface check (`register` / `perfect` / `record`)

**When** the worker starts

**Then:**

- It logs "Stellar SecurityRegistry indexer enabled" with the id
- `security_registry_state` gets a row within a minute with `loan_registry = CDWN5B3F…`, `paused = false` and `inspectors = []`
- There are no SecurityRegistry `warn` lines
- Setting the same id as `COLLATERAL_REGISTRY_ADDRESS`, `POCKET_ADDRESS` or `LOAN_REGISTRY_ADDRESS` fails startup with an error naming `SECURITY_REGISTRY_ADDRESS`
- With the key unset the worker polls no SecurityRegistry events, spawns no sync task and the tables stay empty

---

## Story 2 — Setting the key on the legacy CollateralRegistry key is flagged

**Given** the SecurityRegistry id set by mistake as `…_COLLATERAL_REGISTRY_ADDRESS`

**When** the contract emits `record_registered`, `terms_set` or `inspection_recorded`

**Then:**

- The worker warns once per process that the id looks like a SecurityRegistry and belongs in `…_SECURITY_REGISTRY_ADDRESS`
- No `Security…` row is written and the legacy rows for the legacy id are unchanged

---

## Story 3 — A loan's security flow is stored and projected

**Given** the key set and a loan with terms, one goods record registered, perfected and revalued

**When** the sync task has run a cycle (about 30 s)

**Then:**

- `contract_logs` has `SecurityTermsSet`, `SecurityRecordRegistered`, `SecurityRecordPerfected` and `SecurityRevalued` rows with decimal-string ids and lowercase-hex hashes
- `security_terms` has the loan's terms with `complete = true`; `security_records` has the record `Active` with the mark from the event
- `security_records.attested_by` equals the perfecting agent once the record snapshot is stored, and `needs_view` is `false`
- `security_record_docs` has the `Perfection` doc with source `perfection`
- NFT `mint` / `burn` events produce no row and no warning

---

## Story 4 — Margin call, cure and valuation

**Given** the loan of Story 3 and a margin call that opens and is later cured

**When** the Trustee side reads the tables

**Then:**

- `security_margin_call_events` has `open` (with `cure_by`) then `cured` rows, and `security_terms.margin_call_at` is 0 after the cure
- `security_loan_valuations.ltv_bps` equals the contract's `coverage_detail(loan_id).ltv_bps` at `detail_ledger`
- While the loan has debt the valuation refreshes at least every 5 minutes; with no debt it refreshes only after a new event

---

## Story 5 — Inspections and the lot's latest inspection

**Given** an inspection recorded and approved by two different operators, flagged by a variance

**When** the flag is resolved with `Accepted`

**Then:**

- `security_inspections` has the row with entered fields, approval, the three variances and `flagged = true`, then the resolution
- The record's `reference_quantity` is the inspection's quantity and its `flagged_by` is 0
- `security_lots.latest_inspection_id` is the latest non-assay inspection of the lot

---

## Story 6 — A key set after the first writes is seeded from views

**Given** the contract wrote records before the key was set and the cursor was not rewound

**When** the sync task runs

**Then:**

- Discovery reads `record(1…)` and `inspection(1…)` until the first missing id and stores snapshots
- Seeded rows have `complete = false` and docs with source `view`
- Events after each snapshot's ledger are applied on top

---

## Story 7 — A failing RPC read does not stall indexing

**Given** the key set and the Soroban RPC refusing `simulateTransaction`

**When** the SecurityRegistry emits events

**Then:**

- `contract_logs` rows are still written and the cursor advances
- The first failed read per entity is a `warn`, later ones are `debug`, and reads back off
- Projection and valuation resume on their own once reads succeed
