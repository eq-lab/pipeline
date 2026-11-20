# SecurityRegistry events and projection (Stellar and EVM)

How the worker indexes the SecurityRegistry on Stellar (issue #1779, epic #1775) and on EVM (issue #1938, epic #1937): stored events, the views that fill what events do not carry, and the projection tables that #1780 (API), #1781 (audit log), #1783, #1784, #1785 and, for EVM, #1940 read. The EVM indexer is the Stellar indexer: the same three layers, the same tables, the same fold and the same sync loop. The sync core and the fold are shared; the differences below are the only ones.

Source of truth: `pipeline-stellar-contracts@e9881ac`, `contracts/security-registry` (`event.rs`, `types.rs`, `lib.rs`, `storage.rs`, `error.rs`). Testnet deployment #42: `CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX` (stored under the `collateral_registry` key of `addresses.json`; see the trap in [backend.md](./backend.md#stellar-contract-ids-and-signer-roles)), deployed around ledger 5 569 998. Contracts are frozen; the legacy CollateralRegistry parser stays as history ([collateral-registry-events.md](./collateral-registry-events.md)).

EVM source of truth: `pipeline-contracts@150631a`; the deployed Hoodi SecurityRegistry and Reader are `pipeline-contracts@f92d719`, and both shapes are decoded (see [Deployed versions](#deployed-versions)) (`src/securityRegistry/SecurityRegistryUpgradeable.sol`, `src/PipelineSecurityRecordNft.sol`, `src/PipelineSecurityRegistryReader.sol`, `src/interfaces/ISecurityRegistry.sol`, `src/interfaces/ISecurityRecordNft.sol`). Hoodi `deployments/hoodi-v5.json`: `PipelineSecurityRegistry` proxy `0xB51E7f13420D106946376A67Fe5921C63B09BE15`, `PipelineSecurityRecordNft` proxy `0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09`, `PipelineSecurityRegistryReader` `0x8e7078c73068F9F3d4e2210cfe5B4981eB7f1b6B`.

**Differences from Stellar** (everything not listed is identical):

| # | Area | Stellar | EVM |
|---|---|---|---|
| D1 | Emitters and keys | one contract, one key | three contracts, three keys set together: the registry (21 topics), the RecordNft (`DocAdded`, `InspectionRecorded`, `InspectionApproved`, `InspectorsSet`; it also holds `inspection`, `inspectors` and the record details) and the Reader (the coverage and combined record views) |
| D2 | `contract_logs.contract_address` of RecordNft events | the registry id | the RecordNft address; worker queries take the list of log addresses (`[registry]` on Stellar, `[registry, nft]` on EVM); projection tables stay keyed by the registry |
| D3 | View height | `simulateTransaction.latestLedger` | `eth_blockNumber − LOG_CONFIRMATIONS_DELAY`, named in the `eth_call` and returned as the height |
| D4 | "Not found" | `Error(Contract, #1 / #14 / #25)` in the message | the 4-byte selectors of `SecurityRegistryNonExistentRecord()`, `SecurityRegistryNoTerms()` and `SecurityRecordNftNonExistentInspection()` in the revert data |
| D5 | Event decoding | field names over ScVal maps | `sol!` events, positional ABI decoding, same stored names and params |
| D6 | Amount scale and par mark | raw 7 dp, USD par `10000000` | raw 6 dp, USD par `1000000` (`PAR_VALUE`) |
| D7 | Id width | `u32` | `uint256`; parsers store the decimal string verbatim. Views error on ids above `u32::MAX`; the repo reads ids as `bigint` (SQL cast) and drops values above `u32::MAX` from the result lists. A stored id at or above 2^63 would fail the cast (the cycle errors and is retried), but EVM ids are counters, so the bound is unreachable in practice |
| D8 | Address text | Strkey `G…` / `C…` | EIP-55 |
| D9 | `Terms` | 12 fields | plus `defaultRatioBps`, `originatorFeeRate`, `defaultBreachAt` in nullable columns (`NULL` on Stellar) |
| D10 | Margin-call history | `open` / `price_stale` / `cured` | plus `default_breach`, `default_breach_price_stale`, `default_breach_cleared` |
| D11 | Coverage view | `coverage_detail` on the registry | `coverageDetail` on the Reader, plus `defaultBreachAt` (nullable valuation column) |
| D12 | Allow-listed topics | `mint`, `burn`, `ownership_*` | RecordNft ERC-721 `Transfer` / `Approval` / `ApprovalForAll`, `SecurityRegistrySet`; on both contracts `Initialized`, `Upgraded`, `AuthorityUpdated` |
| D13 | Address filter in the handler | routing by contract id | the handler checks `log.address()` (EVM handlers receive every log) |
| D14 | Distinct-role check | `StellarIndexerSettings::from_chain_env` | `run_indexer_job`, same wording |
| D15 | Cursor and backfill | rewind only within Soroban RPC retention | a rewind to the deploy block always works |

## Configuration

`CHAIN_<id>_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS` (optional). Unset or whitespace ships dark: no polling, no sync task, empty tables. A set value is validated as a Strkey `C…` contract id (CRC included) and joins the distinct-role check as `SECURITY_REGISTRY_ADDRESS`; a value equal to the legacy `COLLATERAL_REGISTRY_ADDRESS` (or any other role) fails boot. The worker logs "Stellar SecurityRegistry indexer enabled". The API side is a separate optional key, `CHAIN_<id>_STELLAR_API_SECURITY_REGISTRY_ADDRESS` (#1780), which must equal this one; it serves `GET /v1/loan-book/{loan_id}/security` ([loan-security-state.md](../product-specs/loan-security-state.md)).

**EVM.** Three keys, all set or all unset: `CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS`, `…_SECURITY_RECORD_NFT_ADDRESS` and `…_SECURITY_REGISTRY_READER_ADDRESS`. All blank ships dark: no handler, no sync task, empty tables. Any other combination fails boot with `…_<missing key> must be set when …_<present key> is set; the SecurityRegistry, RecordNft and Reader keys are set together`. Each value must be a valid EVM address (the error names the key). In `run_indexer_job` the three addresses join the distinct-role check, right after the legacy `COLLATERAL_REGISTRY_ADDRESS`, as `SECURITY_REGISTRY_ADDRESS`, `SECURITY_RECORD_NFT_ADDRESS` and `SECURITY_REGISTRY_READER_ADDRESS`; a duplicate fails boot with "duplicates another configured contract address; each role must point at a distinct contract". The worker logs "EVM SecurityRegistry indexer enabled". The registry and RecordNft handler is registered first, before every other EVM handler. A Hoodi example is in `.env.example`.

**EVM API (#1940).** Two optional keys, set together: `CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS` and `CHAIN_<id>_EVM_API_SECURITY_RECORD_NFT_ADDRESS`, equal to the worker's registry and RecordNft keys (EIP-55). All blank ships dark (`404 security_registry_not_configured`); a partial set fails boot naming the missing key. There is no Reader key: the Reader emits no events and the API has no RPC. The RecordNft key scopes the route's `refresh_pending` to the RecordNft events, as the worker's watermarks are.

## Encoding rules

- Ids (`loan_id`, `record_id`, `lot_id`, `inspection_id`, `from_record_id`, `to_record_id`) are decimal strings.
- `u32` bps fields and the signed `i32` variances are JSON numbers.
- `u64` times and durations are decimal strings.
- `i128` amounts are decimal strings, raw at 7 dp.
- `BytesN<32>` is lowercase hex without `0x`.
- Enums are the variant name (a unit enum is `Vec([Symbol(variant)])` on chain); addresses are the Strkey (`G…` / `C…`); `bool` is a JSON bool.
- Every event is a `#[contractevent]` with the default map format: `topics[0]` is the snake_case symbol, `#[topic]` fields follow in declaration order, `value` is a map of the rest. A field-less event has an empty map.

Rows land in `contract_logs` through the existing `StellarLogMapper`; no RPC runs inside `index_once`.

**EVM.** Stored names and params are the same as Stellar's (same keys, same shapes):

- Amounts are raw at 6 dp. Ids are `uint256` and are stored as decimal strings.
- `uint32` bps and the `int32` variances are JSON numbers; `uint64` times and `uint256` amounts are decimal strings.
- `bytes32` is lowercase hex without `0x`.
- Addresses are EIP-55 (the form `ContractLogMapper` stores for `contract_address`).
- Enums are the variant name through ordinal tables, with `"Unknown"` out of range.
- `benchmark` is the `bytes32` as text (`PAR`, `LME`, …) or, when not printable, as hex.

The index path is `dispatch_security_registry`: it parses a log into a `ContractLog`, with no RPC.

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

**EVM event table.** `indexer/security_registry_parsers.rs`, `sol!` events copied from the contracts at `150631a` and checked against `forge inspect <Contract> events`. Stored names and params are the Stellar ones; only the differences are noted. Registry events are emitted by `PipelineSecurityRegistry`, RecordNft events by `PipelineSecurityRecordNft` and stored under the RecordNft address.

| Solidity event | Emitter | Stored `event_name` | Notes |
|---|---|---|---|
| `RecordRegistered(loanId, recordId, lotId, Protection)` | registry | `SecurityRecordRegistered` | |
| `RecordPerfected(loanId, recordId, evidenceHash)` | registry | `SecurityRecordPerfected` | |
| `RecordHandedOver(loanId, fromRecordId, toRecordId, evidenceHash)` | registry | `SecurityRecordHandedOver` | |
| `RecordAttested(loanId, recordId, attestedBy)` | registry | `SecurityRecordAttested` | |
| `DocAdded(loanId, recordId, DocKind, hash)` | RecordNft | `SecurityDocAdded` | `hash` is stored as `sha256`; 13 `DocKind` variants |
| `RecordReleased(loanId, recordId, reasonHash, byConsent)` | registry | `SecurityRecordReleased` | |
| `MandateBreach(loanId, evidenceHash)` | registry | `SecurityMandateBreach` | |
| `EnforcementStarted(loanId, recordId)` | registry | `SecurityEnforcementStarted` | |
| `RecordEnforced(loanId, recordId, proceedsHash)` | registry | `SecurityRecordEnforced` | |
| `TermsSet(loanId, Terms)` `150631a` shape, topic0 `0x35ef31a2…` | registry | `SecurityTermsSet` | the 12 Stellar keys plus `default_ratio_bps` and `originator_fee_rate` (numbers) and `default_breach_at` (string) |
| `TermsSet(loanId, Terms)` `f92d719` shape, topic0 `0xafe2a37a…` | registry | `SecurityTermsSet` | the 12 Stellar keys only (no EVM extras; the three keys are absent, not `null`) |
| `Revalued(loanId, recordId, valuePerUnit, benchmark, reportHash)` | registry | `SecurityRevalued` | |
| `MarginCall(loanId, ltvBps, marginCallRatioBps, cureBy)` | registry | `SecurityMarginCall` | `cure_by` is a string |
| `PriceStale(loanId, ltvBps, marginCallRatioBps)` | registry | `SecurityPriceStale` | |
| `MarginCallCured(loanId, ltvBps)` | registry | `SecurityMarginCallCured` | |
| `DefaultBreach(loanId, ltvBps, defaultRatioBps)` | registry | `SecurityDefaultBreach` | EVM only: `loan_id`, `ltv_bps`, `default_ratio_bps` |
| `DefaultBreachPriceStale(loanId, ltvBps, defaultRatioBps)` | registry | `SecurityDefaultBreachPriceStale` | EVM only: `loan_id`, `ltv_bps`, `default_ratio_bps` |
| `DefaultBreachCleared(loanId, ltvBps)` | registry | `SecurityDefaultBreachCleared` | EVM only: `loan_id`, `ltv_bps` |
| `InspectionRecorded(loanId, recordId, inspectionId, lotId, inspector, InspectionKind)` | RecordNft | `SecurityInspectionRecorded` | |
| `InspectionApproved(loanId, recordId, inspectionId, approvedBy, 3 × int32, flagged)` | RecordNft | `SecurityInspectionApproved` | |
| `FlagResolved(loanId, recordId, inspectionId, FlagOutcome, reasonHash)` | registry | `SecurityFlagResolved` | |
| `ExtensionConsent(loanId, newMaturity, consentHash)` | registry | `SecurityExtensionConsent` | |
| `InspectorsSet(address[])` | RecordNft | `SecurityInspectorsSet` | |
| `LoanRegistrySet(address)` | registry | `SecurityLoanRegistrySet` | |
| `Paused(address)` / `Unpaused(address)` | registry | `SecurityRegistryPaused` / `SecurityRegistryUnpaused` | `{}` (the account is not stored) |

That is 26 decoders and 25 stored names (`SecurityTermsSet` has two decoders, one per `Terms` shape): 21 names from the registry and 4 from the RecordNft. `DefaultBreachPriceStale` carries `defaultRatioBps` on chain, so it is stored with it (the history row keeps `default_ratio_bps`). Two topic0s are shared with the legacy EVM CollateralRegistry (`Revalued`, `DocAdded`), so the handler checks `log.address()` and is registered first.

### Deployed versions

Hoodi runs the SecurityRegistry and Reader from `pipeline-contracts@f92d719`; `150631a` adds `defaultRatioBps`, `originatorFeeRate` and `defaultBreachAt` to `Terms`, `defaultBreachAt` to the Reader's `CoverageDetail`, and the three `DefaultBreach*` events. Contracts are never changed, so the worker accepts both:

- **Events** pick the decoder by topic0 (the `Spec` table is keyed by `(emitter, topic0)`). The `f92d719` `TermsSet` stores only the 12 shared keys.
- **Views** use one `eth_call` and a strict decode (`validate = true`): `150631a` first, then `f92d719`. `terms` is 480 bytes in the new shape and 384 in the old; `coverageDetail` has an 11-word head with records offset `0x160` in the new shape and a 10-word head with `0x140` in the old, so at most one shape accepts a payload. The `f92d719` shape stores `default_ratio_bps`, `originator_fee_rate` and `default_breach_at` as `NULL`, never a default. A payload that fits neither fails with an error naming both shapes.
- `DefaultBreach*` events are never emitted on `f92d719`; the decoders stay for `150631a` deployments.
- On `f92d719` the Reader's `debt` is the pool debt `outstanding + accrued_interest`, the debt that deployment's release check uses.

## Allow-listed topics

`mint`, `burn` (the soulbound record NFT), `ownership_transfer`, `ownership_transfer_completed` and `ownership_renounced` are dropped silently: no `contract_logs` row, no projection, no holder column. The AccessManager's scheduled-operation events are indexed separately: see [access-manager-events.md](./access-manager-events.md). Any other topic from the SecurityRegistry id logs a `warn` and is dropped. Only pause state is recorded, because every write is `when_not_paused`.

**EVM.** The RecordNft's ERC-721 `Transfer`, `Approval` and `ApprovalForAll` and `SecurityRegistrySet`, and on both contracts `Initialized`, `Upgraded` and `AuthorityUpdated`, are dropped silently. Any other topic from the registry or the RecordNft address logs "SecurityRegistry emitted an unrecognised topic; dropped" (fields `contract_address`, `topic0`, `tx_hash`); a recognised topic that fails to decode logs "SecurityRegistry event failed to decode; dropped". The ERC-721 `Transfer` shares its topic0 with the ERC-20 `Transfer`, which is why the handler checks the emitting address.

The legacy CollateralRegistry dispatcher warns once per process when it sees a topic that exists only on the SecurityRegistry (`record_registered`, `terms_set`, `inspection_recorded`, …); this means the id was configured under the legacy key by mistake. Its return values and stored rows are unchanged.

**EVM.** The legacy EVM CollateralRegistry parser warns once per process, with the same meaning, when a log it could not parse carries a topic0 that only the SecurityRegistry or RecordNft emits (`TermsSet`, `RecordRegistered`, `InspectionRecorded`, …). `Revalued`, `DocAdded`, `LoanRegistrySet` and `Paused` / `Unpaused` are excluded because their topic0s are shared with the legacy CollateralRegistry or other contracts. The text names `CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS`.

## State without its own event

The contract changes some state without carrying it in an event. The fold applies these rules (all from `lib.rs` at `e9881ac`):

- `perfect` and `handover` set `attested_by` to the caller, which is not in the event. The fold sets it to `NULL` with `needs_view`, and a record snapshot read after the event fills it.
- `perfect` / `handover` add a `Perfection` doc, `mark_enforced` adds a `Proceeds` doc; `register` stores the initial docs.
- `register` marks a non-goods record at par (`value_per_unit = 10000000` on Stellar and `1000000` on EVM, benchmark `PAR`, zero report hash, `at` = the register timestamp). The fold takes the par as a chain parameter (`STELLAR_SECURITY_PARAMS`, `EVM_SECURITY_PARAMS`).
- `handover` copies the mark of `from` to `to` when `commodity` and `unit` are equal; with either unknown the mark is left and `needs_view` is set.
- `revalue` has no status check, so a mark applies in any status and to USD records (data only there).
- `resolve_flag(Accepted)` sets `reference_quantity` to the flagging inspection's quantity (unless its kind is `SamplingAssay`) and `reference_grade` to its grade when that is not 0. Without that inspection's snapshot the reference is left and `needs_view` is set.
- `resolve_flag(TopUpRequired)` opens a margin call through the same `margin_call` event.

On EVM the same rules hold (`_activate`, `_addEvidence` and `mint` do the same on chain; a handover copies the mark on equal `unit` and `commodityHash`) with the par `1000000`. Two EVM-only rules mirror the margin-call ones: `DefaultBreach` sets `default_breach_at` to the event timestamp and `DefaultBreachCleared` sets it to 0, both applied only to events after the loan snapshot's terms block; `DefaultBreachPriceStale` leaves the terms unchanged.

## Projection tables

Migrations `20261106000001_security_registry.sql` and `20261118000001_security_registry_evm.sql` (both additive). Every table is keyed by `(chain_id, contract_address, …)`. Ids are `BIGINT`; `u64` times and `i128` / `u128` amounts are `NUMERIC`; hashes and enums are `TEXT`.

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

**EVM columns** (migration `20261118000001_security_registry_evm.sql`, nullable, `NULL` on Stellar rows):

| Table | Column | Content |
|---|---|---|
| `security_terms` | `default_ratio_bps`, `originator_fee_rate` (`BIGINT`), `default_breach_at` (`NUMERIC`) | the three EVM-only `Terms` fields |
| `security_margin_call_events` | `default_ratio_bps` (`BIGINT`) | set on `default_breach` and `default_breach_price_stale` rows; `kind` also takes `default_breach`, `default_breach_price_stale` and `default_breach_cleared` |
| `security_loan_valuations` | `default_breach_at` (`NUMERIC`) | the Reader's `defaultBreachAt` |

Amounts in the valuation table are raw at 7 dp on Stellar and 6 dp on EVM, with no normalisation. `coverage_detail` panics without terms (`NoTerms`, `#14`), so only loans with a `security_terms` row are valued. On EVM `coverageDetail` reverts `SecurityRegistryNoTerms` the same way.

The lot latest inspection mirrors the on-chain `LotLatestInspection` that caps a goods record's counted quantity: among the lot's approved, non-`SamplingAssay` inspections with known `inspected_at` and quantity, the one with the largest `inspected_at` wins; on a tie the later approval wins (ordered by approval ledger and log index, or `(approved_at, inspection_id)` for seeded rows, which sort before event-approved ones). The lot is `complete = false` while an approved quantity inspection lacks its snapshot.

## Sync loop

`run_security_sync_loop` (`indexer/security_registry_sync.rs`, shared by both chains) is a separate task named `security-registry-sync`, spawned only when the key is set, tied to the indexer like the Pocket seed loop (abort on exit, panics logged). `run_security_registry_sync_loop` is the Stellar entry point over it. Every 30 s each step is best-effort and logs instead of failing; `index_once` never calls RPC, so a failing view read cannot stall indexing.

**EVM.** The loop is the same code, with an `EvmSecurityViewSource` (`indexer/security_registry_views.rs`) behind the `SecurityViewSource` trait:

- *Head and height (D3).* The source's head is `eth_blockNumber − LOG_CONFIRMATIONS_DELAY`, the same head as the indexer's, so `SNAPSHOT_MAX_LAG` stays 20. Every view read first takes that head, names it in the `eth_call` and returns it as its height; the call is not pinned to the cursor. Snapshots wait in `hold` / `release_ready` until the cursor passes that height, exactly as on Stellar. Reads target a block 12 behind the node's head, so non-archive nodes (about 128 recent states) serve them.
- *Views.* `Reader.record(id)` returns the registry record and the RecordNft details in one call; `RecordNft.inspection(id)` and `inspectors()`; registry `terms`, `extensionConsents`, `paused` and `loanRegistry`; `Reader.coverageDetail(loanId)`; `LoanRegistry.loanMoney(loanId)`. `coverageDetail` and `loanMoney` are two reads, each at its own head.
- *Not found (D4).* The source classifies a read as "missing" by the revert selector (`is_missing_record`, `is_missing_inspection`), and `terms` returns `None` on the `SecurityRegistryNoTerms` selector, as Stellar returns `terms: null` on `#14`. Revert data comes only from the JSON-RPC error payload's `data` field (a hex string, or nested `data.data`); its first 4 bytes are matched against the three selectors. Free text such as `message` is never scanned, and an unknown shape is not "missing" but a normal error that the loop retries.
- *Two emitters (D2).* Every worker-side `contract_logs` query takes the list of log addresses (`[registry, nft]`), so the fold receives one event stream ordered by `(block_number, log_index)`; the loan-registry arm of the known-loans query stays on the configured loan registry.

1. **Snapshot reads.** Simulate the views a record, inspection, loan or the contract needs and upsert them with `as_of_ledger = simulateTransaction.latestLedger`:
   - record `r`: when it has no snapshot, or a `SecurityRecordPerfected(r)` / `SecurityRecordHandedOver(to = r)` is newer than its snapshot;
   - inspection `i`: once, when it has no snapshot (the entered fields never change);
   - loan `l`: `terms(l)` (`NoTerms` stored as `terms: null`) and `extension_consents(l)`, each with its own ledger, when the loan is known but has no `SecurityTermsSet` and no loan snapshot;
   - contract: `paused()`, `inspectors()`, `loan_registry()` at loop start and hourly (the constructor sets the initial loan registry without an event).
   - **Discovery** at loop start and hourly probes `record(1, 2, …)` and `inspection(1, 2, …)`, skipping ids already indexed or snapshotted, and stops at the first `Error(Contract, #1)` / `#25`. Ids are global and sequential from 1, so this finds everything the indexer never saw; at most 200 reads per run.
   - Failures back off per entity (`pocket_seed::backoff_delay`); the first failure per entity per process is a `warn`, later ones `debug`. Error codes are matched as `Error(Contract, #<n>)`, so `#1` never matches `#14`.
   - Reads are skipped while the chain cursor is more than 20 ledgers behind the source's head (`getLatestLedger` on Stellar).
   - A snapshot is stored only once the cursor has passed its ledger (`last_indexed_block > V`); until then it is held in memory.
2. **Projection.** Loans are dirty when they have `contract_logs` rows with `id > projected_log_id` or snapshots fetched after `projected_snapshot_at`; every loan is dirty when `projection_version` is below the code's (1). Each dirty loan is folded from its rows and snapshots (`shared::security_registry::fold_loan`, pure and unit-tested) and rewritten in one transaction. Watermarks advance only if every dirty loan was rebuilt. The contract state row (`SecurityInspectorsSet`, `SecurityLoanRegistrySet`, `SecurityRegistryPaused` / `…Unpaused`, contract snapshot) is folded every cycle.
3. **Valuation.** For every loan with terms, simulate `coverage_detail(loan_id)` on the SecurityRegistry and `loan_money(loan_id)` on its own `loan_registry` and upsert `security_loan_valuations`. A loan is due when it has no valuation, when a SecurityRegistry or loan-registry log row for it is newer than `source_log_id`, or when the last read is older than 5 minutes and the last `debt` was above zero (interest accrues without events). When the contract's `loan_registry` differs from the configured `…_LOAN_REGISTRY_ADDRESS` the loop warns once per process (the EVM comparison is on EIP-55 text; the configured address is checksummed first).

**Fold rule.** Per entity (record, inspection, a loan's terms and consents, the contract state): with a snapshot at ledger `V`, start from it and apply only that entity's events with `block_number > V`; without one, fold from events alone, leave fields no event carries `NULL` and set `needs_view`; with neither, no row. History (margin-call history, doc and consent provenance, inspection `flagged`, flag resolutions) is always event-only.

`complete` means the row's opening event is indexed (`SecurityRecordRegistered`, `SecurityInspectionRecorded`, `SecurityTermsSet`); `complete = false` rows were seeded from views and their history is partial.

Docs and consents keep order and provenance by labelling the snapshot's tail: the last `k` snapshot entries belong, in order, to the `k` indexed appending events at or below `V` (`SecurityDocAdded` → `event`, `SecurityRecordPerfected` and the `to` side of `SecurityRecordHandedOver` → `perfection`, `SecurityRecordEnforced` → `proceeds`; for consents the event supplies `new_maturity` and the ledger). Leading entries are `register` when the record is `complete`, else `view`; consents have `NULL` maturity and ledger. Events after `V` append. This needs every event at or below `V` indexed, which the store-after-cursor rule guarantees.

## Cursor and retention

The Stellar cursor is shared by every contract on the chain. Setting the key indexes from the current cursor. When the contract already emitted events, rewind the cursor to or below the first event while it is still within Soroban RPC retention (replays dedupe on `(chain_id, contract_address, block_number, log_index)`). Beyond retention the sync loop seeds current state from views (`record`, `inspection`, `terms`, `extension_consents`, `inspectors`, `paused`, `loan_registry`). Rollout steps for pipeline-test are in [backend.md](./backend.md#stellar-contract-ids-and-signer-roles).

**EVM.** The EVM cursor is also one row per chain in `log_collector_state`. Setting the keys indexes from the current cursor. `eth_getLogs` keeps full history, so a rewind to the SecurityRegistry deploy block always backfills everything (worker stopped, `UPDATE log_collector_state SET last_indexed_block = <deploy block> WHERE chain_id = <id>`); replays dedupe on `(chain_id, contract_address, block_number, log_index)` and every EVM handler dedupes through `is_duplicate`. Without a rewind, discovery seeds the current state from the views (`complete = false`). The Hoodi rewind and the stage and prod env values are ops steps of the epic's merge order, not applied by the code.

## Known limitations

- **Current-state reads.** `simulateTransaction` cannot be pinned to a ledger (TD-19), and the EVM source reads at its head rather than at the cursor. The snapshot-plus-later-events rule makes state safe on both chains; `coverage_detail` / `coverageDetail` and `loan_money` / `loanMoney` are two reads and can differ by a ledger or a block or two (a few seconds of interest), while `ltv_bps` and `coverage_bps` come from one read and are self-consistent (TD-171).
- **Seeded history is partial.** Events emitted before the key was set and beyond retention are lost: margin-call history and the opening `cure_by`, doc provenance (`view`), consent maturities, inspection `flagged` for flags no longer current, resolution history. Rows show `complete = false`.
- **Doc labels after an indexing gap.** A gap in indexing (key unset for a while, cursor never rewound) mislabels doc provenance the same way the Pocket's `complete` can be wrong. The remedy is a cursor rewind within retention.
- **`margin_call_at = 0` collision.** The contract stores the ledger time as `margin_call_at`, so at timestamp 0 (contract unit tests only) a call does not register as open and every write re-emits `margin_call`. The fold mirrors it: `margin_call_at = ts = 0` means none. Real networks never have timestamp 0.
- **EVM wiring is not cross-checked at startup.** As on Stellar, a wrong RecordNft address means no NFT events and a wrong Reader address means failing `coverageDetail` reads, which back off and warn per loan. The user story checks `security_registry_state.inspectors` and a valuation row.
- The rows are listed in `/v1/audit-log` (#1781), except `SecurityLoanRegistrySet`; rendering is in [audit-logging.md](../product-specs/audit-logging.md#trustee-dashboard-feed-get-v1audit-log). Only the history that was indexed appears there. EVM `Security*` rows appear there too, with 6 dp amounts; the three `SecurityDefaultBreach*` rows are EVM only and are in its allow-list (#1940).
