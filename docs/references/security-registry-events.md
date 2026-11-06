# SecurityRegistry events and projection (Stellar)

How the worker indexes the Stellar SecurityRegistry (issue #1779, epic #1775): stored events, the views that fill what events do not carry, and the projection tables that #1780 (API), #1781 (audit log), #1783, #1784 and #1785 read.

Source of truth: `pipeline-stellar-contracts@e9881ac`, `contracts/security-registry` (`event.rs`, `types.rs`, `lib.rs`, `storage.rs`, `error.rs`). Testnet deployment #42: `CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX` (stored under the `collateral_registry` key of `addresses.json`; see the trap in [backend.md](./backend.md#stellar-contract-ids-and-signer-roles)), deployed around ledger 5 569 998. Contracts are frozen; the legacy CollateralRegistry parser stays as history ([collateral-registry-events.md](./collateral-registry-events.md)).

## Configuration

`CHAIN_<id>_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS` (optional). Unset or whitespace ships dark: no polling, no sync task, empty tables. A set value is validated as a Strkey `C…` contract id (CRC included) and joins the distinct-role check as `SECURITY_REGISTRY_ADDRESS`; a value equal to the legacy `COLLATERAL_REGISTRY_ADDRESS` (or any other role) fails boot. The worker logs "Stellar SecurityRegistry indexer enabled". No API key exists here (#1780).

## Encoding rules

- Ids (`loan_id`, `record_id`, `lot_id`, `inspection_id`, `from_record_id`, `to_record_id`) are decimal strings.
- `u32` bps fields and the signed `i32` variances are JSON numbers.
- `u64` times and durations are decimal strings.
- `i128` amounts are decimal strings, raw at 7 dp.
- `BytesN<32>` is lowercase hex without `0x`.
- Enums are the variant name (a unit enum is `Vec([Symbol(variant)])` on chain); addresses are the Strkey (`G…` / `C…`); `bool` is a JSON bool.
- Every event is a `#[contractevent]` with the default map format: `topics[0]` is the snake_case symbol, `#[topic]` fields follow in declaration order, `value` is a map of the rest. A field-less event has an empty map.

Rows land in `contract_logs` through the existing `StellarLogMapper`; no RPC runs inside `index_once`.

## Event table

Every stored name carries the `Security` prefix because the EVM CollateralRegistry and the legacy Stellar parser still write `Revalued`, `DocAdded`, `MarginCall` and `Released`.

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
| `terms_set` | `loan_id` | `terms` (12-field map) | `SecurityTermsSet` | `loan_id` plus the 12 `Terms` fields flattened: `advance_ratio_bps`, `margin_call_ratio_bps`, `default_rate`, `tolerance_bps`, `grade_tolerance_bps` (numbers); `cure_period`, `price_stale_after`, `grace_period`, `attestation_interval`, `inspection_interval`, `margin_call_at` (strings); `payment_term` (variant) |
| `revalued` | `loan_id`, `record_id` | `value_per_unit`, `benchmark`, `report_hash` | `SecurityRevalued` | `loan_id`, `record_id`, `value_per_unit`, `benchmark` (the Symbol text), `report_hash` |
| `margin_call` | `loan_id` | `ltv_bps`, `margin_call_ratio_bps`, `cure_by` | `SecurityMarginCall` | `loan_id`, `ltv_bps`, `margin_call_ratio_bps`, `cure_by` |
| `price_stale` | `loan_id` | `ltv_bps`, `margin_call_ratio_bps` | `SecurityPriceStale` | `loan_id`, `ltv_bps`, `margin_call_ratio_bps` |
| `margin_call_cured` | `loan_id` | `ltv_bps` | `SecurityMarginCallCured` | `loan_id`, `ltv_bps` |
| `inspection_recorded` | `loan_id`, `record_id`, `inspection_id` | `lot_id`, `inspector`, `kind` | `SecurityInspectionRecorded` | `loan_id`, `record_id`, `inspection_id`, `lot_id`, `inspector`, `kind` |
| `inspection_approved` | `loan_id`, `record_id`, `inspection_id` | `approved_by`, `variance_reference_bps`, `variance_previous_bps`, `variance_grade_bps`, `flagged` | `SecurityInspectionApproved` | all of them |
| `flag_resolved` | `loan_id`, `record_id` | `inspection_id`, `outcome`, `reason_hash` | `SecurityFlagResolved` | `loan_id`, `record_id`, `inspection_id`, `outcome`, `reason_hash` |
| `extension_consent` | `loan_id` | `new_maturity`, `consent_hash` | `SecurityExtensionConsent` | `loan_id`, `new_maturity`, `consent_hash` |
| `inspectors_set` | none | `inspectors: Vec<Address>` | `SecurityInspectorsSet` | `inspectors` (JSON array of Strkeys, in order) |
| `loan_registry_set` | none | `loan_registry` | `SecurityLoanRegistrySet` | `loan_registry` |
| `paused` / `unpaused` | none | (empty) | `SecurityRegistryPaused` / `SecurityRegistryUnpaused` | `{}` |

The parser is table-driven (`security_registry_parsers.rs`): one spec per topic lists the id topics and the typed value fields. A recognised topic that fails to decode (missing key, wrong type, too few topics, a hash that is not 32 bytes) is dropped with a `warn`.

## Allow-listed topics

`mint`, `burn` (the soulbound record NFT), `ownership_transfer`, `ownership_transfer_completed` and `ownership_renounced` are dropped silently: no `contract_logs` row, no projection, no holder column. The AccessManager is not indexed. Any other topic from the SecurityRegistry id logs a `warn` and is dropped. Only pause state is recorded, because every write is `when_not_paused`.

The legacy CollateralRegistry dispatcher warns once per process when it sees a topic that exists only on the SecurityRegistry (`record_registered`, `terms_set`, `inspection_recorded`, …); this means the id was configured under the legacy key by mistake. Its return values and stored rows are unchanged.

## State without its own event

The contract changes some state without carrying it in an event. The fold applies these rules (all from `lib.rs` at `e9881ac`):

- `perfect` and `handover` set `attested_by` to the caller, which is not in the event. The fold sets it to `NULL` with `needs_view`, and a record snapshot read after the event fills it.
- `perfect` / `handover` add a `Perfection` doc, `mark_enforced` adds a `Proceeds` doc; `register` stores the initial docs.
- `register` marks a non-goods record at par (`value_per_unit = 10000000`, benchmark `PAR`, zero report hash, `at` = the register timestamp).
- `handover` copies the mark of `from` to `to` when `commodity` and `unit` are equal; with either unknown the mark is left and `needs_view` is set.
- `revalue` has no status check, so a mark applies in any status and to USD records (data only there).
- `resolve_flag(Accepted)` sets `reference_quantity` to the flagging inspection's quantity (unless its kind is `SamplingAssay`) and `reference_grade` to its grade when that is not 0. Without that inspection's snapshot the reference is left and `needs_view` is set.
- `resolve_flag(TopUpRequired)` opens a margin call through the same `margin_call` event.

## Projection tables

Migration `20261106000001_security_registry.sql` (additive). Every table is keyed by `(chain_id, contract_address, …)`. Ids are `BIGINT`; `u64` times and `i128` / `u128` amounts are `NUMERIC`; hashes and enums are `TEXT`.

| Table | Key | Content |
|---|---|---|
| `security_view_snapshots` | `kind` (`record`, `inspection`, `loan`, `contract`), `entity_id` | `loan_id`, `as_of_ledger`, `payload` JSONB, `fetched_at`; upsert only moves `as_of_ledger` forward |
| `security_registry_state` | none | `paused`, `inspectors`, `loan_registry`, plus the projection watermarks (`projection_version`, `projected_log_id`, `projected_snapshot_at`) |
| `security_terms` | `loan_id` | the 12 `Terms` fields including the contract-kept `margin_call_at`, `set_ledger`, `complete` |
| `security_records` | `record_id` | identity (`loan_id`, `lot_id`, `protection`); descriptive fields `NULL` until a snapshot; state (`status`, `perfected_at`, `attested_by`, `attested_at`, `flagged_by`); latest mark; lifecycle ledgers and release data; `complete`, `needs_view`, `view_ledger` |
| `security_record_docs` | `record_id`, `position` | `kind`, `sha256`, `source` (`register` / `event` / `perfection` / `proceeds` / `view`), `ledger` |
| `security_margin_call_events` | `block_number`, `log_index` | `loan_id`, `kind` (`open` / `price_stale` / `cured`), `ltv_bps`, `margin_call_ratio_bps`, `cure_by`, `block_timestamp`, `tx_hash` |
| `security_inspections` | `inspection_id` | identity; entered fields (from the `inspection(id)` snapshot); approval and the three variances; `flagged`; resolution; ledgers; `complete`, `needs_view` |
| `security_lots` | `lot_id` | `loan_id`, latest quantity inspection (`latest_inspection_id`, `latest_inspected_at`, `latest_quantity`), `complete` |
| `security_extension_consents` | `loan_id`, `position` | `consent_hash`, `new_maturity`, `ledger`, `block_timestamp` |
| `security_loan_valuations` | `loan_id` | from `coverage_detail`: `value`, `stale_value`, `flagged_value`, `debt`, `coverage_bps`, `ltv_bps`, `margin_call_at`, `cure_by`, `price_stale`, `counted_records`, `detail_ledger`; from `loan_money`: `loan_registry`, `outstanding`, `accrued_interest`, `money_ledger`; `source_log_id`, `fetched_at` |

Amounts in the valuation table are raw at 7 dp, with no base-6 normalisation. `coverage_detail` panics without terms (`NoTerms`, `#14`), so only loans with a `security_terms` row are valued.

The lot latest inspection mirrors the on-chain `LotLatestInspection` that caps a goods record's counted quantity: among the lot's approved, non-`SamplingAssay` inspections with known `inspected_at` and quantity, the one with the largest `inspected_at` wins; on a tie the later approval wins (ordered by approval ledger and log index, or `(approved_at, inspection_id)` for seeded rows, which sort before event-approved ones). The lot is `complete = false` while an approved quantity inspection lacks its snapshot.

## Sync loop

`run_security_registry_sync_loop` is a separate task spawned only when the key is set, tied to the indexer like the Pocket seed loop (abort on exit, panics logged). Every 30 s each step is best-effort and logs instead of failing; `index_once` never calls RPC, so a failing view read cannot stall Stellar indexing.

1. **Snapshot reads.** Simulate the views a record, inspection, loan or the contract needs and upsert them with `as_of_ledger = simulateTransaction.latestLedger`:
   - record `r`: when it has no snapshot, or a `SecurityRecordPerfected(r)` / `SecurityRecordHandedOver(to = r)` is newer than its snapshot;
   - inspection `i`: once, when it has no snapshot (the entered fields never change);
   - loan `l`: `terms(l)` (`NoTerms` stored as `terms: null`) and `extension_consents(l)`, each with its own ledger, when the loan is known but has no `SecurityTermsSet` and no loan snapshot;
   - contract: `paused()`, `inspectors()`, `loan_registry()` at loop start and hourly (the constructor sets the initial loan registry without an event).
   - **Discovery** at loop start and hourly probes `record(1, 2, …)` and `inspection(1, 2, …)`, skipping ids already indexed or snapshotted, and stops at the first `Error(Contract, #1)` / `#25`. Ids are global and sequential from 1, so this finds everything the indexer never saw; at most 200 reads per run.
   - Failures back off per entity (`pocket_seed::backoff_delay`); the first failure per entity per process is a `warn`, later ones `debug`. Error codes are matched as `Error(Contract, #<n>)`, so `#1` never matches `#14`.
   - Reads are skipped while the chain cursor is more than 20 ledgers behind `getLatestLedger`.
   - A snapshot is stored only once the cursor has passed its ledger (`last_indexed_block > V`); until then it is held in memory.
2. **Projection.** Loans are dirty when they have `contract_logs` rows with `id > projected_log_id` or snapshots fetched after `projected_snapshot_at`; every loan is dirty when `projection_version` is below the code's (1). Each dirty loan is folded from its rows and snapshots (`shared::security_registry::fold_loan`, pure and unit-tested) and rewritten in one transaction. Watermarks advance only if every dirty loan was rebuilt. The contract state row (`SecurityInspectorsSet`, `SecurityLoanRegistrySet`, `SecurityRegistryPaused` / `…Unpaused`, contract snapshot) is folded every cycle.
3. **Valuation.** For every loan with terms, simulate `coverage_detail(loan_id)` on the SecurityRegistry and `loan_money(loan_id)` on its own `loan_registry` and upsert `security_loan_valuations`. A loan is due when it has no valuation, when a SecurityRegistry or loan-registry log row for it is newer than `source_log_id`, or when the last read is older than 5 minutes and the last `debt` was above zero (interest accrues without events). When the contract's `loan_registry` differs from the configured `…_LOAN_REGISTRY_ADDRESS` the loop warns once per process.

**Fold rule.** Per entity (record, inspection, a loan's terms and consents, the contract state): with a snapshot at ledger `V`, start from it and apply only that entity's events with `block_number > V`; without one, fold from events alone, leave fields no event carries `NULL` and set `needs_view`; with neither, no row. History (margin-call history, doc and consent provenance, inspection `flagged`, flag resolutions) is always event-only.

`complete` means the row's opening event is indexed (`SecurityRecordRegistered`, `SecurityInspectionRecorded`, `SecurityTermsSet`); `complete = false` rows were seeded from views and their history is partial.

Docs and consents keep order and provenance by labelling the snapshot's tail: the last `k` snapshot entries belong, in order, to the `k` indexed appending events at or below `V` (`SecurityDocAdded` → `event`, `SecurityRecordPerfected` and the `to` side of `SecurityRecordHandedOver` → `perfection`, `SecurityRecordEnforced` → `proceeds`; for consents the event supplies `new_maturity` and the ledger). Leading entries are `register` when the record is `complete`, else `view`; consents have `NULL` maturity and ledger. Events after `V` append. This needs every event at or below `V` indexed, which the store-after-cursor rule guarantees.

## Cursor and retention

The Stellar cursor is shared by every contract on the chain. Setting the key indexes from the current cursor. When the contract already emitted events, rewind the cursor to or below the first event while it is still within Soroban RPC retention (replays dedupe on `(chain_id, contract_address, block_number, log_index)`). Beyond retention the sync loop seeds current state from views (`record`, `inspection`, `terms`, `extension_consents`, `inspectors`, `paused`, `loan_registry`). Rollout steps for pipeline-test are in [backend.md](./backend.md#stellar-contract-ids-and-signer-roles).

## Known limitations

- **Current-state reads.** `simulateTransaction` cannot be pinned to a ledger (TD-19). The snapshot-plus-later-events rule makes state safe; `coverage_detail` and `loan_money` are two simulates and can differ by a ledger or two (a few seconds of interest), while `ltv_bps` and `coverage_bps` come from one read and are self-consistent (TD-171).
- **Seeded history is partial.** Events emitted before the key was set and beyond retention are lost: margin-call history and the opening `cure_by`, doc provenance (`view`), consent maturities, inspection `flagged` for flags no longer current, resolution history. Rows show `complete = false`.
- **Doc labels after an indexing gap.** A gap in indexing (key unset for a while, cursor never rewound) mislabels doc provenance the same way the Pocket's `complete` can be wrong. The remedy is a cursor rewind within retention.
- **`margin_call_at = 0` collision.** The contract stores the ledger time as `margin_call_at`, so at timestamp 0 (contract unit tests only) a call does not register as open and every write re-emits `margin_call`. The fold mirrors it: `margin_call_at = ts = 0` means none. Real networks never have timestamp 0.
- The new rows stay out of `/v1/audit-log` until #1781 extends `AUDIT_EVENT_NAMES`.
