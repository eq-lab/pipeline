# Issue #1779: Stellar SecurityRegistry indexer: events, record enrichment, projection tables

Source: https://github.com/eq-lab/pipeline/issues/1779

Parent epic: #1775, merge-order step 2. Foundation for #1780 (API), #1781 (audit log), #1783, #1784 and
#1785. Base: `origin/main` at `6b568fc2`, which already holds the epic #1776 work this plan reuses: the
routing-by-contract-id branch and the view-seed loop of #1789 (Pocket), #1788, #1790, #1791, #1793, #1794.

**Deadline: the testnet deploy ledger 5 569 998 leaves Soroban RPC retention on about 2026-11-12.**
See [Rollout](#rollout-and-the-retention-deadline).

## Scope

### Source of truth (checked 2026-11-06)

- **Contracts:** `pipeline-stellar-contracts@e9881ac`, `contracts/security-registry` (`event.rs`,
  `types.rs`, `lib.rs`, `storage.rs`, `error.rs`). #40 added the soulbound record NFT, #41 on-chain
  inspections, #42 the testnet deploy. Contracts are frozen; nothing here asks for a contract change.
- **Testnet deployment (#42):** SecurityRegistry `CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX`,
  stored under the `collateral_registry` key of `addresses.json` (the trap in backend.md). Deployed around
  ledger 5 569 998.
- **Testnet state, verified by the planner at ledger 5 585 892:**
  - `getEvents` for the contract from ledger 5 569 990 returns nothing;
  - `record(1)` fails with `Error(Contract, #1)` (`NonExistentRecord`);
  - `inspection(1)` fails with `Error(Contract, #25)` (`NonExistentInspection`);
  - `inspectors()` = `[]`, `paused()` = `false`;
  - `loan_registry()` = `CDWN5B3FFX25TSL6T2NEW5LPTW4VYFUXCXPMNIFRBMJYILEOAL5TVXZQ`, the indexed testnet
    LoanRegistry, whose `next_loan_id()` is `0`;
  - RPC retention: `oldestLedger` 5 464 933, 5.0 s per ledger.

  So nothing has happened on the SecurityRegistry yet.
- **Event encoding, verified by running the `default_flow.rs` enforcement scenario at `e9881ac` in a scratch
  copy and dumping the events:**
  - every business event is `#[contractevent]` with the default map format;
  - `topics[0]` is the snake_case symbol, `#[topic]` fields follow in declaration order;
  - `value` is an `ScMap` of the remaining fields;
  - `Terms` is a nested `ScMap` under the key `terms`;
  - unit enums (`Protection`, `DocKind`, `PaymentTerm`, `InspectionKind`, `FlagOutcome`) are
    `ScVal::Vec([Symbol(variant)])`;
  - a field-less event (`enforcement_started`) has an empty map as `value`;
  - the NFT events are `["mint", to]` / `["burn", from]` with value `{token_id: u32}`.
- **OpenZeppelin 0.7.1 admin events** (cargo registry sources):
  - Pausable: `paused` and `unpaused`, both with an empty value;
  - Ownable: `ownership_transfer`, `ownership_transfer_completed` and `ownership_renounced`;
  - Upgradeable: emits no contract event.

### Decisions this plan follows (human, from the issue and epic comments)

- Record NFT `mint` / `burn` are allow-listed and **not stored**: no `contract_logs` row, no projection,
  no holder column (comment 2026-11-03).
- The Stellar AccessManager is not indexed.
- Contracts are frozen.
- The legacy CollateralRegistry key (`CBSMJS5Q…` on testnet) and its parser stay, as history.
- Inspections are on-chain since #41. This plan indexes and projects them so that #1780 and #1784 can use
  them. #1782 is awaiting a human decision; see [What #1782 would no longer need](#what-1782-would-no-longer-need).

### Stored events

Rows land in `contract_logs` through the existing `StellarLogMapper`.

**Encoding rules** (same as `collateral-registry-events.md` and the minter):

- ids (`loan_id`, `record_id`, `lot_id`, `inspection_id`, and the from / to record ids) are decimal
  strings;
- `u32` bps fields and the signed `i32` variances are JSON numbers;
- `u64` times and durations are decimal strings;
- `i128` amounts are decimal strings, raw at 7 dp;
- `BytesN<32>` is lowercase hex without `0x`;
- enums are the variant name;
- addresses are the Strkey (`G…` / `C…`);
- `bool` is a JSON bool.

Every stored name carries a `Security` prefix. None of them exists today (see Test Strategy, collision
test). The legacy names `Revalued`, `DocAdded`, `MarginCall` and `Released` are still written by the EVM
CollateralRegistry and by the legacy Stellar parser.

| On-chain topic | Topics after the symbol | Value map | Stored `event_name` | Stored `params` |
|---|---|---|---|---|
| `record_registered` | `loan_id`, `record_id` | `lot_id`, `protection` | `SecurityRecordRegistered` | `loan_id`, `record_id`, `lot_id`, `protection` |
| `record_perfected` | `loan_id`, `record_id` | `evidence_hash` | `SecurityRecordPerfected` | `loan_id`, `record_id`, `evidence_hash` |
| `record_handed_over` | `loan_id`, `from_record_id`, `to_record_id` | `evidence_hash` | `SecurityRecordHandedOver` | `loan_id`, `from_record_id`, `to_record_id`, `evidence_hash` |
| `record_attested` | `loan_id`, `record_id` | `attested_by` | `SecurityRecordAttested` | `loan_id`, `record_id`, `attested_by` |
| `doc_added` | `loan_id`, `record_id` | `kind`, `sha256` | `SecurityDocAdded` | `loan_id`, `record_id`, `kind`, `sha256` |
| `record_released` | `loan_id`, `record_id` | `reason_hash`, `by_consent` | `SecurityRecordReleased` | `loan_id`, `record_id`, `reason_hash`, `by_consent` |
| `mandate_breach` | `loan_id` | `evidence_hash` | `SecurityMandateBreach` | `loan_id`, `evidence_hash` |
| `enforcement_started` | `loan_id`, `record_id` | (empty) | `SecurityEnforcementStarted` | `loan_id`, `record_id` |
| `record_enforced` | `loan_id`, `record_id` | `proceeds_hash` | `SecurityRecordEnforced` | `loan_id`, `record_id`, `proceeds_hash` |
| `terms_set` | `loan_id` | `terms` (12-field map) | `SecurityTermsSet` | `loan_id` plus the 12 `Terms` fields **flattened**: `advance_ratio_bps`, `margin_call_ratio_bps`, `default_rate`, `tolerance_bps`, `grade_tolerance_bps` (numbers); `cure_period`, `price_stale_after`, `grace_period`, `attestation_interval`, `inspection_interval`, `margin_call_at` (strings); `payment_term` (variant) |
| `revalued` | `loan_id`, `record_id` | `value_per_unit`, `benchmark`, `report_hash` | `SecurityRevalued` | `loan_id`, `record_id`, `value_per_unit`, `benchmark` (the Symbol text), `report_hash` |
| `margin_call` | `loan_id` | `ltv_bps`, `margin_call_ratio_bps`, `cure_by` | `SecurityMarginCall` | `loan_id`, `ltv_bps`, `margin_call_ratio_bps`, `cure_by` |
| `price_stale` | `loan_id` | `ltv_bps`, `margin_call_ratio_bps` | `SecurityPriceStale` | `loan_id`, `ltv_bps`, `margin_call_ratio_bps` |
| `margin_call_cured` | `loan_id` | `ltv_bps` | `SecurityMarginCallCured` | `loan_id`, `ltv_bps` |
| `inspection_recorded` | `loan_id`, `record_id`, `inspection_id` | `lot_id`, `inspector`, `kind` | `SecurityInspectionRecorded` | `loan_id`, `record_id`, `inspection_id`, `lot_id`, `inspector`, `kind` |
| `inspection_approved` | `loan_id`, `record_id`, `inspection_id` | `approved_by`, `variance_reference_bps`, `variance_previous_bps`, `variance_grade_bps`, `flagged` | `SecurityInspectionApproved` | all of them |
| `flag_resolved` | `loan_id`, `record_id` | `inspection_id`, `outcome`, `reason_hash` | `SecurityFlagResolved` | `loan_id`, `record_id`, `inspection_id`, `outcome`, `reason_hash` |
| `extension_consent` | `loan_id` | `new_maturity`, `consent_hash` | `SecurityExtensionConsent` | `loan_id`, `new_maturity`, `consent_hash` |
| `inspectors_set` | (none) | `inspectors: Vec<Address>` | `SecurityInspectorsSet` | `inspectors` (JSON array of Strkeys, in order) |
| `loan_registry_set` | (none) | `loan_registry` | `SecurityLoanRegistrySet` | `loan_registry` |
| `paused` / `unpaused` | (none) | (empty) | `SecurityRegistryPaused` / `SecurityRegistryUnpaused` | `{}` |

**Allow-listed, never stored, no warning:** `mint`, `burn`, `ownership_transfer`,
`ownership_transfer_completed` and `ownership_renounced`.

- The issue's scope (2) allow-lists the Ownable events, as for the Pocket. Only pause state is recorded,
  because every write, `check_coverage` included, is `when_not_paused`.
- Any other topic from the SecurityRegistry id logs a `warn` and is dropped.
- A recognised topic that fails to decode logs a `warn` and is dropped (same as `dispatch_pocket`).

### Architecture: three layers, no RPC in `index_once`

1. **Index path** (inside `index_once`'s transaction).
   - `poll` routes events whose `contract_id` equals the configured SecurityRegistry id to
     `dispatch_security_registry`, before `dispatch_parser`. This is the #1789 Pocket pattern.
   - Rows are written by the unchanged `StellarLogMapper`: no simulate and no projection write.
   - A failing RPC read therefore cannot fail `index_once`: the index path has no RPC client.
2. **Sync loop** `run_security_registry_sync_loop`. A separate `tokio::spawn`ed task, like
   `run_pocket_seed_loop`, started only when the key is set. Every `SECURITY_SYNC_INTERVAL` (30 s), each
   step is best-effort and logs instead of returning errors:
   1. **Snapshot reads.** Simulate the views a record, inspection, loan or the contract needs and upsert
      them into `security_view_snapshots` with `as_of_ledger = simulateTransaction.latestLedger`. This
      covers enrichment, the post-retention seed, and the fields events do not carry.
   2. **Projection.** For each dirty loan, run the pure fold over its `contract_logs` rows and snapshots, and
      rewrite that loan's projection rows in one DB transaction.
   3. **Valuation.** Simulate `coverage_detail(loan_id)` on the SecurityRegistry and `loan_money(loan_id)`
      on its loan registry. Upsert `security_loan_valuations`. This runs after any SecurityRegistry or
      LoanRegistry row touching the loan, and on a 5-minute timer while the loan has debt.
3. **Pure fold** `shared::security_registry`. Every projection row is a function of
   (indexed events, snapshots), so it is unit-tested without a DB.

### Fold rule (snapshot + later events, the #1789 seed rule generalised)

**Per entity** (record, inspection, a loan's terms and consents, the contract's state):

- **With a snapshot at ledger `V`:** start from the snapshot and apply only that entity's events with
  `block_number > V`. A simulate reads the state after ledger `V`, so events at or below `V` are already
  in it.
- **Without a snapshot:** fold from its events alone. Fields that no event carries stay `NULL`, and the
  row has `needs_view = true`.
- **Neither:** no row. The sync loop requests a snapshot.

**History is always event-only:** the margin-call history, doc and consent provenance, inspection
`flagged`, and flag resolutions.

**`complete`:**

- a record is `complete` when its `SecurityRecordRegistered` row is indexed;
- an inspection is `complete` when its `SecurityInspectionRecorded` row is indexed;
- terms are `complete` when a `SecurityTermsSet` row is indexed.

`complete = false` means the row was seeded from views and its history is partial. This is the same
meaning as the Pocket's `complete`.

**Docs and consents keep their order and provenance by labelling the snapshot's tail**
(`label_snapshot_tail`).

- **The snapshot list is labelled from its tail.** Its last `k` entries belong, in order, to the `k`
  indexed appending events at or below `V`:
  - `SecurityDocAdded` labels a doc `event`;
  - `SecurityRecordPerfected` and the `to` side of `SecurityRecordHandedOver` label it `perfection`;
  - `SecurityRecordEnforced` labels it `proceeds`;
  - for consents, `SecurityExtensionConsent` supplies `new_maturity` and the ledger.
- **The leading entries are the rest:**
  - for docs, `register` when the record is `complete` (the initial `NewRecord.docs`), else `view`;
  - for consents, `new_maturity` and the ledger are `NULL`.
- **Events after `V` append.**
- **This needs every event at or below `V` indexed.** So the loop stores a snapshot only once the chain
  cursor has passed `V` (`last_indexed_block > V`). A read made while the indexer still trails `V` is held
  in memory and stored on a later cycle.

### Per-event fold effects (events after the entity's snapshot, or all without one)

| Stored name | Effect on the projection |
|---|---|
| `SecurityRecordRegistered` | New record:<br>• `status = PendingPerfection`, with `loan_id`, `lot_id`, `protection` and `registered_ledger`;<br>• a non-goods protection (`AssignedReceivable`, `LcProceeds`, `CashCover`, `Prepayment`, `InsuranceLossPayee`) gets the implicit par mark `{value_per_unit: 10000000, at: ts, benchmark: "PAR", report_hash: 0…0}` (`lib.rs:1131-1144`);<br>• the lot row is ensured. |
| `SecurityRecordPerfected` | Implicit changes (`activate`, `lib.rs:1037-1047`):<br>• `status = Active`;<br>• `perfected_at = attested_at = ts`;<br>• `attested_by` is unknown (the caller is not in the event), so `NULL` and `needs_view`;<br>• append doc `{Perfection, evidence_hash, source: perfection}`. |
| `SecurityRecordHandedOver` | **`to`** takes the same effects as perfected, plus the implicit mark copy (`lib.rs:209-211`):<br>• when both records' `commodity` and `unit` are known (from snapshots; they never change) and equal, `to.mark` = `from`'s folded mark;<br>• when they are known and differ, `to.mark` is unchanged;<br>• when either is unknown, `to.mark` is unchanged and `to.needs_view` is set.<br>**`from`:** `status = Released`, `closed_ledger`. |
| `SecurityRecordAttested` | `attested_by` (from the event), `attested_at = ts`. |
| `SecurityDocAdded` | Append doc `{kind, sha256, source: event}`. |
| `SecurityRecordReleased` | `status = Released`, `closed_ledger`, `release_reason_hash`, `released_by_consent = by_consent`. |
| `SecurityEnforcementStarted` | `status = UnderEnforcement`. |
| `SecurityRecordEnforced` | `status = Enforced`, `closed_ledger`, and append doc `{Proceeds, proceeds_hash, source: proceeds}` (`lib.rs:340-343`). |
| `SecurityRevalued` | `mark = {value_per_unit, at: ts, benchmark, report_hash}`. Applies in any status and to USD records (`revalue` has no status check; a USD mark is data only). |
| `SecurityInspectionRecorded` | New inspection:<br>• `loan_id`, `record_id`, `lot_id`, `inspector`, `kind`, `entered_at = ts`, `recorded_ledger`;<br>• the entered fields (`inspected_at`, `region`, `site_hash`, `quantity`, `grade`, `certificate_hash`, `certificate_no`, `entered_by`) come from the `inspection(id)` snapshot; they are immutable after entry. |
| `SecurityInspectionApproved` | `approved_by`, `approved_at = ts`, the three variances, `flagged`, `approved_ledger`. If `flagged`, the record's `flagged_by = inspection_id` (a later breach takes it over). |
| `SecurityFlagResolved` | **On the inspection:** `resolution = outcome`, `resolution_reason_hash`, `resolved_at`. Always from the latest such event; resolution is event-only.<br>**On the record:**<br>• `Accepted`: `reference_quantity` = the flagging inspection's `quantity` unless its kind is `SamplingAssay`, and `reference_grade` = its `grade` when that is not 0 (`lib.rs:1022-1033`); `flagged_by = 0`. When that inspection's snapshot is missing, the reference is left unchanged and `needs_view` is set.<br>• `TopUpRequired`: `flagged_by = 0`.<br>• `Escalated`: no change. |
| `SecurityTermsSet` | Terms = the event's fields. The event carries the contract-kept `margin_call_at`. |
| `SecurityMarginCall` | `terms.margin_call_at = ts`, plus a history row `open` with `ltv_bps`, `margin_call_ratio_bps` and `cure_by` as fixed by the event. A `resolve_flag(TopUpRequired)` call opens one too, through the same event. |
| `SecurityPriceStale` | History row `price_stale`. |
| `SecurityMarginCallCured` | `terms.margin_call_at = 0`, plus a history row `cured`. |
| `SecurityExtensionConsent` | Append consent `{consent_hash, new_maturity, ledger}`. |
| `SecurityMandateBreach` | No projection state. The `contract_logs` row is the record; #1781 and #1784 read it. |
| `SecurityInspectorsSet`, `SecurityLoanRegistrySet`, `SecurityRegistryPaused` / `…Unpaused` | Contract state: the latest of (contract snapshot at `V`, events after `V`), per field. |

**Lot latest inspection.** This is the on-chain `LotLatestInspection`, which caps a goods record's
counted quantity at min(paper, latest) (`lib.rs:857-862`).

- Candidates are the lot's approved inspections whose kind is not `SamplingAssay`, with
  `inspected_at` / `quantity` known.
- The latest is the one with the largest `inspected_at`. On a tie, the later approval wins, ordered by
  `(approved_ledger, approval log_index)` or, for seeded rows, by `(approved_at, inspection_id)`. This
  mirrors `approve_inspection`'s `>=` (`lib.rs:456-469`).
- The result is unknown (`complete = false`) while any approved quantity inspection of the lot lacks a
  snapshot.
- Inspections carry over a handover, because they are keyed by lot.

### Projection tables (migration `20261106000001_security_registry.sql`, additive)

Every table is keyed by `(chain_id, contract_address, …)`. Ids are `BIGINT` (`u32` on-chain).
`u64` times and durations, and `i128` / `u128` amounts, are `NUMERIC` (a `u64` can exceed `BIGINT`).
Hashes and enums are `TEXT`.

| Table | Key | Columns |
|---|---|---|
| `security_view_snapshots` | `(chain_id, contract_address, kind, entity_id)`; `kind` ∈ `record`, `inspection`, `loan`, `contract`; `entity_id` = 0 for `contract` | `loan_id BIGINT NULL`, `as_of_ledger BIGINT`, `payload JSONB`, `fetched_at TIMESTAMPTZ DEFAULT now()` |
| `security_registry_state` | `(chain_id, contract_address)` | `paused BOOL NULL`, `inspectors JSONB NULL`, `loan_registry TEXT NULL`, `projection_version INT DEFAULT 0`, `projected_log_id BIGINT DEFAULT 0`, `projected_snapshot_at TIMESTAMPTZ NULL`, `updated_at` |
| `security_terms` | `+ loan_id` | the 11 `Terms` fields, `margin_call_at`, `set_ledger BIGINT NULL`, `complete BOOL`, `updated_at` |
| `security_records` | `+ record_id` | **Identity:** `loan_id`, `lot_id`, `protection`.<br>**Descriptive (`NULL` until a snapshot):** `commodity`, `unit`, `reference_quantity`, `reference_grade`, `region`, `site_hash`, `control_kind`, `control_reference`, `perfection`, `release_condition`.<br>**State:** `status`, `perfected_at`, `attested_by`, `attested_at`, `flagged_by`.<br>**Latest mark:** `mark_value_per_unit`, `mark_at`, `mark_benchmark`, `mark_report_hash`.<br>**Lifecycle:** `registered_ledger`, `closed_ledger`, `release_reason_hash`, `released_by_consent`.<br>**Provenance:** `complete`, `needs_view`, `view_ledger`, `updated_at`.<br>Index `(chain_id, contract_address, loan_id)`. |
| `security_record_docs` | `+ record_id, position INT` | `loan_id`, `kind`, `sha256`, `source` (`register` / `event` / `perfection` / `proceeds` / `view`), `ledger BIGINT NULL` |
| `security_margin_call_events` | `+ block_number, log_index` | `loan_id`, `kind` (`open` / `price_stale` / `cured`), `ltv_bps BIGINT`, `margin_call_ratio_bps BIGINT NULL`, `cure_by NUMERIC NULL`, `block_timestamp BIGINT`, `tx_hash TEXT` |
| `security_inspections` | `+ inspection_id` | **Identity:** `loan_id`, `record_id`, `lot_id`, `inspector`, `kind`.<br>**Entered fields:** `inspected_at`, `region`, `site_hash`, `quantity`, `grade`, `certificate_hash`, `certificate_no`, `entered_by`, `entered_at`.<br>**Approval:** `approved_by`, `approved_at`, `variance_reference_bps INT`, `variance_previous_bps INT`, `variance_grade_bps INT`, `flagged BOOL NULL`.<br>**Resolution:** `resolution`, `resolution_reason_hash`, `resolved_at`.<br>**Ledgers and provenance:** `recorded_ledger`, `approved_ledger`, `complete`, `needs_view`. |
| `security_lots` | `+ lot_id` | `loan_id`, `latest_inspection_id BIGINT NULL`, `latest_inspected_at NUMERIC NULL`, `latest_quantity NUMERIC NULL`, `complete BOOL` |
| `security_extension_consents` | `+ loan_id, position INT` | `consent_hash`, `new_maturity NUMERIC NULL`, `ledger BIGINT NULL`, `block_timestamp BIGINT NULL` |
| `security_loan_valuations` | `+ loan_id` | **From `coverage_detail`:** `value`, `stale_value`, `flagged_value`, `debt` (7 dp, raw), `coverage_bps`, `ltv_bps`, `margin_call_at`, `cure_by`, `price_stale`, `counted_records JSONB` (`record_id`, `counted_quantity`, `value_per_unit`, `mark_at`, `stale`, `flagged`), `detail_ledger`.<br>**From `loan_money`:** `loan_registry`, `outstanding`, `accrued_interest`, `money_ledger`.<br>**Refresh bookkeeping:** `source_log_id BIGINT`, `fetched_at`. |

Notes:

- **Valuation snapshot.** `coverage_detail` already gives `value` (= `collateral_value(loan_id)`, divided
  by 1e7 once), the contract's `debt`, and `ltv_bps` / `coverage_bps` at one ledger. It replaces the
  separate `collateral_value` read in the issue text. `loan_money` adds the split of `debt` into
  `outstanding` and `accrued_interest`. Both are stored raw at 7 dp, with no base-6 normalisation.
- **`coverage_detail` panics without terms** (`NoTerms`, `#14`). Only loans with a `security_terms` row are
  valued.
- **`loan_money` is read from the SecurityRegistry's own `loan_registry`.** That is the source of the
  contract's debt figure; `SecurityLoanRegistrySet` changes it. When it differs from the configured
  `…_LOAN_REGISTRY_ADDRESS`, the loop warns once per process.

### Snapshot reads (sync step 1)

- **Record `r`:**
  - read when it has no snapshot;
  - read when a `SecurityRecordPerfected(r)` or a `SecurityRecordHandedOver` with `to_record_id = r` is
    newer than its snapshot, to learn the implicit `attested_by = caller` (`lib.rs:1045`).
- **Inspection `i`:** read once, when it has no snapshot. Its entered fields never change.
- **Loan `l`:** `terms(l)` (`NoTerms` → stored as `terms: null`) and `extension_consents(l)`, each with
  its own ledger in the payload. Read when the loan is known but has no indexed `SecurityTermsSet` and no
  loan snapshot. A loan is known from SecurityRegistry rows, from record snapshots, or from `LoanDrawn`
  rows on the configured loan registry.
- **Contract:** `paused()`, `inspectors()` and `loan_registry()`.
  - Read at loop start and then hourly.
  - `as_of_ledger` is the smallest of the three ledgers. Re-applying the absolute-valued events between
    them is harmless.
  - The initial `loan_registry` is set by the constructor without an event, so this read is always
    needed.
- **Discovery** (the post-retention seed). At loop start and hourly:
  - probe `record(id)` for `id = 1, 2, …`;
  - skip ids that already have a `SecurityRecordRegistered` row or a snapshot (no RPC for them);
  - stop at the first `Error(Contract, #1)`;
  - do the same for `inspection(id)`, stopping at `Error(Contract, #25)`.

  Ids are global, sequential, and start at 1 (`storage.rs:65-84`), so this finds every record and
  inspection the indexer never saw. On testnet today it costs one simulate each.
- **Errors:**
  - other errors back off per entity (reuse `pocket_seed::backoff_delay`);
  - the first failure per entity per process is warned, later ones are debug;
  - error codes are matched exactly as `Error(Contract, #<n>)`, so that `#1` never matches `#14`.
- **Lag guard:** reads are skipped for a cycle while the chain cursor is more than
  `SNAPSHOT_MAX_LAG = 20` ledgers behind `getLatestLedger`, for example while catching up after a rewind.

### Projection rebuild (sync step 2)

1. Read `max(id)` of the SecurityRegistry's `contract_logs` rows.
2. **Dirty loans** are the loans of:
   - rows with `id > projected_log_id`;
   - snapshots with `fetched_at > projected_snapshot_at`.

   All loans are dirty when `projection_version < SECURITY_PROJECTION_VERSION` (= 1), so a later fold
   change can force a full rebuild.
3. **For each dirty loan:**
   - load its rows (`ORDER BY block_number, log_index`) and its snapshots;
   - fold;
   - in one transaction, delete that loan's rows from `security_records`, `security_record_docs`,
     `security_terms`, `security_margin_call_events`, `security_inspections`, `security_lots` and
     `security_extension_consents`, then insert the new rows.

   Readers see either the old or the new projection.
4. Fold the contract state (`SecurityInspectorsSet`, `SecurityLoanRegistrySet`, `SecurityRegistryPaused` /
   `…Unpaused` rows and the contract snapshot). Upsert `security_registry_state`.
5. **Watermarks advance only if every dirty loan was rebuilt.** A failed loan is retried next cycle; the
   rebuild is idempotent.

### Valuation (sync step 3)

- **Candidates** are loans with a `security_terms` row. A candidate is due when:
  - it has no valuation; or
  - the latest SecurityRegistry or loan-registry `contract_logs` id for that loan is `> source_log_id`; or
  - `fetched_at` is older than `VALUATION_MAX_AGE` (5 min) and the last `debt > 0`. Interest accrues
    without events; a loan with no debt is refreshed only on events.
- Reads are best-effort, with the same backoff and warn-once rules as step 1.

### What #1782 would no longer need

This applies if #1782 is closed as superseded (option (a) on #1782). The contract now does what #1782
planned off-chain:

- **Already on-chain:**
  - four-eyes entry and approval: `record_inspection` / `approve_inspection`, where `SameOperator` refuses
    self-approval;
  - the inspector panel (`set_inspectors`);
  - the variances against reference, previous and grade, with the tolerance flags;
  - flag settlement (`resolve_flag`);
  - the valuation cap.
- **Already in this plan's projection:**
  - inspections per record, entered and approved;
  - the lot's latest inspection;
  - the record's current flag;
  - inspection staleness: `coverage_detail.records[].stale`, plus `security_lots` and `security_terms`.
- **#1782 would no longer need:**
  - its `security_inspections` table (this plan takes that name for the on-chain projection);
  - the create, approve and reject write endpoints;
  - the backend variance maths and thresholds;
  - the `Claims.account_id` four-eyes check;
  - the backend `inspection_overdue` computation, now `coverage_detail` staleness or a read of the
    projection;
  - the `previous_inspection_variance_bps` maths, now `variance_previous_bps`.
- **What could remain, as a rescoped read issue or folded into #1780:**
  - mapping operator wallet addresses (`entered_by` / `approved_by`) to accounts for display;
  - storing the certificate file off-chain (the contract keeps only `certificate_hash`);
  - the Trustee UI follow-up.

### In scope

1. **Worker config:** `CHAIN_<id>_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS`.
   - Optional; empty or whitespace means `None`.
   - Validated with `validate_contract_id` plus a Strkey parse, like `POCKET_ADDRESS`.
   - Joins the distinct-role check as `SECURITY_REGISTRY_ADDRESS`. A value equal to the legacy
     `COLLATERAL_REGISTRY_ADDRESS` fails boot.
2. **Parser** `stellar/security_registry_parsers.rs`; routing and `getEvents` filter in `stellar/poller.rs`.
3. **Legacy trap guard** in `stellar/collateral_registry_parsers.rs`, warn only.
   - When the legacy dispatcher sees a topic that exists only on the SecurityRegistry (`record_registered`,
     `record_perfected`, `terms_set`, `inspection_recorded`, …), it warns once per process that the id
     looks like a SecurityRegistry and belongs in `…_SECURITY_REGISTRY_ADDRESS`.
   - Return values and stored rows are unchanged.
   - Rationale: under the trap the legacy parser silently mis-stores `revalued` and `doc_added`, because
     the third topic is read as `lot_id`.
4. **View decoders and sync loop:** `stellar/security_registry_views.rs` and
   `stellar/security_registry_sync.rs`.
5. **Shared:** `shared::security_registry` (pure fold and types) and `shared::security_registry_repo`
   (SQL as `pub const`).
6. **Migration** (above).
7. **Docs** (see Docs to Update).

### Out of scope

- API and endpoints (#1780), the audit log (#1781), mark suggestions (#1783), alerts (#1784) and
  readiness (#1785).
  - No `AUDIT_EVENT_NAMES` change, so the new rows stay invisible in `/v1/audit-log` until #1781.
  - No API env key.
- EVM SecurityRegistry indexing (#1707, parked). There is no EVM code change.
- AccessManager indexing, NFT holder tracking, and contract or deployment changes.
- The linked minter `CashRepaid` with `sale_id == record_id`. #1780 joins it; this plan stores nothing
  new for it.
- The re-sync of the other #42 testnet ids (minter `CD2LPGLX…`, DealTokenFactory `CBUPKBPK…`) in
  `.env.example` and backend.md. pipeline-test already has them (eq-lab/argocd#503); a #1794-style sync
  issue owns the docs side. This plan touches only the SecurityRegistry line.
- The `argocd` change itself: a separate eq-lab/argocd PR after the image is live (see Rollout).

## Assumptions and Risks

- **No RPC in the index path.** The poller adds one contract id to `getEvents` (chunked at 25 ids,
  `rpc.rs:467`). Everything else is in the sync task.
  - A panicking or erroring sync step is caught per step and logged.
  - The spawned task is wrapped like `spawn_pocket_seed`: `AbortOnDrop` plus a panic log.
- **Current-state reads only.** `simulateTransaction` cannot be pinned to a ledger (TD-19). The fold's
  "snapshot at `V` + events > `V`" rule makes that safe for state.
  - `coverage_detail` and `loan_money` are two simulates and can be one or two ledgers apart, which is a
    few seconds of interest. `ltv_bps` / `coverage_bps` come from the single `coverage_detail` read, so
    they are self-consistent.
  - Logged as tech debt.
- **Seeded history is partial.** Data that existed only in events emitted before the key was set, and
  beyond retention, is lost:
  - the margin-call history and the opening event's `cure_by`;
  - doc provenance (`view`);
  - consent maturities;
  - inspection `flagged` for flags that are no longer current;
  - resolution history.

  Rows show `complete = false`. On testnet nothing has been emitted yet, so nothing is at risk if the key
  is set before the first write.
- **Docs labelling needs every event ≤ `V` indexed.** This is enforced by storing snapshots only once the
  cursor has passed `V`. A gap in indexing (key unset for a while, never rewound) mislabels docs the same
  way the Pocket's `complete` can be wrong. Documented, same remedy (rewind within retention).
- **`margin_call_at = 0` collision.** `open_margin_call` stores `now`. At ledger timestamp 0 (contract unit
  tests only), the call does not register as open, and every write re-emits `margin_call`. The fold
  mirrors that: `margin_call_at = ts = 0` means "none". Real networks never have timestamp 0. The replay
  test pins both variants.
- **Issue acceptance vs the contract test.**
  - The issue's replay description (the second revalue emits `margin_call_cured`) matches a real network,
    with non-zero timestamps.
  - Run literally at timestamp 0, `default_flow.rs` instead emits `margin_call` twice, then
    `price_stale` on the first perfect, and no cure (verified in the scratch run).
  - The replay test uses non-zero ledger timestamps as the main case and pins the timestamp-0 sequence as
    a second case.
- **Load.** A cycle per 30 s. Per cycle:
  - simulates only for missing or outdated snapshots;
  - plus due valuations: 2 simulates per loan with terms, every 5 min while it has debt;
  - plus 1–2 discovery probes per hour, and 3 contract reads per hour.

  This is fine for the public testnet RPC.
- **Chain-scoped readers of `contract_logs`.** The new names collide with nothing.
  - The coder greps `packages/{api,shared}/src` for `contract_logs` queries that filter by
    `params->>'loan_id'` without an `event_name` or `contract_address` filter, and confirms that none
    exists. The ones seen during planning all filter by name.
  - `AUDIT_EVENT_NAMES` is an allow-list, so the audit log is unaffected.
- **`params->>'loan_id'` text equality.** It is used for the loan-registry dirty check. Stellar loan ids are
  stored as plain decimal strings; the coder verifies this on a `LoanDrawn` fixture.
- **#1782 table name.** If #1782 is rescoped instead of closed, it must not reuse `security_inspections`
  (see Open Questions).
- **Lint:** the docs linter runs as
  `/Users/aabliazimov/Documents/work/pipeline/node_modules/.bin/tsx scripts/lint-docs.ts` from the
  worktree root (the worktree has no `node_modules`).

## Rollout and the retention deadline

### Merge ships dark

- Neither pipeline-test nor prod sets `…_SECURITY_REGISTRY_ADDRESS` (eq-lab/argocd#503 leaves it out on
  purpose). Unset means:
  - no polling and no sync task;
  - empty tables;
  - no behaviour change on Stellar or on EVM Hoodi.
- The migration only creates tables; the previous image ignores them, so a rollback boots.

### Deadline: about 2026-11-12

- **Arithmetic:** RPC retention keeps about 120 960 ledgers (`oldestLedger` 5 464 933 at 2026-11-06,
  5.0 s per ledger). The deploy ledger 5 569 998 leaves retention after
  (5 569 998 − 5 464 933) × 5 s ≈ 6.1 days, i.e. around 2026-11-12.
- **Re-check before acting:** `getEvents` returns the current `oldestLedger`. Re-check it on the day of the
  ops step.

### Ops steps (pipeline-test, chain 99000001)

These go into backend.md "Stellar contract ids and signer roles", and are restated in the PR description.

1. **Wait for the image.** The worker image containing this change must be live on pipeline-test (check
   the deployed tag). Older images ignore the key.
2. **Trap check.** Run
   `stellar contract info interface --id CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX --network testnet`
   and expect `register` / `perfect` / `record`.
3. **First-event check.** Call `getEvents` with `startLedger` 5 569 998 and a `contract` filter on that
   id.
   - **No events:** no rewind is needed. Setting the key indexes everything from the current cursor,
     because the contract emitted nothing before.
   - **Events found:** with the worker stopped, run
     `UPDATE log_collector_state SET last_indexed_block = 5569998 WHERE chain_id = 99000001`, or any
     ledger at or below the first event. Then restart. Replays dedupe on `contract_logs`
     `UNIQUE (chain_id, contract_address, block_number, log_index)`. This must happen while 5 569 998 is
     still ≥ the RPC's `oldestLedger`.
4. **Set the key.** In an eq-lab/argocd PR (`pipeline/test.yaml`, worker env), set
   `CHAIN_99000001_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS=CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX`.
   Keep `…_COLLATERAL_REGISTRY_ADDRESS=CBSMJS5Q…` (legacy history).
5. **Verify** within a minute of the worker restarting with the key:
   - the log line "Stellar SecurityRegistry indexer enabled";
   - a `security_registry_state` row with `loan_registry = CDWN5B3F…`, `paused = false` and
     `inspectors = []`;
   - no SecurityRegistry `warn` lines;
   - after the first testnet write, `contract_logs` rows named `Security…`.

### If this ships after retention

- **Nothing written before the key was set.** The rollout is the same as above, minus the rewind. As of
  ledger 5 585 892 nothing has been written. Ask the contracts and QA teams (#1777) not to exercise the
  SecurityRegistry on testnet until the key is set.
- **Something was written.**
  - The events between the deploy and the oldest retained ledger cannot be fetched again.
  - Rewind to `oldestLedger` if any retained events precede the cursor.
  - The sync loop's discovery seeds the current state from views: `record(id)` and `inspection(id)`
    probing, `terms`, `extension_consents`, `inspectors`, `paused`, `loan_registry`.
  - #1780 then serves correct current records, terms, inspections and valuation, with `complete = false`
    on seeded rows.
  - The lost history items are listed under Assumptions and Risks.
  - The #1781 audit log will lack those events.

### Mainnet

Mainnet is still deployment #37 (legacy CollateralRegistry `CA76K5CU…`). Nothing to do until the
SecurityRegistry is deployed there, at which point the same steps apply.

### Rollback

Unset the key and the worker stops polling and syncing. The tables remain, unused. The previous image
boots against the additive schema.

## Implementation Steps

Each new Rust file starts with a single spec-pointer header:
`// spec: docs/references/security-registry-events.md#<section>`. There are no other comments.

1. **Migration.** Create `packages/shared/migrations/20261106000001_security_registry.sql`.
   - Header: the same 3-line pattern as `20261103000001_pocket_seeds.sql`, with a rollback note listing
     `DROP TABLE` statements in a comment.
   - Ten `CREATE TABLE IF NOT EXISTS` statements, per the table above, with every column `NOT NULL`
     unless marked `NULL`.
   - `CREATE INDEX IF NOT EXISTS` on `(chain_id, contract_address, loan_id)` for `security_records`,
     `security_record_docs`, `security_margin_call_events`, `security_inspections` and `security_lots`.
   - `security_view_snapshots.kind` gets a `CHECK (kind IN ('record','inspection','loan','contract'))`.
   - No `ALTER`, `DROP`, `UPDATE` or `DELETE` statements.
   - Bump the version suffix if a sibling PR already took `20261106000001`.
2. **Shared pure module** `packages/shared/src/security_registry.rs`; register it in `lib.rs`.
   - **Names:**
     - `pub const SECURITY_LOAN_EVENT_NAMES: [&str; 18]`: every stored name that carries `loan_id`;
     - `pub const SECURITY_CONTRACT_EVENT_NAMES: [&str; 4]`;
     - `pub fn is_security_registry_event(name) -> bool`.
   - **Row and view types,** all `serde` (`Serialize`, `Deserialize`, `Clone`, `Debug`, `PartialEq`):
     - `SecurityEventRow { id: i64, event_name, block_number: i64, log_index: i64, block_timestamp: i64, tx_hash, params: Value }`;
     - `RecordView` (all `Record` fields: amounts and `u64`s as decimal strings, `attested_by: Option<String>`, `docs: Vec<DocView { kind, sha256 }>`, `mark: Option<MarkView>`);
     - `InspectionView` (all `Inspection` fields);
     - `LoanView { terms: Option<TermsView>, terms_ledger: i64, consents: Vec<String>, consents_ledger: i64 }`;
     - `ContractView { paused: bool, inspectors: Vec<String>, loan_registry: String }`;
     - `CoverageDetailView`, `LoanMoneyView`;
     - `Snapshot<T> { as_of_ledger: i64, view: T }`.
   - **Projection row types,** one per table, with `BigDecimal` for `NUMERIC` and `i64` for ids, bps and
     ledgers: `RecordRow`, `DocRow`, `TermsRow`, `MarginCallEventRow`, `InspectionRow`, `LotRow`,
     `ConsentRow`, `RegistryStateRow`, `ValuationRow`, and
     `LoanProjection { terms, records, docs, margin_events, inspections, lots, consents }`.
   - **Functions** (all pure):
     - `pub fn fold_loan(loan_id: u32, events: &[SecurityEventRow], records: &HashMap<u32, Snapshot<RecordView>>, inspections: &HashMap<u32, Snapshot<InspectionView>>, loan: Option<&Snapshot<LoanView>>) -> LoanProjection`,
       implementing the fold rule and the per-event table;
     - `pub fn fold_registry_state(events: &[SecurityEventRow], contract: Option<&Snapshot<ContractView>>) -> Option<RegistryStateRow>`;
     - `pub fn label_snapshot_tail<T>(…)`, shared by docs and consents;
     - `pub fn lot_latest(…)`;
     - `pub fn record_snapshot_needs(events, snapshot_ledgers) -> Vec<u32>`;
     - `pub fn inspection_snapshot_needs(…)`;
     - `pub fn loan_snapshot_needs(…)`;
     - `pub fn valuation_due(latest_log_id, last: Option<(source_log_id, fetched_at, debt)>, now, max_age) -> bool`;
     - `pub fn is_goods(protection: &str) -> bool`.
   - **Parsing:**
     - amounts and times are parsed from decimal strings into `BigDecimal` / `u64`;
     - a row with a missing or unparsable field is skipped with a `warn`, never a panic;
     - `BigDecimal` is rendered with `to_plain_string()` wherever it becomes a string.
3. **Shared repo** `packages/shared/src/security_registry_repo.rs` (`SecurityRegistryRepo { pool }`);
   register it in `lib.rs`. All SQL is `pub const …_SQL`, plain `sqlx::query` with binds, in the style of
   `pocket_repo.rs`. Every query on `contract_logs` filters `chain_id = $1 AND contract_address = $2`.
   - **Event reads:**
     - `LIST_LOAN_EVENTS_SQL`: `event_name = ANY($3)`, `params->>'loan_id' = $4`,
       `ORDER BY block_number, log_index`;
     - `LIST_CONTRACT_EVENTS_SQL`;
     - `MAX_LOG_ID_SQL`.
   - **Dirty loans:** `LIST_DIRTY_LOANS_SQL`, the union of rows `id > $3` and snapshots
     `fetched_at > $4`; `LIST_ALL_LOANS_SQL` for a forced rebuild.
   - **Snapshots:**
     - `LIST_SNAPSHOTS_FOR_LOAN_SQL`, `GET_CONTRACT_SNAPSHOT_SQL`;
     - `UPSERT_SNAPSHOT_SQL`:
       `ON CONFLICT (chain_id, contract_address, kind, entity_id) DO UPDATE SET … WHERE EXCLUDED.as_of_ledger > security_view_snapshots.as_of_ledger`;
     - `LIST_SNAPSHOT_LEDGERS_SQL` (kind → entity → `as_of_ledger`).
   - **Snapshot-need inputs:**
     - `LIST_RECORD_EVENT_LEDGERS_SQL`: record id, max ledger of the opaque events (perfected, handover
       `to`), and whether a `SecurityRecordRegistered` row exists;
     - `LIST_INSPECTION_IDS_SQL`;
     - `LIST_KNOWN_LOANS_SQL`, which takes `$3` = the configured loan-registry address or `NULL` for its
       `LoanDrawn` rows;
     - `LIST_LOANS_WITH_TERMS_EVENT_SQL`.
   - **Projection writes:**
     - `DELETE_LOAN_<TABLE>_SQL` for the seven loan-scoped tables;
     - `INSERT_<TABLE>_SQL` for each table;
     - `UPSERT_REGISTRY_STATE_SQL`, `UPDATE_PROJECTION_WATERMARK_SQL`.
   - **Valuation:** `LIST_VALUATION_CANDIDATES_SQL` (`security_terms` left-joined to
     `security_loan_valuations`, plus the max `contract_logs.id` per loan over `contract_address = ANY($3)`,
     the SecurityRegistry plus its loan registry) and `UPSERT_VALUATION_SQL`.
   - **Methods:**
     - one per query;
     - `replace_loan_projection(chain_id, contract, loan_id, &LoanProjection)` runs the deletes and inserts
       in one transaction.
4. **Worker config.** In `packages/worker/src/indexer/config.rs`:
   - add `pub security_registry_id: Option<String>` to `StellarIndexerSettings`;
   - parse `{ip}SECURITY_REGISTRY_ADDRESS` by copying the `pocket_key` block;
   - push `("SECURITY_REGISTRY_ADDRESS", id)` into `roles`;
   - set it in `Ok(Self { … })`.
5. **Worker parsers.** Add `packages/worker/src/indexer/stellar/security_registry_parsers.rs` and register
   it in `stellar/mod.rs`.
   - `pub const SECURITY_REGISTRY_EVENT_TOPICS: [(&str, &str); 22]` (topic, stored name).
   - `pub const SECURITY_REGISTRY_ALLOW_LISTED_TOPICS: [&str; 5]`.
   - `pub enum SecurityTopic { Stored(&'static str), AllowListed, Unknown }` and
     `pub fn classify_security_topic(topic) -> SecurityTopic`.
   - One `pub fn parse_security_*` per stored topic. They reuse:
     - `extract_u32` for the topics;
     - `extract_u32_from_map`, `extract_u64_from_map`, `extract_i128_from_map`,
       `extract_bytes32_from_map`, `extract_address_from_map` and `get_map_entry`.

     Private helpers in this file cover the `i32` / `bool` / enum-variant / Symbol / `Vec<Address>`
     decoding and the nested `terms` map. Do not touch the legacy parser's helpers.
   - `pub fn dispatch_security_registry(raw) -> Option<StellarLog>`:
     - `Stored` → parse, with a `warn` on decode failure;
     - `AllowListed` → `None` silently;
     - `Unknown` → `warn` and `None`.
6. **Legacy trap guard.** In `stellar/collateral_registry_parsers.rs`, inside `dispatch_collateral_registry`,
   when `parsed.is_none()` and `classify_security_topic(&raw.event_name)` is `Stored` for a topic absent
   from the legacy `TOPICS`, warn once per process (a `static` `AtomicBool`) naming
   `…_SECURITY_REGISTRY_ADDRESS`. Return values are unchanged.
7. **Worker poller.** In `stellar/poller.rs`:
   - add a `security_registry_id: Option<String>` field and constructor argument;
   - push it into `contract_ids` in `poll`;
   - add
     `else if self.security_registry_id.as_deref() == Some(raw.contract_id.as_str()) { dispatch_security_registry(&raw) }`
     right after the CollateralRegistry branch;
   - in `run_stellar_indexer_job`, log "Stellar SecurityRegistry indexer enabled" and spawn
     `spawn_security_registry_sync(…)` (the `spawn_pocket_seed` / `AbortOnDrop` pattern) when the id is
     set, passing `rpc`, `SecurityRegistryRepo::new(pool.clone())`, `EventRepo` (for the cursor),
     `chain_id`, the id and `settings.loan_registry_id`.

   `is_loan_registry_event`, `dispatch_parser` and `StellarLogMapper` are unchanged.
8. **Worker views.** Add `packages/worker/src/indexer/stellar/security_registry_views.rs`.
   - **Decoders:** `pub fn decode_record`, `decode_inspection`, `decode_terms`, `decode_coverage_detail`,
     `decode_loan_money`, `decode_inspectors` and `decode_consents`, each `(&ScVal) -> anyhow::Result<…View>`.
     - Reuse `expect_map`, `map_u32` and `map_i128`.
     - Widen `map_u64`, `map_u128`, `map_bool`, `map_bytes32`, `map_string` and `map_enum_variant` in
       `loan_registry_reader.rs` to `pub(crate)`. This is a visibility-only change.
     - `Option<Address>` is `ScVal::Void` or an address; `mark` is a 0/1-element `Vec`.
   - `pub fn is_contract_error(msg: &str, code: u32) -> bool`, matching `Error(Contract, #{code})` exactly.
   - `#[async_trait] pub trait SecurityViewSource: Send + Sync` with
     `record(u32)`, `inspection(u32)`, `terms(u32)`, `extension_consents(u32)`, `inspectors()`, `paused()`,
     `loan_registry()`, `coverage_detail(u32)` and `loan_money(registry: &str, u32)`.
     - Each returns `Result<(View, u64 latest_ledger)>`.
     - `terms` returns `Ok(None)` on `#14`.
   - `pub struct RpcSecurityViewSource`, built on `simulate_view`.
9. **Worker sync loop.** Add `packages/worker/src/indexer/stellar/security_registry_sync.rs`.
   - Constants: `SECURITY_SYNC_INTERVAL` (30 s), `VALUATION_MAX_AGE` (5 min), `DISCOVERY_INTERVAL` (1 h),
     `SNAPSHOT_MAX_LAG` (20).
   - `SyncBackoff` keyed by `(SnapshotKind, u32)`, reusing `pocket_seed::backoff_delay`, with warn-once
     sets.
   - A `PendingSnapshots` map holds reads with `V >= cursor` until the cursor passes `V`.
   - **Pure, unit-tested helpers:**
     - `pub async fn read_snapshots(source: &dyn SecurityViewSource, needs: &SnapshotNeeds, backoff, now) -> Vec<SnapshotWrite>`;
     - `pub async fn discover_records(source, known: &BTreeSet<u32>, backoff) -> Vec<SnapshotWrite>`,
       which stops at `#1`;
     - `discover_inspections`, which stops at `#25`;
     - `pub fn release_ready(pending, cursor) -> Vec<SnapshotWrite>`.

     These take the source trait and no DB.
   - **`pub async fn run_security_registry_sync_loop(…)`:** each cycle runs the three steps with errors
     logged, never propagated, then sleeps.
10. **Docs** (see Docs to Update), `.env.example`, ARCHITECTURE.md and tech debt.
11. **Verify:**
    - `cargo fmt --all`;
    - `cargo clippy --all -- -D warnings`;
    - `cargo test -p shared -p pipeline-worker`;
    - the docs linter command above.

## Test Strategy

All tests are pure unit tests in `packages/<pkg>/tests/<topic>.rs`. There is no Postgres and no
`DATABASE_URL` / `POSTGRES_URL` or any other DB env var. XDR fixtures are built with the helpers already
used in `stellar_pocket_parsers.rs` (`sym_val`, `i128_val`, `encode_map`, `address_topic`, `raw`).

- **`packages/worker/tests/stellar_security_registry_parsers.rs`** (the file the issue names):
  - **Fixtures:** one per stored topic, with the expected `event_name` and the exact `params` JSON.
  - **Edge cases:**
    - the nested 12-field `Terms` map, flattened, with `payment_term` as a variant name;
    - `record_released` with `by_consent` `true` and `false`;
    - negative `i32` variances and `flagged` `true` / `false`;
    - `inspectors_set` with 0 and 2 addresses (one `G…`, one `C…`);
    - `margin_call` with `ltv_bps = 4294967295` and a `u64` `cure_by`;
    - every enum variant of `Protection`, `DocKind`, `InspectionKind` and `FlagOutcome` at least once;
    - `paused` / `unpaused` with an empty map → `{}`.
  - **Allow-listed topics** (`mint` and `burn` built exactly as observed, `["mint", to]` with
    `{token_id: u32}`, and the three ownership topics):
    - `classify_security_topic` → `AllowListed`;
    - `dispatch_security_registry` → `None`.

    "No warning" is guaranteed by classification: dispatch warns only on `Unknown` or a decode failure.
  - **Unknown and malformed:** an unknown topic → `Unknown` and `None`. A malformed known topic (missing
    map key, too few topics) → `None`.
  - **Collision test:** every stored name differs from every existing name and from every name in the
    issue's list. The existing names are:
    - the legacy Stellar / EVM CollateralRegistry names (`Pledged`, `HaircutSet`, `FloorSet`, `Revalued`,
      `StageUpdated`, `ControlUpdated`, `DocAdded`, `QuantityAdjusted`, `Released`, `Liquidated`,
      `MarginCall`), plus `is_collateral_registry_event`;
    - `is_loan_registry_event`;
    - `is_pocket_event`;
    - the minter, deal-token, deposit / withdrawal / staking and `AssetTransfer` names (a hard-coded
      list).

    Also, `is_security_registry_event` (shared) agrees with the parser table.
  - **Legacy trap guard:** `dispatch_collateral_registry` on a `record_registered` fixture → `None`, and
    the existing legacy fixtures still parse to identical rows (regression).
- **`packages/worker/tests/stellar_security_registry_replay.rs`.** Fixtures → `dispatch_security_registry`
  → `SecurityEventRow`s → `shared::security_registry::fold_loan`. Cases:
  - **Main case: `default_flow.rs:471-609` with non-zero timestamps.** The event sequence is the one the
    contract emits on a real network:
    1. `terms_set` (8000 / 8500, cure 604800, stale 172800, tolerance 50 / 100);
    2. `margin_call` (ltv `u32::MAX`);
    3. `record_registered` r1 (lot 1, `CollateralManagement`), then `record_perfected` r1, then `revalued`
       r1 (10 × 1e7, `LME`);
    4. the same three for r2 (lot 2);
    5. `margin_call_cured` (5000);
    6. `enforcement_started` r1, then `price_stale` (13750 / 8500);
    7. `record_enforced` r1, then `price_stale`.

    `mint` / `burn` are interleaved and must be dropped. Expected projection:
    - **r1:** `Enforced`, with docs `[Perfection h63 perfection, Proceeds h65 proceeds]` and mark `10e7`
      `LME`;
    - **r2:** `Active`, with doc `[Perfection h63]` and the same mark;
    - **terms:** `margin_call_at = 0`;
    - **history:** `open`, `cured`, `price_stale`, `price_stale`, with `cure_by` from the event;
    - **without snapshots:** `attested_by` is `NULL` and `needs_view = true`.
  - **Same flow plus record snapshots** of r1 and r2 at a `V` after the perfects (`attested_by = agent`,
    `docs = [Perfection]`): `attested_by = agent`, `needs_view = false`, provenance labelled
    `perfection` from the tail, later events applied. This proves the implicit `attested_by` and docs.
  - **Timestamp-0 variant:** the literal contract-test sequence (`margin_call` twice, then `price_stale` on
    the first perfect, then no cure). `margin_call_at` stays 0, and the history has two `open` rows.
  - **Handover:**
    - with matching commodity and unit, `to` takes `from`'s mark and `from` is `Released`;
    - with a different unit, the mark is not copied;
    - with a missing snapshot, `needs_view`;
    - a `Perfection` doc on `to`.
  - **USD record without a snapshot:** the implicit par mark (`10000000`, `PAR`, zero hash, `at` = the
    register timestamp). A later `revalued` on the USD record replaces the mark, and the value stays data
    only.
  - **Inspections:**
    - record → approve (flagged) → `flagged_by` set;
    - `resolve_flag` `Accepted`: `reference_quantity` / `reference_grade` taken from the inspection
      snapshot, `flagged_by = 0`;
    - `TopUpRequired` clears the flag;
    - `Escalated` keeps it;
    - lot latest: `SamplingAssay` excluded; on equal `inspected_at` the later approval wins; it carries
      over a handover.
  - **`release_with_consent`:** `released_by_consent = true`.
  - **Seed:**
    - snapshots only (no events) → rows with `complete = false` and docs source `view`;
    - events ≤ `V` ignored for state but used for tail labels and history;
    - events > `V` applied.
  - **Extension consents:** a snapshot with 2 hashes plus 1 indexed event ≤ `V` and 1 > `V` → 3 rows; the
    first has `new_maturity` `NULL`.
- **`packages/worker/tests/stellar_security_registry_views.rs`:**
  - decoders for `Record`: with and without a mark, `attested_by` `None` / `Some`, docs, `Control`;
  - `Inspection`: approved `None` / `Some`;
  - `Terms`, `CoverageDetail` (with `CountedRecord`s), `LoanMoney`, `Vec<Address>`, `Vec<BytesN<32>>`;
  - `is_contract_error`: `#1` does not match `#14`, `#25` matches.
- **`packages/worker/tests/stellar_security_registry_sync.rs`.** Uses a fake `SecurityViewSource` (a
  scripted `HashMap` of results).
  - A failing read yields no write, records a backoff, does not panic, and later entities are still read.
    This covers the issue's "a simulated RPC failure during enrichment" (`index_once` itself has no RPC
    in the SecurityRegistry path; see the next test).
  - `discover_records` stops at `#1`, skips known ids, and returns writes for gaps.
  - `terms` → `#14` → a loan snapshot with `terms: null`.
  - `release_ready` holds `V >= cursor` and releases `V < cursor`.
  - `valuation_due`: the event-driven, timer and zero-debt cases.
  - The SecurityRegistry path in `poll` is pure: `dispatch_security_registry` is a synchronous `fn` taking
    only `&RawEvent` (compile-time guarantee), and the returned log goes to `StellarLogMapper`. Assert
    that no stored name matches `is_loan_registry_event` or `"DealRegistered"` / `"AssetTransfer"`, so it
    takes the generic branch.
- **`packages/worker/tests/stellar_security_registry_config.rs`** (`stellar_pocket_config.rs` pattern):
  - unset or whitespace → `None`;
  - valid → `Some`;
  - bad CRC → error naming `SECURITY_REGISTRY_ADDRESS`;
  - equal to `COLLATERAL_REGISTRY_ADDRESS`, `POCKET_ADDRESS` or `LOAN_REGISTRY_ADDRESS` → the
    distinct-role error;
  - the legacy collateral key alone still works (regression).
- **`packages/shared/tests/security_registry_fold.rs`:** fold unit tests on JSON param rows:
  - each per-event rule in isolation;
  - `label_snapshot_tail`, including `k = 0` and `k = len`;
  - `lot_latest` ties;
  - `record_snapshot_needs`: a newer perfect or handover `to` triggers a re-read;
  - bad params are skipped, not panicked on;
  - `fold_registry_state`: event newer than the snapshot vs older.
- **`packages/shared/tests/security_registry_repo_sql.rs`:** needle tests for every `pub const`:
  - `chain_id = $1`, `contract_address = $2`, `ORDER BY block_number, log_index`;
  - `ON CONFLICT … WHERE EXCLUDED.as_of_ledger >`;
  - the delete statements are scoped by `loan_id`;
  - no query reads `contract_logs` without `contract_address`, so EVM and other-contract rows cannot leak
    in.
- **`packages/shared/tests/migration_security_registry.rs`** (`migration_pocket_seeds.rs` pattern): every
  table, column, primary key, index and the `kind` `CHECK`; additive only.
- **EVM regression:** no EVM source file changes. The existing `collateral_registry_parsers.rs`,
  `evm_collateral_registry_config.rs` and `evm_*` tests pass unchanged, and the collision test above pins
  the EVM names.
- **Live check** (QA #1777, not in CI): once the key is set and the first testnet writes happen,
  `security_loan_valuations.ltv_bps` equals the contract's `coverage_detail(loan_id).ltv_bps` at
  `detail_ledger`, and the projected records equal `record(id)`.

## Docs to Update

- **New `docs/references/security-registry-events.md`.** Linked from `docs/references/index.md` and from
  backend.md. Sections:
  - Configuration;
  - Encoding rules;
  - Event table (the table above);
  - Allow-listed topics;
  - State without its own event (the implicit changes: `attested_by` on perfect / handover, the initial /
    perfection / proceeds docs, the USD par mark, the handover mark copy, `revalue` without a status
    check, `Accepted` reference changes);
  - Projection tables;
  - Sync loop (snapshot reads, fold rule, discovery, valuation);
  - Cursor and retention;
  - Known limitations (seeded history, current-state reads, doc labels after an indexing gap).
- **`docs/references/collateral-registry-events.md`:** mark the Stellar arm as legacy. The
  SecurityRegistry replaces it on #39+ deployments, and rows under the legacy id stay as history. The EVM
  arm is unchanged.
- **`docs/references/backend.md`:**
  - a short "#### Stellar SecurityRegistry indexing" subsection pointing to the new reference;
  - in the key-map row for `collateral_registry`, drop "(#1779, not read yet)";
  - in "Stellar contract ids and signer roles", add the SecurityRegistry rollout steps (trap check,
    first-event check, rewind command, the deploy ledger 5 569 998, the 2026-11-12 retention note,
    post-retention discovery).
- **`.env.example`:** move `CHAIN_99000001_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS` out of the "Not read
  by this build" group into the live block, as
  `=CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX # optional — SecurityRegistry, pipeline-stellar-contracts@e9881ac deployment #42 (addresses.json collateral_registry key — see the trap); cursor at/before ledger 5569998`.
  Keep the legacy collateral line.
- **`ARCHITECTURE.md:64`:** add the "SecurityRegistry record / terms / inspection / margin-call events
  (Stellar)" to the event-listener list.
- **`docs/exec-plans/tech-debt-tracker.md`:** a new TD for "SecurityRegistry valuation and snapshots are
  current-state reads (no ledger pinning; `coverage_detail` and `loan_money` may differ by a ledger), and
  history before the key was set is view-seeded (margin-call history, doc provenance, consent maturities,
  past inspection flags lost)". Next free id after TD-171.
- **Issue #1782:** no doc change here. The section [What #1782 would no longer need](#what-1782-would-no-longer-need)
  is the input for the human decision.

## Open Questions

_None_

### Resolved questions (human, 2026-11-06)

1. **#1782 is closed as superseded** by the on-chain inspections (contracts #41): this plan keeps the
   table name `security_inspections`; frontend inspections are #1857, the API is #1780.
2. **Rollout:** the manager opens the eq-lab/argocd PR adding `CHAIN_99000001_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS`
   and runs the interface + `getEvents`-from-5 569 998 check right after the image is live on pipeline-test;
   the human runs the cursor rewind on the pipeline-test DB only if that check finds events. Target: before
   about 2026-11-12; otherwise the view seed applies as described in "If this ships after retention".
