# Issue #1938: EVM SecurityRegistry indexer: records, terms, marks, margin calls, inspections (SecurityRegistry + RecordNft)

Source: https://github.com/eq-lab/pipeline/issues/1938

Parent epic: #1937 (EVM parity). Stellar counterpart: epic #1775 / #1779 (`packages/worker/src/indexer/stellar/security_registry_*.rs`, spec `docs/references/security-registry-events.md`). Runs in parallel with #1939 (EVM AccessManager indexer). Blocks #1940 (API `/security` and loan-book LTV fields for EVM). No Figma reference, so there is no visual verification step.

Contracts are frozen: `pipeline-contracts@150631a`, Hoodi `deployments/hoodi-v5.json`:

- `PipelineSecurityRegistry` proxy `0xB51E7f13420D106946376A67Fe5921C63B09BE15` (`src/securityRegistry/SecurityRegistryUpgradeable.sol`).
- `PipelineSecurityRecordNft` proxy `0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09` (`src/PipelineSecurityRecordNft.sol`).
- `PipelineSecurityRegistryReader` `0x8e7078c73068F9F3d4e2210cfe5B4981eB7f1b6B` (`src/PipelineSecurityRegistryReader.sol`, non-upgradeable, immutable `securityRegistry` / `recordNft`).

## Scope

### Contract facts that drive the design (verified at `150631a`)

