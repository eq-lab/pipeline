# User story: #1938 — EVM SecurityRegistry indexer: records, terms, marks, margin calls, inspections (SecurityRegistry + RecordNft)

**Epic:** #1937
**Issue:** https://github.com/eq-lab/pipeline/issues/1938
**Status:** Initial

---

## Overview

The worker indexes the business events of the EVM SecurityRegistry and its RecordNft into `contract_logs`, fills what events do not carry with view snapshots read from the Reader, and projects records, terms, inspections, lots, docs, margin-call and default-breach history, extension consents and a per-loan valuation into the same projection tables as Stellar. It is the Stellar indexer (#1779) on EVM: same flow, tables and sync task. Spec: `docs/references/security-registry-events.md`.

Persona: operator (worker logs, env keys, database). There is no UI or API in this issue (#1940 serves the data). The keys are `CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS`, `…_SECURITY_RECORD_NFT_ADDRESS` and `…_SECURITY_REGISTRY_READER_ADDRESS`; all three are set together, and unset they ship dark. The Hoodi chain id is 560048 (`VITE_EVM_CHAIN_ID` in `.env.example`) and the addresses are those of `pipeline-contracts` `deployments/hoodi-v5.json`: registry `0xB51E7f13420D106946376A67Fe5921C63B09BE15`, RecordNft `0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09`, Reader `0x8e7078c73068F9F3d4e2210cfe5B4981eB7f1b6B`. Stories 3 to 5 need Hoodi writes on the SecurityRegistry and run in the epic QA pass.

---

## Story 1 — The keys are set and the indexer is enabled

**Given** the three Hoodi addresses above set as `CHAIN_560048_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS`, `…_SECURITY_RECORD_NFT_ADDRESS` and `…_SECURITY_REGISTRY_READER_ADDRESS`

**When** the worker starts

**Then:**

- It logs "EVM SecurityRegistry indexer enabled" with the three addresses
- `security_registry_state` gets a row within a minute with `loan_registry` equal to the configured `…_LOAN_REGISTRY_ADDRESS`, `paused = false` and the RecordNft's current `inspectors`
- There are no SecurityRegistry `warn` lines
- Setting only one or two of the three keys fails startup with an error naming the missing key
- Setting any of the three equal to another configured role (`DEPOSIT_MANAGER`, `LOAN_REGISTRY`, `COLLATERAL_REGISTRY`, each other, …) fails startup with "duplicates another configured contract address; each role must point at a distinct contract" naming the key
- A malformed address fails startup with an error naming the key
- With all three unset the worker polls no SecurityRegistry events, spawns no sync task and the `security_*` tables stay empty

---

## Story 2 — The SecurityRegistry address set as the legacy CollateralRegistry key is flagged

**Given** the SecurityRegistry address set by mistake as `…_COLLATERAL_REGISTRY_ADDRESS`

**When** the contract emits `RecordRegistered`, `TermsSet` or `MarginCall`

**Then:**

- The worker warns once per process that the address looks like a SecurityRegistry and belongs in `…_SECURITY_REGISTRY_ADDRESS`
- No `Security…` row is written and the legacy rows for the legacy address are unchanged

---

## Story 3 — A loan's security flow is stored and projected

**Given** the keys set and a loan with terms, one goods record registered, perfected, documented and revalued

**When** the sync task has run a cycle (about 30 s)

**Then:**

- `contract_logs` has `SecurityTermsSet`, `SecurityRecordRegistered`, `SecurityRecordPerfected`, `SecurityRevalued` rows under the registry address and the `SecurityDocAdded` row under the RecordNft address, with decimal-string ids, lowercase-hex hashes and EIP-55 addresses
- `security_terms` has the loan's terms with `complete = true`, including `default_ratio_bps`, `originator_fee_rate` and `default_breach_at`; `security_records` has the record `Active` with the mark from the event
- A non-goods record registered at USD has the par mark `1000000` with benchmark `PAR`
- `security_records.attested_by` equals the perfecting agent once the record snapshot is stored, and `needs_view` is `false`
- `security_record_docs` has the `Perfection` doc with source `perfection` and the added doc with source `event`
- RecordNft `Transfer` (mint and burn) produces no row and no warning

---

## Story 4 — Margin call, default breach, cure and valuation

**Given** the loan of Story 3, a margin call that opens, a default breach that opens and clears, and a cure

**When** the Trustee side reads the tables

**Then:**

- `security_margin_call_events` has `open` (with `cure_by`), `default_breach` (with `default_ratio_bps`), `default_breach_price_stale`, `default_breach_cleared` and `cured` rows in order
- `security_terms.margin_call_at` is 0 after the cure and `default_breach_at` is the breach time while it is open and 0 after the clear
- `security_loan_valuations.ltv_bps` equals the Reader's `coverageDetail(loanId).ltvBps` at `detail_ledger`, and `default_breach_at` equals its `defaultBreachAt`
- `outstanding` and `accrued_interest` come from `loanMoney(loanId)` at `money_ledger`; the two heights may differ by a block
- While the loan has debt the valuation refreshes at least every 5 minutes; with no debt it refreshes only after a new event

---

## Story 5 — Inspections and the lot's latest inspection

**Given** an inspection recorded and approved by two different operators, flagged by a variance

**When** the flag is resolved with `Accepted`

**Then:**

- `contract_logs` has `SecurityInspectionRecorded` and `SecurityInspectionApproved` rows under the RecordNft address and `SecurityFlagResolved` under the registry address
- `security_inspections` has the row with entered fields, approval, the three variances and `flagged = true`, then the resolution
- The record's `reference_quantity` is the inspection's quantity and its `flagged_by` is 0
- `security_lots.latest_inspection_id` is the latest non-assay inspection of the lot
- `security_registry_state.inspectors` equals the RecordNft's `inspectors()`

---

## Story 6 — Keys set after the first writes are seeded from views; a cursor rewind backfills everything

**Given** the contract wrote records before the keys were set and the cursor was not rewound

**When** the sync task runs

**Then:**

- Discovery reads `Reader.record(1…)` and `RecordNft.inspection(1…)` until the first missing id (`SecurityRegistryNonExistentRecord` / `SecurityRecordNftNonExistentInspection`) and stores snapshots
- Seeded rows have `complete = false` and docs with source `view`
- Events after each snapshot's block are applied on top

**Given** instead the chain cursor rewound to the SecurityRegistry deploy block (worker stopped, `UPDATE log_collector_state SET last_indexed_block = <deploy block> WHERE chain_id = 560048`)

**Then:**

- The full history is indexed, rows have `complete = true` and the margin-call and default-breach history is whole
- Replays do not duplicate `contract_logs` rows

---

## Story 7 — A failing view read does not stall indexing

**Given** the keys set and the RPC failing `eth_call`

**When** the SecurityRegistry emits events

**Then:**

- `contract_logs` rows are still written and the cursor advances
- The first failed read per entity is a `warn`, later ones are `debug`, and reads back off
- A wrong Reader address shows as failing `coverageDetail` reads per loan and no valuation rows, while records, terms and events are still projected
- Projection and valuation resume on their own once reads succeed