| Topic | Stellar (#1779) | EVM | Consequence |
|---|---|---|---|
| Emitters | one contract emits all 22 topics | registry emits 21 business + `Paused`/`Unpaused`/`LoanRegistrySet`; RecordNft emits `DocAdded`, `InspectionRecorded`, `InspectionApproved`, `InspectorsSet` | one projection (keyed by the registry address) is fed by logs of **two** addresses |
| Record | one `Record` with everything | registry `Record` (`commodityHash` only) + RecordNft `details(id)` (`RecordDetails`: perfection, commodity, region, siteHash, releaseCondition, control, docs) | record snapshot = `record(id)` + `details(id)` at the same block |
| Inspection view | `inspection(id)` on the registry | `inspection(id)` / `inspectors()` on the RecordNft | |
| Coverage | `coverage_detail(id)` on the registry | only `collateralValue` / `coverage` on the registry; `coverageDetail(id)` on the **Reader** | valuation reads the Reader (see Open Questions Q1) |
| `Terms` | 12 fields | + `defaultRatioBps` (uint32 bps), `originatorFeeRate` (uint32, LoanRegistry ppm scale like `defaultRate`), `defaultBreachAt` (uint64, contract-kept like `marginCallAt`) | Q4 |
| Extra events | none | `DefaultBreach(loanId, ltvBps, defaultRatioBps)`, `DefaultBreachPriceStale(loanId, ltvBps, defaultRatioBps)`, `DefaultBreachCleared(loanId, ltvBps)` | Q4 |
| Amounts | 7 dp (`UNIT = PAR = 10_000_000`) | **6 dp**: `PAR_VALUE = 1_000_000`; `referenceQuantity`, `referenceGrade`, `valuePerUnit`, `quantity`, `grade`, `value`, `debt` are all 1e6-scaled (`test/SecurityRegistryTest.t.sol` `UNIT = 1e6`; PLUSD `decimals() = 6`) | Q2; the fold's PAR mark is chain-dependent |
| Ids | u32 | uint256; record, lot and inspection ids are counters from 1, loan ids are `nextLoanId` counters **from 0** | keep the u32 plumbing; out-of-range ids are skipped with a warn |
| Views at a height | `simulateTransaction` cannot be pinned (TD-19/TD-171) | `eth_call` can be pinned to a block | EVM snapshot and valuation reads are pinned to `cursor - 1`; TD-171 does not apply on EVM |
| "Not found" | `Error(Contract, #1/#14/#25)` | custom-error reverts `SecurityRegistryNonExistentRecord()`, `SecurityRegistryNoTerms()`, `SecurityRecordNftNonExistentInspection()` | match the 4-byte selector in the revert data |
| Enums | `Protection`, `Unit`, `RecordStatus`, `PaymentTerm`, `FlagOutcome`, `ControlKind`, `Perfection`, `DocKind`, `InspectionKind` | same variants in the same order (uint8 ordinals) | the stored variant names are identical, so the fold and audit log need no change |
| Hidden state | `perfect`/`handover` set `attested_by` to the caller, add a `Perfection` doc; `mark_enforced` adds a `Proceeds` doc; `register` stores initial docs and marks USD at par | identical (`_activate`, `_addEvidence` → `RecordNft.addEvidence` emits nothing, `mint` stores `details.docs`) | the fold rules carry over unchanged |
| Handover mark copy | equal `commodity` and `unit` | equal `unit` and `commodityHash` (= keccak of the same commodity string) | equivalent |

### In scope

1. **Config.** Optional worker keys `CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS` and `CHAIN_<id>_EVM_INDEXER_SECURITY_RECORD_NFT_ADDRESS`, plus `CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_READER_ADDRESS` (Q1). All three unset or blank means the feature ships dark: no handler, no extra `eth_getLogs` addresses, no sync task.
2. **Log parsing.** Parse the 21 registry events and 4 RecordNft events into `contract_logs` under the existing `Security…` names. That covers the 18 the issue lists, plus `LoanRegistrySet` and `Paused`/`Unpaused` (the fold's contract state needs them), plus the 4 RecordNft events. The three default-breach events are stored as `SecurityDefaultBreach`, `SecurityDefaultBreachPriceStale` and `SecurityDefaultBreachCleared`.
3. **Sync loop.** A supervised `evm-security-registry-sync` task with the same steps as the Stellar loop (snapshot, projection, state, valuation). It reads views through a new EVM `SecurityViewSource`, pinned to `cursor - 1`.
4. **Shared code becomes chain-neutral.** The view-source trait, sync steps and `TimeoutSource` move out of `indexer/stellar/` with re-exports. The fold takes the chain's PAR value. Repo event queries take a list of log addresses.
5. **Additive migration.** EVM-only `Terms` fields and the default-breach history (Q4).
6. **Docs.** An EVM section in `docs/references/security-registry-events.md`, the backend.md section, `.env.example`, `docs/references/index.md`, `ARCHITECTURE.md`, and TD-171 wording.

### Out of scope

- The API: `/security`, the loan-book `ltv_bps` / `margin_call_open` / `price_stale`, the audit-log rendering of `SecurityDefaultBreach*`, and decimals-aware formatting. All of these belong to #1940.
- Trustee (#1942), AccessManager (#1939, #1941), and any contract or deploy-script change (#1944).
- Mark suggestions (`security_marks.rs`, 7 dp). Revaluing an EVM record needs a 6 dp `valuePerUnit`; that is a Trustee/API concern (#1940/#1942) and is noted in the hand-off.
- Stage/prod env values and the Hoodi cursor rewind. These are ops steps in the epic's merge order (step 3); they are documented here but not applied.
- User-stories docs. This is a worker-only change with no UI. The epic's `docs/user-stories/epic-1937/` will be authored with the API/Trustee issues.

## Assumptions and Risks

- **Two emitters, one projection.** RecordNft logs keep their real `contract_address` in `contract_logs`, and the repo reads events with `contract_address = ANY(log_contracts)` (Q3). Every projection table stays keyed by the registry address. The Stellar callers pass `[registry]`, so their behaviour is unchanged. Risk: a missed query would lose NFT events (docs, inspections, inspectors). The SQL-text tests in `shared/tests/security_registry_repo_sql.rs` must assert `ANY(...)` on every `contract_logs` filter the fold or sync reads.
- **Every log goes to every handler** (`poller.rs`: "offered to every registered handler in order; the first match wins"). The new handler must check `log.address()` itself, like the CollateralRegistry and Minter handlers do. Two topic0s collide with the legacy EVM CollateralRegistry parser: registry `Revalued(uint256 indexed,uint256 indexed,uint256,bytes32,bytes32)` and NFT `DocAdded(uint256 indexed,uint256 indexed,uint8,bytes32)`. Those handlers are address-filtered, so there is no cross-capture as long as the addresses differ, and the collision check enforces that. The LoanRegistry/DM/WQ/sPLUSD handlers are not address-filtered, but none of their event signatures collide with the 25 security topics. A test pins this.
- **ERC-721 `Transfer`** from the RecordNft (mint/burn) has the ERC-20 `Transfer` topic0. The PLUSD and asset-transfer handlers filter by address (`plusd_transfers.rs:26`, `asset_transfers.rs:48`), so it is not misread. The security handler allow-lists it silently.
- **Address and hash formats.** EVM `contract_logs.contract_address` is EIP-55 (`ContractLogMapper` uses `to_checksum(None)`). Every address the sync loop compares or stores must be checksummed too:
  - the registry, NFT and Reader keys;
  - `LOAN_REGISTRY_ADDRESS`, which `IndexerJobSettings` keeps as the raw env string;
  - `loanRegistry()`, `inspectors()` and the event address params.
  A lowercase env value would otherwise make `list_known_loans` / `list_valuation_candidates` miss every `LoanDrawn` row. Hashes are lowercase hex without `0x`, as on Stellar and the EVM CollateralRegistry parser.
- **Pinned reads.** Reads are pinned at `B = cursor - 1`, the last block whose logs are committed (`index_once` writes logs and the cursor in one transaction). A snapshot is therefore exact at `B`, and the fold rule "apply events with `block_number > V`" is exact. Non-archive RPCs keep about 128 recent states. The loop keeps the Stellar lag gate (skip reads while `latest − cursor > LOG_CONFIRMATIONS_DELAY + 20`), so `B` is always recent. `coverageDetail` and `loanMoney` are read at the same `B`, which removes the TD-171 two-read skew on EVM.
- **Ids.** Params store `U256::to_string()`. The fold's `p_id` → `u32` and the view decoders treat values above `u32::MAX` as invalid, and the row is skipped with the existing `warn_skip`. All on-chain counters start at 0 or 1, so this is theoretical. Loan id 0 is valid on EVM. It never collides with the contract snapshot (`entity_id = 0`) because snapshot keys include `kind`.
- **Cursor and backfill.** EVM `eth_getLogs` has no retention limit, so rewinding the chain cursor to the SecurityRegistry deploy block (Hoodi, 2026-11-05) backfills full history. Replays dedupe on `(chain_id, contract_address, block_number, log_index)`. The rewind replays every EVM handler on that chain, and all of them dedupe through `is_duplicate`. Without a rewind, discovery seeds current state from views (`complete = false`), as on Stellar.
- **Parallel work.** #1939 will touch the same files: `indexer/config.rs`, `indexer/mod.rs`, `evm_parsers.rs`, `.env.example`, `backend.md` and possibly `stellar/supervise.rs`. Expect trivial rebase conflicts. If #1939 also adds a migration, pick a version that does not clash; re-check `packages/shared/migrations/` against `main` before opening the PR.
- **API compile impact.** New fields on `TermsRow`, `TermsView` and `MarginCallEventRow` require explicit-literal constructions in `packages/api` and its tests to add them, or to use `..Default::default()`. The API's behaviour must not change. EVM rows are only read once #1940 lands. The audit log already lists `Security*` rows by name and formats amounts per `ChainKind` (`audit_log.rs:467`), so EVM security rows will start appearing there with correct 6 dp amounts as soon as the worker key is set. That is acceptable and expected. `SecurityDefaultBreach*` are not in its allow-list (#1940).
- **alloy 0.8.3.** Revert data is read from `RpcError::ErrorResp(ErrorPayload)` (`as_error_resp()` → `as_revert_data()`). Some RPCs return the revert data as a hex string in `message`. The helper accepts both and is unit-tested on constructed payloads.

## Open Questions

Each question has a recommended default. The plan below implements the defaults, so a human only needs to answer where they disagree.

1. **Q1 — Valuation source.** The registry has no `coverage_detail`. Only the `PipelineSecurityRegistryReader` returns `value`, `stale_value`, `flagged_value`, `debt`, `coverage_bps`, `ltv_bps`, `price_stale` and the counted records in one call. `collateralValue` + `coverage` alone cannot give `price_stale` or the stale/flagged splits.
   - **Default:** add a third optional key, `CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_READER_ADDRESS`. When unset, events, records, terms, inspections and margin history are still indexed, and `security_loan_valuations` stays empty (warn once). The key is valid only with the registry key, and at loop start `reader.securityRegistry()` must equal the registry.
   - **Alternative:** reimplement the Reader's `coverageDetail` in Rust from `terms`, `recordIds`, `record`, `latestInspection`, `loanMoney` and `immutableLoanData` at one block. This adds about 20 reads per loan per cycle and duplicates contract math.
2. **Q2 — Amount units in the projection.** **Default:** store raw on-chain units: 6 dp on EVM, 7 dp on Stellar, unchanged. This follows the house rule in `shared/src/chains.rs` ("`contract_logs` always stores the raw value … normalize only when … reading back out for an API consumer") and the audit log's per-`ChainKind` formatting. #1940 makes `format_7dp` / `UNIT` chain-aware. The only fold change is the PAR mark (`1000000` on EVM). **Alternative:** scale EVM amounts ×10 into 7 dp at fold time. API stays unchanged, but the projection no longer matches `contract_logs` or the contract, and the Trustee must divide again to write `revalue`.
3. **Q3 — Where RecordNft events live.** **Default:** store them under the RecordNft's real address, and give the worker-side repo event queries a `log_contracts: &[String]` (`ANY`). **Alternative:** rewrite their `contract_address` to the registry address in the mapper. That needs zero repo changes, but `contract_logs` would misattribute the emitter.
4. **Q4 — EVM-only terms and default-breach events.** **Default:** keep them.
   - Add nullable `security_terms.default_ratio_bps`, `originator_fee_rate` and `default_breach_at` (NULL on Stellar).
   - Store the three events in `contract_logs`.
   - Fold them into `security_margin_call_events` with new kinds `default_breach`, `default_breach_price_stale` and `default_breach_cleared`, plus a new nullable `default_ratio_bps` column.
   - `DefaultBreach` sets `security_terms.default_breach_at` to the block timestamp; `DefaultBreachCleared` sets it to 0 (mirrors `MarginCall` / `MarginCallCured`).

   The API ignores the new kinds until #1940 (it filters `kind == "open"` / `"price_stale"`). **Alternative:** store the raw logs only and leave them out of the projection.
5. **Q5 — Partial configuration.** **Default:** the registry and NFT keys must be set together. Setting only one fails boot and names the missing key, because a registry without the NFT silently loses docs, inspections and inspectors. A Reader key without the registry key also fails boot. A malformed address or a collision with any other configured EVM role (DM, WQ, sPLUSD, LoanRegistry, Minter, legacy CollateralRegistry, DealTokenFactory, PLUSD, USDC asset) fails boot. **Alternative:** warn and ship dark.

## Implementation Steps

### 1. Migration (additive)

`packages/shared/migrations/20261118000001_security_registry_evm.sql`. Re-check the version against `main` and #1939 before the PR. Give it the header comment style of `20261106000001_security_registry.sql`, with a rollback note.

```sql
ALTER TABLE security_terms
    ADD COLUMN IF NOT EXISTS default_ratio_bps   BIGINT  NULL,
    ADD COLUMN IF NOT EXISTS originator_fee_rate BIGINT  NULL,
    ADD COLUMN IF NOT EXISTS default_breach_at   NUMERIC NULL;
ALTER TABLE security_margin_call_events
    ADD COLUMN IF NOT EXISTS default_ratio_bps BIGINT NULL;
```

The snapshot `kind` CHECK is unchanged, because EVM uses `record` / `inspection` / `loan` / `contract`.

### 2. `packages/shared/src/security_registry.rs`

- `SECURITY_LOAN_EVENT_NAMES`: append `SecurityDefaultBreach`, `SecurityDefaultBreachPriceStale` and `SecurityDefaultBreachCleared`. Adjust the array length and keep `is_security_registry_event` consistent.
- Replace the hard-coded par with a chain parameter:
  ```rust
  pub struct SecurityChainParams { pub par_value_per_unit: &'static str }
  pub const STELLAR_SECURITY_PARAMS: SecurityChainParams = SecurityChainParams { par_value_per_unit: "10000000" };
  pub const EVM_SECURITY_PARAMS: SecurityChainParams = SecurityChainParams { par_value_per_unit: "1000000" };
  ```
  `fold_loan` / `fold_loan_report` take `params: &SecurityChainParams` and thread it to `apply_record_event` → `par_mark`. Keep `PAR_VALUE_PER_UNIT` as an alias of the Stellar value, or remove it if unused.
- `TermsView`: add `#[serde(default)] default_ratio_bps: Option<u32>`, `originator_fee_rate: Option<u32>` and `default_breach_at: Option<String>`. Existing Stellar snapshot JSON keeps deserializing.
- `TermsRow`: add `default_ratio_bps: Option<i64>`, `originator_fee_rate: Option<i64>` and `default_breach_at: Option<BigDecimal>`. `terms_from_view` / `terms_from_params` read them optionally (absent → `None`; present but unparsable → `None`). Never fail the row on them.
- `MarginCallEventRow`: add `default_ratio_bps: Option<i64>`. In `fold_loan_report`:
  - `SecurityDefaultBreach` → push kind `default_breach` (`ltv_bps`, `default_ratio_bps`). When `after(terms_v, ev)`, set `terms.default_breach_at = ts(ev)`.
  - `SecurityDefaultBreachPriceStale` → push kind `default_breach_price_stale` (no terms change).
  - `SecurityDefaultBreachCleared` → push kind `default_breach_cleared`. When `after(terms_v, ev)`, set `terms.default_breach_at = 0`.
  - Missing params → `warn_skip`, counted in `skipped`.
- Do not bump `SECURITY_PROJECTION_VERSION`: Stellar output is unchanged and no EVM rows exist yet.

### 3. `packages/shared/src/security_registry_repo.rs`

- Every `contract_logs` filter that the worker-side fold and sync read changes `contract_address = $2` to `contract_address = ANY($k)`, and the method gains `log_contracts: &[String]`. The affected queries are:
  - `LIST_LOAN_EVENTS_SQL`, `LIST_CONTRACT_EVENTS_SQL`, `MAX_LOG_ID_SQL`;
  - the `contract_logs` halves of `LIST_DIRTY_LOANS_SQL`, `LIST_ALL_LOANS_SQL` and `LIST_KNOWN_LOANS_SQL` (not the `LoanDrawn` arm, which stays `= $3` configured loan registry);
  - `LIST_RECORD_EVENT_LEDGERS_SQL` (both arms), `LIST_INSPECTION_IDS_SQL`, `LIST_LOANS_WITH_TERMS_EVENT_SQL`, `LIST_RECORD_LOANS_SQL`.

  Projection-table filters stay `contract_address = $2` (the registry).
- Leave the API-side queries (`LOAN_LOG_WATERMARKS_SQL`, `LIST_SALE_REPAYMENTS_SQL`, `load_loan_security`) unchanged. #1940 decides how the API passes the NFT address.
- `INSERT_TERMS_SQL` / `GET_TERMS_SQL` include the three new columns. `INSERT_MARGIN_EVENT_SQL` / `LIST_MARGIN_EVENTS_FOR_LOAN_SQL` include `default_ratio_bps`. Update the `replace_loan_projection` binds.
- Update the Stellar callers in `stellar/security_registry_sync.rs` to pass `std::slice::from_ref(&contract_id)`. Behaviour is identical.

### 4. Chain-neutral sync core (worker)

Move the chain-neutral parts out of `indexer/stellar/` with `pub use` re-exports from the old paths, so `stellar/poller.rs` and the existing `tests/stellar_security_registry_*.rs` compile unchanged:

- New `packages/worker/src/indexer/security_registry_views.rs`: the `SecurityViewSource` trait and `contract_view`. Extend the trait with methods that default to the Stellar behaviour:
  - `async fn latest_height(&self) -> Result<u64>`;
  - `fn begin_cycle(&self, cursor: u64) {}`;
  - `fn is_end_of_records(&self, e: &anyhow::Error) -> bool`;
  - `fn is_end_of_inspections(&self, e: &anyhow::Error) -> bool`;
  - `fn valuation_enabled(&self) -> bool { true }`.

  `RpcSecurityViewSource` (Stellar) implements `latest_height` via `rpc.get_latest_ledger()` and the end-of checks via `is_contract_error(.., NO_RECORD_CODE / NO_INSPECTION_CODE)`.
- New `packages/worker/src/indexer/security_registry_sync.rs`: today's `stellar/security_registry_sync.rs` body, made generic:
  - `SyncCtx<S: SecurityViewSource>` drops `rpc`, and adds `log_contracts: Vec<String>`, `max_lag: u64` and `params: &'static SecurityChainParams`.
  - `snapshot_step` calls `source.begin_cycle(cursor)` and uses `source.latest_height()`.
  - `discover_*` use the trait end-of checks.
  - `valuation_step` returns early when `!source.valuation_enabled()` and uses `log_contracts + [loan_registry]` for dirtiness.
  - `project_loan` passes `params`.
  - `TimeoutSource` forwards the new trait methods.
  - Expose `run_security_sync_loop<S>(source, repo, events, chain_id, contract_id, log_contracts, configured_loan_registry, max_lag, params)`.
- `stellar/security_registry_sync.rs` keeps `run_security_registry_sync_loop(rpc, repo, events, chain_id, contract_id, configured_loan_registry)` as a thin wrapper: `log_contracts = [contract_id]`, `max_lag = 20`, `STELLAR_SECURITY_PARAMS`. Constants stay re-exported.
- `stellar/supervise.rs` (`KeyedBackoff`, `spawn_supervised`): import it from the EVM side as is. Moving it is optional. If it stays under `stellar/`, log a tech-debt entry (step 9).

### 5. EVM log parsing — new `packages/worker/src/indexer/security_registry_evm_parsers.rs`

Header: `// spec: docs/references/security-registry-events.md#evm-event-table`.

- `sol!` module with the events (and the `Terms` struct) copied verbatim from `SecurityRegistryUpgradeable.sol:30-54`, `PipelineSecurityRecordNft.sol:25-45`, and OZ `Paused(address)` / `Unpaused(address)`. Enums are declared as `uint8` in the sol! signatures; topic0 is unaffected.
- Explicit ordinal → name tables with `"Unknown"` for out-of-range ordinals, unit-tested: `protection_name`, `unit_name`, `record_status_name`, `payment_term_name`, `flag_outcome_name`, `control_kind_name`, `perfection_name`, `doc_kind_name` (13 variants incl. `LegalOpinion`, `Perfection`, `Proceeds`; it differs from the legacy CR table) and `inspection_kind_name`. Reuse `collateral_registry_parsers::benchmark_string` for `bytes32` benchmarks.
- Stored names and params mirror the Stellar table exactly:
  - snake_case keys;
  - ids as decimal strings (`U256::to_string()`);
  - bps and `i32` variances as JSON numbers;
  - `u64` times and `uint256` amounts as decimal strings;
  - hashes as lowercase hex without `0x`;
  - addresses EIP-55;
  - enums as variant names.

  EVM specifics:
  - `DocAdded.hash` is stored under the key **`sha256`** (the fold reads `sha256`).
  - `TermsSet` flattens the 12 Stellar keys plus `default_ratio_bps`, `originator_fee_rate` (numbers) and `default_breach_at` (string).
  - `MarginCall.cure_by` is a string.
  - `Paused` / `Unpaused` → `SecurityRegistryPaused` / `SecurityRegistryUnpaused` with `{"account": <EIP-55>}`.
  - `LoanRegistrySet` → `SecurityLoanRegistrySet` `{loan_registry}`.
  - `InspectorsSet` → `SecurityInspectorsSet` `{inspectors: [..EIP-55]}`.
  - `DefaultBreach*` → `SecurityDefaultBreach{,PriceStale,Cleared}` with `{loan_id, ltv_bps[, default_ratio_bps]}`.
- `pub fn parse_security_registry_log(log, registry, nft) -> Option<ContractLog>`:
  - It decodes only logs whose `log.address()` is the registry (registry topic table) or the NFT (NFT topic table).
  - A known topic0 that fails to decode → `warn` + `None`.
  - Allow-listed topics → silent `None`:
    - NFT `Transfer` / `Approval` / `ApprovalForAll` / `SecurityRegistrySet`;
    - `Initialized(uint64)`, `Upgraded(address)` and `AuthorityUpdated(address)` on either contract.
  - Any other topic0 from these addresses → `warn` + `None`.

  Use `extract_log_meta` and a `build` helper like `collateral_registry_parsers.rs`. Export the topic tables (`SECURITY_REGISTRY_EVM_TOPICS`, `SECURITY_RECORD_NFT_EVM_TOPICS`) for tests.

### 6. EVM view source — new `packages/worker/src/indexer/security_registry_evm_views.rs`

Header: `// spec: docs/references/security-registry-events.md#evm-sync-loop`.

- `sol!` interface subsets:
  - registry: `record`, `terms`, `extensionConsents`, `paused`, `loanRegistry`, `recordNft`;
  - RecordNft: `details`, `inspection`, `inspectors`, `securityRegistry`;
  - Reader: `coverageDetail`, `securityRegistry`;
  - LoanRegistry: `loanMoney`;
  - custom errors: `SecurityRegistryNonExistentRecord()`, `SecurityRegistryNoTerms()`, `SecurityRecordNftNonExistentInspection()`.
- Pure decoders, so tests need no RPC:
  - `decode_record(record_ret, details_ret) -> RecordView`: `hasMark` → `Some(MarkView)`, `attestedBy == 0` → `None`, `control.ref` → `control_reference`, `commodityHash` dropped. Ids go through `U256 → u32` with an error when out of range.
  - `decode_inspection` (`approvedBy == 0` → `None`).
  - `decode_terms` (with the 3 extras).
  - `decode_coverage_detail` (drops `defaultBreachAt`; terms carry it).
  - `decode_loan_money`, `decode_inspectors` (EIP-55), `decode_consents` (hex without `0x`).
  - `revert_selector(&anyhow::Error) -> Option<[u8; 4]>`: walks the chain to the alloy `RpcError`, reads the revert data from the `ErrorPayload`, and accepts `data` as a hex string or nested JSON.
- `EvmSecurityViewSource { provider, registry, nft, reader: Option<Address>, pin: AtomicU64 }` implements the trait:
  - every `eth_call` is pinned with `.block(BlockId::number(pin))`, and returns `(view, pin)`;
  - `begin_cycle(cursor)` stores `cursor.saturating_sub(1)`;
  - `latest_height` = `get_block_number`;
  - `record(id)` = `record(id)` + `details(id)` at the same pin;
  - `terms` → `Ok((None, pin))` on the `NoTerms` selector;
  - `inspectors()` reads the NFT;
  - `paused()` / `loan_registry()` read the registry (EIP-55);
  - `coverage_detail` reads the Reader;
  - `loan_money(registry, id)` calls the given LoanRegistry;
  - `is_end_of_*` match the selectors;
  - `valuation_enabled()` = `reader.is_some()`.
- `pub async fn verify_wiring(...)`, called once at loop start. `registry.recordNft()` must equal the NFT key, `nft.securityRegistry()` must equal the registry key, and, if set, `reader.securityRegistry()` must equal the registry key. A mismatch returns `Err`, so the supervised task logs and restarts with backoff while event indexing continues. A transient RPC error also returns `Err`, with the same restart path.

### 7. EVM wiring

- `indexer/config.rs` `IndexerJobSettings`: add `security_registry: Option<EvmSecurityRegistryConfig { registry: Address, record_nft: Address, reader: Option<Address> }>` parsed from the three keys. Use `env_nonblank` + `parse_evm_address`, and apply the Q5 pairing rules with errors that name the key.
- `indexer/mod.rs` `run_indexer_job`:
  - Push `SECURITY_REGISTRY_ADDRESS`, `SECURITY_RECORD_NFT_ADDRESS` and `SECURITY_REGISTRY_READER_ADDRESS` into `core_roles`, and reject collisions with every configured role (DM, WQ, sPLUSD, LoanRegistry, Minter, legacy CollateralRegistry, DealTokenFactory, PLUSD, asset). Use one helper, `reject_security_collision`, unit-tested.
  - Log "EVM SecurityRegistry indexer enabled" with the three addresses, or a warn when the Reader is unset ("valuation disabled").
  - Spawn `spawn_supervised("evm-security-registry-sync", chain_id, ..)` and keep the guard alive across `index_loop`. The task calls `verify_wiring` and then `run_security_sync_loop` with:
    - `contract_id = registry.to_checksum(None)`;
    - `log_contracts = [registry, nft]` checksummed;
    - `configured_loan_registry = Some(loan_registry_address parsed → to_checksum)`;
    - `max_lag = log_confirmations_delay + 20`;
    - `EVM_SECURITY_PARAMS`.
- `indexer/evm_parsers.rs`: add `security_registry: Option<(Address, Address)>` to `EvmContractAddresses`, and register an `add_event_handler(vec![registry, nft], ..)` that calls `parse_security_registry_log` and wraps the result in `ContractLogMapper`. Unset → no handler and no addresses.
- `.env.example`: add the three keys after `…_PLUSD_ADDRESS` in the EVM example block, marked optional and dark while unset. The registry and NFT keys go together. The Reader key enables valuation. Add the Hoodi values as a comment, and the cursor-rewind hint.
- `scripts/check-chain-env-names.sh`: no change, since it lists only retired names. Confirm it still passes.

### 8. Clean-up and lint

- Comment-less code rule: one spec-pointer header per new file and nothing else.
- `cargo clippy --all -- -D warnings`, `cargo fmt`, `scripts/check-chain-env-names.sh` and `npx tsx scripts/lint-docs.ts`.

### 9. Docs (see Docs to Update)

## Test Strategy

All tests live in `packages/<pkg>/tests/*.rs`. They are pure, with no DB access and no `DATABASE_URL` / `POSTGRES_URL`. EVM logs and call returns are built in-process with `alloy` (`SolEvent::encode_log_data`, `SolCall::abi_encode_returns`).

- **`packages/worker/tests/evm_security_registry_config.rs`** (new, `ENV_LOCK` pattern from `evm_collateral_registry_config.rs`):
  - all unset or blank → `None`;
  - registry + NFT → `Some` with `reader: None`, and with the Reader → `Some(reader)`;
  - only registry or only NFT → `Err` naming the missing key;
  - Reader alone → `Err`;
  - malformed address → `Err` naming the key;
  - collision helper rejects equality with each core role.
- **`packages/worker/tests/evm_security_registry_parsers.rs`** (new):
  - one case per stored event (21 registry + 4 NFT), asserting `event_name` and the exact `params` JSON, including `DocAdded.hash → sha256`, the flattened `TermsSet` with the 3 extras, benchmark `"PAR"`, EIP-55 addresses, and hashes without `0x`;
  - the same log from a third address → `None`;
  - NFT ERC-721 `Transfer`, `Initialized`, `Upgraded`, `AuthorityUpdated` and `SecurityRegistrySet` → `None`;
  - unknown topic0 → `None`;
  - truncated data for a known topic → `None`;
  - an id above `u32::MAX` is stored verbatim as a decimal string;
  - every enum name table, including `"Unknown"`;
  - none of the 25 security topic0s is decoded by the unfiltered DM/WQ/sPLUSD/LoanRegistry parsers in `parsers.rs`;
  - the topic tables have no duplicate topic0.
- **`packages/worker/tests/evm_security_registry_views.rs`** (new):
  - `decode_record` with and without a mark, an attested and an unattested record, and an id above `u32::MAX` → `Err`;
  - `decode_inspection` (approved and unapproved);
  - `decode_terms` incl. the extras;
  - `decode_coverage_detail` (`coverage_bps = u32::MAX` when debt is 0);
  - `decode_loan_money`, `decode_inspectors`, `decode_consents`;
  - `revert_selector` on constructed `ErrorPayload`s (data as hex string, missing data, non-revert error);
  - classification of the 3 selectors versus an unrelated selector.
- **`packages/worker/tests/evm_security_registry_replay.rs`** (new): parse a main-flow sequence of EVM logs into `SecurityEventRow`s and run `fold_loan(.., &EVM_SECURITY_PARAMS)`. The flow is: `TermsSet` → `RecordRegistered` (USD, then goods) → `RecordPerfected` → NFT `DocAdded` → `InspectionRecorded` / `InspectionApproved(flagged)` → `FlagResolved(Accepted)` → `Revalued` → `MarginCall` → `DefaultBreach` → `DefaultBreachCleared` → `MarginCallCured` → `RecordReleased`. Assert:
  - the USD record's par mark is `1000000`;
  - doc provenance (`register` / `perfection` / `event`);
  - `flagged_by` set and cleared;
  - the lot's latest inspection;
  - `terms.default_breach_at` (ts, then 0);
  - margin events with the new kinds and `default_ratio_bps`;
  - `skipped == 0`.
- **Sync core** (extend `packages/worker/tests/stellar_security_registry_sync.rs`, or a new `evm_security_registry_sync.rs` with a fake `SecurityViewSource`):
  - with `begin_cycle(cursor)` pinning, writes have `as_of_ledger = cursor − 1` and are released by `release_ready` in the same cycle;
  - discovery stops on the source's end-of-records / end-of-inspections classification;
  - `valuation_enabled() == false` skips `coverage_detail` / `loan_money` entirely;
  - `TimeoutSource` forwards the new methods;
  - the existing Stellar sync tests pass unchanged (regression for the re-exports and the wrapper).
- **`packages/shared/tests/security_registry_fold.rs`** (extend):
  - the Stellar par stays `10000000` with `STELLAR_SECURITY_PARAMS`;
  - EVM par is `1000000`;
  - a `DefaultBreach` before the loan snapshot's `terms_ledger` does not overwrite `default_breach_at`, and one after it does;
  - `DefaultBreachPriceStale` leaves terms untouched;
  - a `TermsSet` without the extras → `None` fields (Stellar);
  - with the extras → parsed;
  - a `TermsView` JSON without the extras still deserializes (old Stellar snapshot payloads).
- **`packages/shared/tests/security_registry_repo_sql.rs`** (extend): every worker-side `contract_logs` read uses `contract_address = ANY(`; projection tables still use `contract_address = $2`; the `LoanDrawn` arm of `LIST_KNOWN_LOANS_SQL` keeps `= $3`; terms and margin-event insert/select include the new columns.
- **Regression:** `cargo test -p shared`, `cargo test -p pipeline_worker` (or the crate's package name) and `cargo test -p api` must all pass. The `stellar_security_registry_*` and `loan_security` / `loan_book_security` tests must pass unchanged apart from struct-literal field additions.

## Docs to Update

- **`docs/references/security-registry-events.md`**: retitle to "SecurityRegistry events and projection (Stellar and EVM)" and keep every Stellar section as is. Add an "EVM" section with these anchors:
  - `#evm-configuration`: the three keys, the pairing and collision rules, dark when unset, `verify_wiring`.
  - `#evm-event-table`: Solidity event → stored name → params, with the `DocAdded.hash → sha256` note and the allow-listed topics.
  - `#evm-units`: 6 dp raw amounts, PAR `1000000`, ids, EIP-55 addresses.
  - `#evm-sync-loop`: pinned reads at `cursor − 1`, the lag gate, selector-based "not found", the Reader for valuation, two emitters (`log_contracts`).
  - `#evm-terms-and-default-breach`: the three columns and the margin-event kinds.
  - `#evm-cursor`: rewind to the deploy block; full history available.

  Update "Projection tables" for the new columns and kinds. In "Known limitations", note that the current-state-read limitation is Stellar-only.
- **`docs/references/backend.md`**: a new "EVM SecurityRegistry indexing" subsection next to "Stellar SecurityRegistry indexing". The line-440 loan-book note stays (EVM `null` until #1940).
- **`docs/references/index.md`**: update the entry title and description.
- **`.env.example`**: the three keys (step 7).
- **`ARCHITECTURE.md:64`**: "SecurityRegistry … events (Stellar and EVM)".
- **`docs/exec-plans/tech-debt-tracker.md`**:
  - amend TD-171 so it applies to Stellar only (EVM reads are pinned);
  - add an entry if `KeyedBackoff` / `spawn_supervised` stay under `indexer/stellar/` while serving EVM;
  - add an entry noting that `security_marks.rs` / the API assume 7 dp (handed to #1940/#1942).
- **Product specs:** none in this issue. `docs/product-specs/loan-security-state.md` ("Scope is Stellar only", 7-dp encoding) changes with #1940, which serves the data.
