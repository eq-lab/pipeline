# Issue #1938: EVM SecurityRegistry indexer: records, terms, marks, margin calls, inspections (SecurityRegistry + RecordNft)

Source: https://github.com/eq-lab/pipeline/issues/1938

Parent epic: #1937 (EVM parity). Stellar counterpart: epic #1775 / #1779 (`packages/worker/src/indexer/stellar/security_registry_*.rs`, spec `docs/references/security-registry-events.md`, plan `docs/exec-plans/completed/issue-1779-stellar-security-registry-indexer.md`). Runs in parallel with #1939 (EVM AccessManager indexer). Blocks #1940 (API `/security` and loan-book LTV fields for EVM). No Figma reference, so there is no visual verification step.

Contracts are frozen: `pipeline-contracts@150631a`, Hoodi `deployments/hoodi-v5.json`:

- `PipelineSecurityRegistry` proxy `0xB51E7f13420D106946376A67Fe5921C63B09BE15` (`src/securityRegistry/SecurityRegistryUpgradeable.sol`).
- `PipelineSecurityRecordNft` proxy `0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09` (`src/PipelineSecurityRecordNft.sol`).
- `PipelineSecurityRegistryReader` `0x8e7078c73068F9F3d4e2210cfe5B4981eB7f1b6B` (`src/PipelineSecurityRegistryReader.sol`, non-upgradeable; its constructor takes `recordNft` from the registry).

## Scope

**Guiding rule (human, 2026-11-17): the EVM indexer is the Stellar indexer.** The architecture, data flow, tables, fold, sync loop, view reads, config pattern, test layout and docs structure are the same as the merged Stellar implementation. Where Stellar code can serve both chains it is generalized and shared, not copied. Every remaining difference is listed in "Differences from Stellar" with its contract-level reason.

### The Stellar design this issue reuses (from `origin/main`)

- **Three layers, no RPC in `index_once`.**
  1. The index path parses logs into `contract_logs` rows under `Security…` names.
  2. A supervised `security-registry-sync` task runs four best-effort steps every 30 s: snapshot, projection, state and valuation.
  3. The pure fold `shared::security_registry::fold_loan` turns rows and snapshots into the ten projection tables.
- **View reads happen at the chain head, and their height is recorded.**
  - Stellar records `simulateTransaction.latestLedger` as `as_of_ledger`.
  - A snapshot is held in memory until the cursor passes that height (`hold` / `release_ready`). The fold then applies only the events after it.
  - Reads are skipped while the cursor is more than 20 behind the head (`SNAPSHOT_MAX_LAG`).
  - Discovery probes ids from 1 and stops at the contract's "not found".
- **Valuation reads the contract's coverage view.**
  - `coverage_detail(loan_id)` and `loan_money(loan_id)` are two reads, each at the head and each with its own height (`detail_ledger`, `money_ledger`).
  - Both are upserted into `security_loan_valuations`.
  - A loan is due on a newer registry or loan-registry log row, or every 5 min while its debt is above 0.
  - A mismatch between the configured and the on-chain loan registry is warned once per process. There is no startup check.
- **Config.**
  - One optional key. Blank means dark.
  - A set key is validated by the chain's address parser, and an error names the key.
  - The key joins the chain's distinct-role check as `SECURITY_REGISTRY_ADDRESS`.
  - The worker logs "Stellar SecurityRegistry indexer enabled".
- **Parser API.**
  - `SECURITY_REGISTRY_EVENT_TOPICS`, `SECURITY_REGISTRY_ALLOW_LISTED_TOPICS`, `SecurityTopic` / `classify_security_topic`, `parse_security_event` and `dispatch_security_registry`.
  - The warn texts are "…failed to decode; dropped" and "…emitted an unrecognised topic; dropped".
  - The legacy CollateralRegistry parser warns once when it sees a SecurityRegistry-only topic (`warn_if_security_registry_topic`).
  - SecurityRegistry events are routed before the generic parsers.
- **Tests.**
  - Worker: `stellar_security_registry_{config,parsers,replay,sync,views}.rs` plus a `stellar_security_support/` helper module.
  - Shared: `security_registry_fold.rs`, `security_registry_repo_sql.rs` and `migration_security_registry.rs`. All are pure.
- **Docs.**
  - `docs/references/security-registry-events.md`, with sections Configuration, Encoding rules, Event table, Allow-listed topics, State without its own event, Projection tables, Sync loop, Cursor and retention, Known limitations.
  - The "Stellar SecurityRegistry indexing" section in `backend.md`.
  - The user story `docs/user-stories/epic-1775/1779-stellar-security-registry-indexer.md` and its row in `docs/user-stories/index.md`.

### In scope

1. **Shared sync core.** The Stellar sync loop, the `SecurityViewSource` trait, `TimeoutSource` and the supervisor move to chain-neutral modules. The old Stellar paths re-export them. Stellar behaviour is unchanged.
2. **EVM parsers** with the Stellar parser API: the 22 Stellar-equivalent events plus the three EVM-only `DefaultBreach*` events, all under `Security…` names.
3. **EVM view source.** It implements the same trait with the same read timing: the head, with the height recorded.
4. **EVM config and wiring.** It follows the Stellar pattern: dark when unset, validated keys, joins the distinct-role check, the same task name and the same log line.
5. **Additive migration and fold changes** for the EVM-only `Terms` fields, the `DefaultBreach*` history and the coverage view's `defaultBreachAt`. The fold's par mark becomes a chain parameter.
6. **Docs and tests in the Stellar layout**, plus a user story for the epic #1937 QA pass.

### Out of scope

- **The API (#1940):** `/security`, the loan-book `ltv_bps` / `margin_call_open` / `price_stale`, how the API passes the RecordNft address, audit-log rendering of `SecurityDefaultBreach*`, and decimals-aware formatting.
- **Other issues:** Trustee (#1942), AccessManager (#1939, #1941), and any contract or deploy-script change (#1944).
- **Mark suggestions.** `security_marks.rs` assumes 7 dp. A tech-debt entry hands this to #1940 / #1942.
- **Stage and prod env values, and the Hoodi cursor rewind.** These are ops steps of the epic's merge order. They are documented here but not applied.

## Decisions (human, 2026-11-17)

**Directive (2026-11-17, overrides earlier plan choices): "Everything must be done the same way as on Stellar — one and the same approach."** Deviate only where the EVM contracts make the Stellar mechanism impossible or meaningless, and justify each deviation in "Differences from Stellar".

Earlier answers (same day), and how the directive amends them:

1. **Valuation as on Stellar.** Read the contract coverage view, never recompute in Rust. On EVM that view is `PipelineSecurityRegistryReader.coverageDetail(loanId)`. *Amended:*
   - The read path is identical to Stellar's: same step, same due rule, same table and same fields, with each read at the head and its own height.
   - The Reader key is **no longer optional**. On Stellar valuation always runs when the indexer runs, so the Reader key joins the registry and RecordNft keys as one group.
2. **Amount units:** raw on-chain units (6 dp on EVM), as Stellar stores raw 7 dp. Unchanged.
3. **RecordNft events:** stored under the RecordNft's own address. Unchanged. *Amended:* worker queries take the chain's list of log addresses (`[registry]` on Stellar, `[registry, nft]` on EVM), so the fold receives one event stream exactly as on Stellar.
4. **EVM-only `Terms` fields and the `DefaultBreach*` events:** kept in nullable columns that stay `NULL` on Stellar. Unchanged. *Amended:* the coverage view's `defaultBreachAt` also gets a nullable valuation column, because the valuation row mirrors the coverage view field by field.
5. **Partial config fails boot.** Unchanged, extended to three keys: all set or all unset. *Amended:* the address parse and the distinct-role check follow the Stellar pattern and wording (step 7).

Earlier plan choices that the directive **changes**:

| Earlier plan | Now | Why |
|---|---|---|
| `eth_call` pinned to `cursor − 1` through a `begin_cycle` hook | Every view read is at the head (`latest − LOG_CONFIRMATIONS_DELAY`), with that block named in the call and returned as the height. Snapshots wait in `hold` / `release_ready` exactly as on Stellar. | Stellar reads at the head and records the height. It does not pin to the cursor. |
| `max_lag = LOG_CONFIRMATIONS_DELAY + 20` | `SNAPSHOT_MAX_LAG = 20`, unchanged, measured against the source's head | Making the head confirmation-aware keeps the Stellar constant. |
| `coverageDetail` and `loanMoney` read at one shared block | Two reads, each at its own head, as on Stellar. TD-171's one-ledger skew now covers EVM too. | Same timing as Stellar. |
| Startup `verify_wiring` (registry, RecordNft and Reader point at each other) | Dropped | Stellar has no startup cross-check. Its only check is the once-per-process loan-registry mismatch warn, which is kept. |
| Optional Reader key; `valuation_enabled()` | Required as part of the key group; no `valuation_enabled()` | Stellar always runs valuation. |
| Record snapshot = `registry.record(id)` + `nft.details(id)` | One read: `Reader.record(id)`, which returns `{record, details}` | It is the single-call equivalent of Stellar's `record(id)`. |
| `SecurityRegistryPaused` params `{"account": …}` | `{}` | Stellar stores `{}`. |
| Collision wording `… must not equal …` | Stellar's: `… duplicates another configured contract address; each role must point at a distinct contract` | Aligns the wording with Stellar. |
| Task name `evm-security-registry-sync` | `security-registry-sync` (chain id in the span) | Same name as Stellar. |
| File names `security_registry_evm_{parsers,views}.rs` | `indexer/security_registry_{parsers,views}.rs` next to `indexer/stellar/security_registry_{parsers,views}.rs` | Follows the existing EVM/Stellar pair convention (`collateral_registry_parsers.rs`, `loan_registry_reader.rs`). |
| No legacy-CR trap warn | The EVM CollateralRegistry parser warns once on a SecurityRegistry-only topic0 | Stellar does this. |
| Security handler in any position | Registered first in `register_evm_handlers` | Stellar routes SecurityRegistry events before `dispatch_parser`. |
| No user story | `docs/user-stories/epic-1937/1938-evm-security-registry-indexer.md` | Stellar #1779 has one. |
| A separate "EVM" doc section with its own anchors | EVM notes inside each existing section, under the same anchors | Same docs structure. |

## Differences from Stellar

Everything not listed here is identical, and shared or mirrored file for file.

| # | Area | Stellar | EVM | Contract-level reason |
|---|---|---|---|---|
| D1 | Emitters and config keys | One contract, one key `…_SECURITY_REGISTRY_ADDRESS` | Three keys, all or none: `…_SECURITY_REGISTRY_ADDRESS`, `…_SECURITY_RECORD_NFT_ADDRESS`, `…_SECURITY_REGISTRY_READER_ADDRESS`. Partial config fails boot and names the missing key. | The EVM splits Stellar's single contract in three: the registry emits 21 topics; `PipelineSecurityRecordNft` emits `DocAdded`, `InspectionRecorded`, `InspectionApproved` and `InspectorsSet` and holds `inspection` / `inspectors` / record `details`; the coverage and combined record views exist only on the Reader. |
| D2 | `contract_logs.contract_address` of RecordNft events | Registry id | RecordNft address. Worker queries use `contract_address = ANY(log_contracts)`, with `[registry]` on Stellar and `[registry, nft]` on EVM. Projection tables stay keyed by the registry. | Different emitter (D1). The human chose to keep each emitter's own address. |
| D3 | View height | `simulateTransaction` returns `latestLedger` | The source reads `eth_blockNumber − LOG_CONFIRMATIONS_DELAY`, names that block in the `eth_call` and returns it | `eth_call` does not report the block it ran on, so the source must name it to know the height. The confirmation offset makes the source's head equal the EVM indexer's head (Stellar's indexer uses delay 0 because ledgers are final at close). |
| D4 | "Not found" in discovery and `terms` | `Error(Contract, #1 / #14 / #25)` in the message | 4-byte selectors of `SecurityRegistryNonExistentRecord()`, `SecurityRegistryNoTerms()` and `SecurityRecordNftNonExistentInspection()` in the revert data | Solidity custom errors instead of Soroban error codes. The sync core asks the source (`is_missing_record` / `is_missing_inspection`) instead of matching Stellar text. |
| D5 | Event decoding | Table of field names over self-describing ScVal maps | `sol!` events and positional ABI decoding, with the same stored names and params | ABI logs are positional and typed; Soroban event values are maps keyed by field name. |
| D6 | Amount scale and par mark | Raw 7 dp; register marks USD at `10000000` | Raw 6 dp; register marks USD at `1000000` (`PAR_VALUE = 1_000_000`) | Contract constants. The fold takes the par as a chain parameter. |
| D7 | Id width | `u32` | `uint256`. Kept on the `u32` plumbing: views error on ids above `u32::MAX`; the repo reads ids as `bigint` (SQL cast) and drops values above `u32::MAX` from the result lists (a stored id at or above 2^63 would fail the cast and the cycle would retry); parsers store the decimal string verbatim. | ABI type. On-chain ids are counters from 0 or 1, so the bound is theoretical. |
| D8 | Address text | Strkey `G…` / `C…` | EIP-55, matching `ContractLogMapper`; the configured `LOAN_REGISTRY_ADDRESS` is checksummed before comparing | Chain address format. |
| D9 | `Terms` | 12 fields | Plus `defaultRatioBps`, `originatorFeeRate` and `defaultBreachAt`, stored in nullable columns (`NULL` on Stellar) | Present only in the EVM `Terms` struct. |
| D10 | Margin-call history | `open` / `price_stale` / `cured` | Plus `default_breach`, `default_breach_price_stale` and `default_breach_cleared`, with a nullable `default_ratio_bps` | The `DefaultBreach`, `DefaultBreachPriceStale` and `DefaultBreachCleared` events exist only on EVM. |
| D11 | Coverage view | `coverage_detail` on the registry; `cure_by` u64 | `coverageDetail` on the Reader, plus `defaultBreachAt` (nullable valuation column); `cureBy` is uint256 and stored as `NUMERIC` like the rest | The Reader is the only contract with the view. `defaultBreachAt` is EVM-only. |
| D12 | Allow-listed topics | `mint`, `burn`, `ownership_*` | RecordNft ERC-721 `Transfer` / `Approval` / `ApprovalForAll`, `SecurityRegistrySet`; on both contracts `Initialized`, `Upgraded` and `AuthorityUpdated` | Different administrative events. Same rule: dropped silently, and any other topic is warned and dropped. |
| D13 | Address filter in the handler | Routing by contract id in the poller's if/else | The handler checks `log.address()` (registry or NFT) | EVM handlers receive every log ("first match wins"). Two topic0s collide with the legacy EVM CollateralRegistry (`Revalued`, `DocAdded`), and the RecordNft's ERC-721 `Transfer` shares topic0 with ERC-20 `Transfer`. |
| D14 | Distinct-role check location | `StellarIndexerSettings::from_chain_env` | `run_indexer_job` (`core_roles`), with the same error wording | The EVM chain's existing distinct-role check lives in `mod.rs`, because the core EVM addresses are parsed there. This is not a contract reason, but the check is the same check on the same roles. |
| D15 | Cursor and backfill | Rewind only within Soroban RPC retention; beyond it, seed from views | Rewind to the deploy block always works (`eth_getLogs` keeps full history); view seeding still covers an un-rewound start | RPC retention, not contract behaviour. The mechanism is identical. |

Not differences: loan id 0 (both chains), the snapshot `kind` set, ordering by `(block_number, log_index)` (EVM `log_index` is block-global, so registry and NFT events order correctly), the fold rules in "State without its own event" (EVM `_activate`, `_addEvidence` and `mint` do the same; a handover copies the mark on equal `unit` and `commodityHash`), the lot latest-inspection rule, the enum variant names and order, and hashes as lowercase hex without `0x`.

## Assumptions and Risks

- **Shared code, unchanged Stellar behaviour.** The Stellar loop is moved, not rewritten. The only Stellar-visible changes are:
  - repo methods take `log_contracts` (Stellar passes `[contract_id]`, so the SQL result is the same);
  - the trait gains three methods (`latest_ledger`, `is_missing_record`, `is_missing_inspection`), so the Stellar test fakes `Fake` and `Hang` gain three one-line impls with no assertion changes;
  - the fold takes `&STELLAR_SECURITY_PARAMS`.

  `SECURITY_PROJECTION_VERSION` stays 1, because Stellar output is byte-identical.
- **A missed `ANY(...)` loses RecordNft events** (docs, inspections, inspectors). The SQL-text tests in `shared/tests/security_registry_repo_sql.rs` pin every worker-side `contract_logs` filter.
- **Misconfigured RecordNft or Reader key.** With no startup cross-check (as on Stellar), a wrong RecordNft address means no NFT events, and a wrong Reader means failing `coverageDetail` reads, which back off and warn per loan.
  - Mitigation: `.env.example` carries the Hoodi values from `deployments/hoodi-v5.json`, and the user story checks `security_registry_state.inspectors` and a valuation row.
  - A `registry.loanRegistry()` mismatch is warned exactly as on Stellar.
- **Reorgs.** Reads at `latest − LOG_CONFIRMATIONS_DELAY` and the hold-until-cursor rule make a snapshot as safe as an indexed log. A reorg deeper than the delay breaks both equally.
- **Non-archive RPCs** keep about 128 recent states. Reads target `latest − delay` (12 by default), so they are always within range.
- **Valuation skew (TD-171) now also covers EVM.** `coverageDetail` and `loanMoney` are two reads that can be a block apart (a few seconds of interest), while `ltv_bps` / `coverage_bps` come from one read. This is accepted to keep Stellar's read timing.
- **`details(recordId)` / `Reader.record(id)` revert `SecurityRegistryNoTerms` for a record of a loan without terms.** `register` requires terms (`_loanTerms`), so this cannot happen on-chain. If it did, it would surface as an ordinary read failure with backoff.
- **Revert data shape.** alloy 0.8.3 exposes it through `RpcError::ErrorResp(ErrorPayload)`. Some RPCs put the hex in `message`. The selector helper accepts both and is unit-tested on constructed payloads.
- **Address and hash formats.** `contract_logs.contract_address` is EIP-55. Every address the loop compares or stores is checksummed: the three keys, `LOAN_REGISTRY_ADDRESS` (kept as the raw env string by `IndexerJobSettings`), `loanRegistry()`, `inspectors()` and event address params. A lowercase env value would otherwise make `list_known_loans` and `list_valuation_candidates` miss every `LoanDrawn` row.
- **Cursor and backfill.** Rewinding the EVM chain cursor to the SecurityRegistry deploy block backfills full history. Replays dedupe on `(chain_id, contract_address, block_number, log_index)`, and every EVM handler dedupes through `is_duplicate`. Without a rewind, discovery seeds the current state from views (`complete = false`), as on Stellar.
- **Parallel work with #1939.** Both issues touch `indexer/config.rs`, `indexer/mod.rs`, `evm_parsers.rs`, `.env.example`, `backend.md`, `docs/user-stories/index.md` (the "Epic #1937" table) and possibly `stellar/supervise.rs`.
  - #1939 reads the same `SECURITY_REGISTRY_ADDRESS` / `SECURITY_RECORD_NFT_ADDRESS` keys. Whichever PR merges second rebases onto one parsed `EvmSecurityRegistry` struct.
  - The all-or-none rule means an ops env that sets the registry and NFT keys for #1939 must also set the Reader key once #1938 deploys.
  - Re-check the migration version against `main` before the PR (latest on `main`: `20261117000001`).
- **API compile impact.** New fields on `TermsRow`, `TermsView`, `MarginCallEventRow`, `CoverageDetailView` and `ValuationRow` require struct-literal updates in `packages/api` and its tests, or `..Default::default()`. API behaviour does not change.
  - The audit log already lists `Security*` rows by name and formats amounts per `ChainKind`, so EVM security rows appear there with correct 6 dp amounts once the key is set. This is expected.
  - `SecurityDefaultBreach*` are not in its allow-list (#1940).

## Open Questions

_None_ (the 2026-11-17 directive settles every choice above; see Decisions and Differences from Stellar).

## Implementation Steps

### 1. Migration (additive)

Add `packages/shared/migrations/20261118000001_security_registry_evm.sql`, with the header comment style and rollback note of `20261106000001_security_registry.sql`. Re-check the version against `main` and #1939 before the PR.

```sql
ALTER TABLE security_terms
    ADD COLUMN IF NOT EXISTS default_ratio_bps   BIGINT  NULL,
    ADD COLUMN IF NOT EXISTS originator_fee_rate BIGINT  NULL,
    ADD COLUMN IF NOT EXISTS default_breach_at   NUMERIC NULL;
ALTER TABLE security_margin_call_events
    ADD COLUMN IF NOT EXISTS default_ratio_bps BIGINT NULL;
ALTER TABLE security_loan_valuations
    ADD COLUMN IF NOT EXISTS default_breach_at NUMERIC NULL;
```

The snapshot `kind` CHECK and every key are unchanged.

### 2. Fold — `packages/shared/src/security_registry.rs`

- **Event names.** Add `pub const SECURITY_EVM_ONLY_EVENT_NAMES: [&str; 3] = ["SecurityDefaultBreach", "SecurityDefaultBreachPriceStale", "SecurityDefaultBreachCleared"]`. Append them to `SECURITY_LOAN_EVENT_NAMES` (length 21), so the repo's name filters pick them up.
- **Chain parameter for the par mark.**
  ```rust
  pub struct SecurityChainParams { pub par_value_per_unit: &'static str }
  pub const STELLAR_SECURITY_PARAMS: SecurityChainParams = SecurityChainParams { par_value_per_unit: "10000000" };
  pub const EVM_SECURITY_PARAMS: SecurityChainParams = SecurityChainParams { par_value_per_unit: "1000000" };
  ```
  `fold_loan` / `fold_loan_report` take `params: &SecurityChainParams` and thread it to the register par mark (today `dec(PAR_VALUE_PER_UNIT)`). Keep `PAR_VALUE_PER_UNIT` only if another caller needs it, as an alias of the Stellar value.
- **`TermsView`.** Add `#[serde(default)]` `default_ratio_bps: Option<u32>`, `originator_fee_rate: Option<u32>` and `default_breach_at: Option<String>`. Stored Stellar snapshot JSON still deserializes.
- **`TermsRow`.** Add `default_ratio_bps: Option<i64>`, `originator_fee_rate: Option<i64>` and `default_breach_at: Option<BigDecimal>`. `terms_from_view` / `terms_from_params` read them optionally (absent or unparsable → `None`) and never fail the row on them.
- **`CoverageDetailView` / `ValuationRow`.** Add `#[serde(default)] default_breach_at: Option<String>` and `default_breach_at: Option<BigDecimal>`. `valuation_row` maps it through.
- **`MarginCallEventRow`.** Add `default_ratio_bps: Option<i64>`. In `fold_loan_report`, alongside the existing margin-call arms:
  - `SecurityDefaultBreach` → kind `default_breach` (`ltv_bps`, `default_ratio_bps`). When `after(terms_v, ev)`, set `terms.default_breach_at = ts(ev)`.
  - `SecurityDefaultBreachPriceStale` → kind `default_breach_price_stale`. Terms are unchanged.
  - `SecurityDefaultBreachCleared` → kind `default_breach_cleared`. When `after(terms_v, ev)`, set `terms.default_breach_at = 0`.
  - Missing params → `warn_skip`, counted in `skipped`.

  This mirrors how `SecurityMarginCall` / `SecurityMarginCallCured` drive `margin_call_at`. On a Stellar terms row with `default_breach_at = None` the arms never fire, because the events never occur.
- **Do not bump `SECURITY_PROJECTION_VERSION`.**

### 3. Repo — `packages/shared/src/security_registry_repo.rs`

- **Worker-side `contract_logs` filters** move from `contract_address = $2` to `contract_address = ANY($k)`, and the methods gain `log_contracts: &[String]`. Projection-table filters stay `contract_address = $2` (the registry). The affected queries are:
  - `LIST_LOAN_EVENTS_SQL`, `LIST_CONTRACT_EVENTS_SQL` and `MAX_LOG_ID_SQL`;
  - the `contract_logs` halves of `LIST_DIRTY_LOANS_SQL`, `LIST_ALL_LOANS_SQL` and `LIST_KNOWN_LOANS_SQL`, but not the `LoanDrawn` arm, which stays `= $3` (the configured loan registry);
  - `LIST_RECORD_EVENT_LEDGERS_SQL` (both arms), `LIST_INSPECTION_IDS_SQL`, `LIST_LOANS_WITH_TERMS_EVENT_SQL` and `LIST_RECORD_LOANS_SQL`.

  `LIST_VALUATION_CANDIDATES_SQL` already takes `ANY($3)`.
- **API-side queries stay as they are** (`LOAN_LOG_WATERMARKS_SQL`, `LIST_SALE_REPAYMENTS_SQL`, `load_loan_security`). They belong to #1940.
- **New columns.**
  - `INSERT_TERMS_SQL` / `GET_TERMS_SQL` add the three terms columns.
  - `INSERT_MARGIN_EVENT_SQL` / `LIST_MARGIN_EVENTS_FOR_LOAN_SQL` add `default_ratio_bps`.
  - `UPSERT_VALUATION_SQL` / `GET_VALUATION_SQL` add `default_breach_at`.
  - Update the binds in `replace_loan_projection` and `upsert_valuation`.

### 4. Shared sync core (worker), moved out of `indexer/stellar/`

Moves are verbatim apart from the generalizations below. The old paths keep `pub use` re-exports, so `stellar/poller.rs`, `stellar/access_manager_sync.rs` and the existing tests keep compiling.

- **`packages/worker/src/indexer/supervise.rs`** is moved from `stellar/supervise.rs` (`KeyedBackoff`, `spawn_supervised`, delays). `stellar/supervise.rs` becomes `pub use crate::indexer::supervise::*;`. Keep the header `// spec: docs/references/security-registry-events.md#sync-loop`.
- **`packages/worker/src/indexer/security_registry_sync.rs`** is the chain-neutral core:
  - **Moved here.** The whole body of `stellar/security_registry_sync.rs` (constants, `SnapshotKind`, `SnapshotWrite`, `SnapshotNeeds`, `read_snapshots`, `discover_*`, `hold`, `release_ready`, `read_valuation`, `SnapshotSink`, `flush_snapshots`, `TimeoutSource`, `run_step` and the four steps). Also `SecurityViewSource` and `contract_view` from `stellar/security_registry_views.rs`, and `SecurityTopic` from `stellar/security_registry_parsers.rs`, which is re-exported there.
  - **Trait additions:** `async fn latest_ledger(&self) -> Result<u64>`, `fn is_missing_record(&self, e: &anyhow::Error) -> bool` and `fn is_missing_inspection(&self, e: &anyhow::Error) -> bool`. `TimeoutSource` forwards them; `latest_ledger` goes through `limited`.
  - **`SyncCtx<S: SecurityViewSource>`.**
    - It drops `rpc: Arc<StellarRpc>` and adds `log_contracts: Vec<String>` and `params: &'static SecurityChainParams`.
    - `snapshot_step` uses `ctx.source.latest_ledger()` in the unchanged `SNAPSHOT_MAX_LAG` gate.
    - `discover_records` / `discover_inspections` use `source.is_missing_record(&e)` / `source.is_missing_inspection(&e)` instead of `is_contract_error(.., NO_*_CODE)`.
    - Every repo call passes `&ctx.log_contracts`.
    - `valuation_step` builds its dirtiness list as `log_contracts ++ [loan_registry]`.
    - `project_loan` passes `ctx.params`.
  - **Entry point:** `pub async fn run_security_sync_loop<S: SecurityViewSource + 'static>(source: S, repo, events, chain_id, contract_id, log_contracts, configured_loan_registry, params) -> Result<()>`.
- **`stellar/security_registry_sync.rs`** keeps `pub use crate::indexer::security_registry_sync::*;` and `run_security_registry_sync_loop(rpc, repo, events, chain_id, contract_id, configured_loan_registry)`, with the same signature as today. It calls the core with `RpcSecurityViewSource::new(rpc, contract_id.clone())`, `log_contracts = vec![contract_id.clone()]` and `&STELLAR_SECURITY_PARAMS`.
- **`stellar/security_registry_views.rs`** keeps the Stellar decoders, `is_contract_error`, `NO_*_CODE` and `RpcSecurityViewSource`, and re-exports `SecurityViewSource` / `contract_view`. `RpcSecurityViewSource` implements:
  - `latest_ledger` as `self.rpc.get_latest_ledger()`;
  - `is_missing_record` / `is_missing_inspection` as `is_contract_error(&e.to_string(), NO_RECORD_CODE / NO_INSPECTION_CODE)`.
- **Stellar callers of the fold** pass `&STELLAR_SECURITY_PARAMS`.

### 5. EVM parsers — new `packages/worker/src/indexer/security_registry_parsers.rs`

Header: `// spec: docs/references/security-registry-events.md#event-table`. The public API mirrors `stellar/security_registry_parsers.rs`:

- **`sol!` events.**
  - Copy them verbatim from `SecurityRegistryUpgradeable.sol:30-54` and `PipelineSecurityRecordNft.sol:25-45`, plus OZ `Paused(address)` / `Unpaused(address)`.
  - Declare enums as `uint8`; topic0 is unaffected.
  - Copy the 15-field `Terms` struct from `ISecurityRegistry.sol:79-95`.
- **`pub enum SecurityEmitter { Registry, RecordNft }`.**
- **`pub const SECURITY_REGISTRY_EVENT_TOPICS: [(SecurityEmitter, B256, &str); 25]`.** It holds the 22 Stellar-equivalent stored names and the three `SecurityDefaultBreach*`, each built from `SIGNATURE_HASH`. Also add `SECURITY_REGISTRY_ALLOW_LISTED_TOPICS` (D12).
- **`classify_security_topic(emitter, topic0) -> SecurityTopic`** (the shared enum), `parse_security_event(log, emitter) -> Option<ContractLog>`, and `dispatch_security_registry(log, registry, nft) -> Option<ContractLog>`.
  - Dispatch picks the emitter from `log.address()` and returns `None` for any other address.
  - A stored topic that fails to decode → `warn!("SecurityRegistry event failed to decode; dropped")`.
  - An allow-listed topic → silent `None`.
  - An unknown topic → `warn!("SecurityRegistry emitted an unrecognised topic; dropped")`.
  - The warn fields are `contract_address`, `topic0` and `tx_hash`.
- **Stored params are exactly the Stellar table's** (`docs/references/security-registry-events.md#event-table`):
  - snake_case keys;
  - ids as decimal strings (`U256::to_string()`);
  - bps and the `i32` variances as JSON numbers;
  - `u64` times and `uint256` amounts as decimal strings;
  - hashes as lowercase hex without `0x`;
  - addresses EIP-55;
  - enums as variant names, through explicit ordinal → name tables with `"Unknown"` out of range: `protection_name`, `unit_name`, `record_status_name`, `payment_term_name`, `flag_outcome_name`, `control_kind_name`, `perfection_name`, `doc_kind_name` (the 13 RecordNft variants, not the legacy CR table) and `inspection_kind_name`;
  - `benchmark` through `collateral_registry_parsers::benchmark_string`.

  Specifics:
  - `DocAdded.hash` is stored under **`sha256`**.
  - `TermsSet` flattens the 12 Stellar keys, plus `default_ratio_bps` and `originator_fee_rate` (numbers) and `default_breach_at` (string).
  - `MarginCall.cure_by` is a string.
  - `Paused` / `Unpaused` → `SecurityRegistryPaused` / `SecurityRegistryUnpaused` with `{}`.
  - `LoanRegistrySet` → `SecurityLoanRegistrySet` `{loan_registry}`.
  - `InspectorsSet` → `SecurityInspectorsSet` `{inspectors: [EIP-55…]}`.
  - `DefaultBreach*` → `{loan_id, ltv_bps[, default_ratio_bps]}`.
- **`pub fn warn_if_security_registry_topic(log: &Log)`.** A once-per-process warn (`AtomicBool`) when a log carries a topic0 that only the SecurityRegistry or RecordNft emits. It excludes the shared `Revalued` / `DocAdded` topic0s and `Paused` / `Unpaused`. The text matches Stellar's, naming `CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS`. Call it from `collateral_registry_parsers::parse_collateral_registry_log` when nothing parsed, as the Stellar legacy dispatcher does.
- **`pub fn reject_security_collision(chain_id, label, addr, roles: &[(&str, Address)]) -> Result<()>`.** It uses Stellar's wording: `CHAIN_{chain_id}_EVM_INDEXER_{label} ({addr}) duplicates another configured contract address; each role must point at a distinct contract`.

### 6. EVM view source — new `packages/worker/src/indexer/security_registry_views.rs`

Header: `// spec: docs/references/security-registry-events.md#sync-loop`. It mirrors `stellar/security_registry_views.rs`: pure decoders, then one source struct.

- **`sol!` interface subsets.**
  - Reader: `record(uint256)` (returns `RecordView{Record record; RecordDetails details}`) and `coverageDetail(uint256)`.
  - Registry: `terms`, `extensionConsents`, `paused` and `loanRegistry`.
  - RecordNft: `inspection` and `inspectors`.
  - LoanRegistry: `loanMoney`.
  - Custom errors: `SecurityRegistryNonExistentRecord()`, `SecurityRegistryNoTerms()` and `SecurityRecordNftNonExistentInspection()`.
- **Pure decoders** with the Stellar names, so tests need no RPC:
  - `decode_record(reader_record_ret) -> RecordView`. `hasMark` → `Some(MarkView)`; `attestedBy == 0` → `None`; `control.ref` → `control_reference`; `commodityHash` is dropped. Ids go `U256 → u32`, with an error when out of range.
  - `decode_inspection` (`approvedBy == 0` → `None`).
  - `decode_terms` (with the three extras).
  - `decode_coverage_detail` (`defaultBreachAt` → `default_breach_at`).
  - `decode_loan_money`, `decode_inspectors` (EIP-55), `decode_consents` (hex without `0x`) and `decode_address` (EIP-55).
  - `revert_selector(&anyhow::Error) -> Option<[u8; 4]>`. It walks the chain to the alloy `RpcError`, reads the revert data from the `ErrorPayload`, and accepts `data` as a hex string or nested JSON.
- **`EvmSecurityViewSource { provider, registry, nft, reader, confirmations }`** implements `SecurityViewSource`. The provider is built like `LoanRegistryReader::new`.
  - `latest_ledger()` = `get_block_number().saturating_sub(confirmations)`.
  - Every view method first takes `at = self.latest_ledger()`, calls with `.block(BlockId::number(at))` and returns `(view, at)`. This is the EVM form of Stellar's `(value, sim.latest_ledger)` (D3).
  - `record(id)` reads `Reader.record(id)`.
  - `inspection(id)` and `inspectors()` read the RecordNft.
  - `terms(id)` reads the registry and returns `Ok((None, at))` on the `NoTerms` selector, as Stellar returns `(None, before)` on `#14`.
  - `extension_consents`, `paused` and `loan_registry` read the registry.
  - `coverage_detail(id)` reads the Reader.
  - `loan_money(registry, id)` calls the given LoanRegistry.
  - `is_missing_record` / `is_missing_inspection` match the selectors through `revert_selector`.

### 7. EVM config and wiring

- **`indexer/config.rs`.**
  - Add `pub security_registry: Option<EvmSecurityRegistry>` to `IndexerJobSettings`, where `pub struct EvmSecurityRegistry { pub registry: Address, pub record_nft: Address, pub reader: Address }`.
  - Parse `{ip}SECURITY_REGISTRY_ADDRESS`, `{ip}SECURITY_RECORD_NFT_ADDRESS` and `{ip}SECURITY_REGISTRY_READER_ADDRESS` with `env_nonblank` + `parse_evm_address`. That is the EVM chain's address validator, the counterpart of Stellar's `validate_contract_id` + Strkey parse, and its error names the key.
  - All three blank → `None`. All three set → `Some`.
  - Any other combination bails: `CHAIN_{id}_EVM_INDEXER_{missing} must be set when CHAIN_{id}_EVM_INDEXER_{present} is set; the SecurityRegistry, RecordNft and Reader keys are set together`. The error names the first missing key.
- **`indexer/mod.rs` `run_indexer_job`.**
  - Right after the CollateralRegistry roles are added to `core_roles`, and before the deal-token, asset and PLUSD checks, so those checks also cover the new roles: call `reject_security_collision` for `SECURITY_REGISTRY_ADDRESS`, `SECURITY_RECORD_NFT_ADDRESS` and `SECURITY_REGISTRY_READER_ADDRESS`, each against `core_roles` and the ones pushed before it, then push them.
  - Log `tracing::info!(chain_id, security_registry = %registry, record_nft = %nft, reader = %reader, "EVM SecurityRegistry indexer enabled")`.
  - Spawn `let _security_guard = spawn_supervised("security-registry-sync", chain_id, move || run_security_sync_loop(EvmSecurityViewSource::new(..), SecurityRegistryRepo::new(pool.clone()), EventRepo::new(pool.clone()), chain_id, registry.to_checksum(None), vec![registry.to_checksum(None), nft.to_checksum(None)], Some(loan_registry.to_checksum(None)), &EVM_SECURITY_PARAMS))` before `index_loop`, and keep the guard alive across it, as Stellar's `_security_guard` is.
- **`indexer/evm_parsers.rs`.**
  - Add `security_registry: Option<(Address, Address)>` (registry, nft) to `EvmContractAddresses`.
  - When it is `Some`, register `add_event_handler(vec![registry, nft], move |log| dispatch_security_registry(log, registry, nft).map(ContractLogMapper::new(..)))` **first**, before the DepositManager handler.
  - When it is `None`, register no handler and add no addresses.
- **`.env.example`.** Add the three keys after `…_PLUSD_ADDRESS` in the EVM block: optional, dark while unset, set together, with the Hoodi values and the cursor-rewind hint in a comment.
- **`scripts/check-chain-env-names.sh`.** No change is needed (it lists only retired names); confirm it passes.

### 8. User story

Add `docs/user-stories/epic-1937/1938-evm-security-registry-indexer.md`, mirroring the seven stories of `epic-1775/1779-stellar-security-registry-indexer.md` with EVM values (Hoodi, chain id from `.env.example`):

1. The keys are set and the indexer is enabled. This includes the partial-config and collision boot failures, and that the tables stay empty when unset.
2. The SecurityRegistry address set as `…_COLLATERAL_REGISTRY_ADDRESS` is flagged once.
3. A loan's security flow is stored and projected, including the RecordNft `SecurityDocAdded` rows under the RecordNft address.
4. Margin call, cure, default breach and valuation.
5. Inspections and the lot's latest inspection.
6. Keys set after the first writes are seeded from views; a cursor rewind backfills everything.
7. A failing view read does not stall indexing.

Add an "Epic #1937" table with this row to `docs/user-stories/index.md`, or append the row if #1939 adds the table first.

### 9. Clean-up and lint

- Comment-less code rule: one spec-pointer header per new file and nothing else.
- Run `cargo fmt`, `cargo clippy --all -- -D warnings`, `scripts/check-chain-env-names.sh` and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests live in `packages/<pkg>/tests/*.rs`. They are pure: no DB access, and nothing reads `DATABASE_URL` or `POSTGRES_URL`. EVM logs and call returns are built in-process with alloy (`SolEvent::encode_log_data`, `SolCall::abi_encode_returns`). The file layout mirrors Stellar's file for file, with helpers in a new `packages/worker/tests/evm_security_support/mod.rs` (log and return builders, Hoodi addresses), the counterpart of `stellar_security_support/`.

- **`packages/worker/tests/evm_security_registry_config.rs`** (counterpart of `stellar_security_registry_config.rs`; distinct chain ids per test, setup/teardown pattern):
  - all three unset or blank → `None`; all three set → `Some`;
  - each partial combination → `Err` naming the missing key;
  - a malformed address → `Err` naming the key;
  - `reject_security_collision` rejects equality with each core role and between the three keys, with the Stellar wording.
- **`packages/worker/tests/evm_security_registry_parsers.rs`** (counterpart of `stellar_security_registry_parsers.rs`):
  - one case per stored event (21 registry + 4 RecordNft), asserting `event_name` and the exact `params` JSON. That covers `DocAdded.hash → sha256`, the flattened `TermsSet` with the three extras, `"PAR"` benchmark, EIP-55 addresses, hashes without `0x`, and `Paused` → `{}`;
  - the same log from a third address → `None`;
  - every allow-listed topic → `None`;
  - an unknown topic0 → `None`;
  - truncated data for a known topic → `None`;
  - an id above `u32::MAX` is stored verbatim;
  - every enum name table, including `"Unknown"`;
  - `topic_table_matches_the_shared_names`: every topic name is a security event, and every `SECURITY_LOAN_EVENT_NAMES` / `SECURITY_CONTRACT_EVENT_NAMES` entry has an EVM topic;
  - no duplicate topic0;
  - none of the 25 topic0s is decoded by the unfiltered DM / WQ / sPLUSD / LoanRegistry parsers;
  - `warn_if_security_registry_topic` returns without panicking on shared and unrelated topic0s;
  - `the_index_path_is_a_pure_synchronous_function`.
- **`packages/worker/tests/evm_security_registry_views.rs`** (counterpart of `stellar_security_registry_views.rs`):
  - `decode_record` with and without a mark, attested and unattested, and with an id above `u32::MAX` → `Err`;
  - `decode_inspection` (approved and unapproved);
  - `decode_terms` with the extras;
  - `decode_coverage_detail` (`coverage_bps = u32::MAX` at zero debt; `default_breach_at` mapped);
  - `decode_loan_money`, `decode_inspectors`, `decode_consents`;
  - `revert_selector` on constructed `ErrorPayload`s: data as a hex string, data in the message, missing data, and a non-revert error;
  - selector classification for the three errors against an unrelated selector.
- **`packages/worker/tests/evm_security_registry_replay.rs`** (counterpart of `stellar_security_registry_replay.rs`). Parse the main-flow sequence of EVM logs through `dispatch_security_registry` into `SecurityEventRow`s and run `fold_loan(.., &EVM_SECURITY_PARAMS)`.
  - The flow: `TermsSet` → `RecordRegistered` (USD, then goods) → `RecordPerfected` → RecordNft `DocAdded` → `InspectionRecorded` / `InspectionApproved(flagged)` → `FlagResolved(Accepted)` → `Revalued` → `MarginCall` → `DefaultBreach` → `DefaultBreachCleared` → `MarginCallCured` → `RecordReleased`.
  - Mirror the Stellar cases that apply: main flow with and without snapshots, the handover mark copy, the USD par mark, and the flag flows.
  - Assert:
    - the USD par mark is `1000000`;
    - doc provenance (`register` / `perfection` / `event`);
    - `flagged_by` set and cleared;
    - the lot's latest inspection;
    - `terms.default_breach_at` (the event timestamp, then `0`);
    - margin events with the new kinds and `default_ratio_bps`;
    - `skipped == 0`.
- **`packages/worker/tests/evm_security_registry_sync.rs`** (counterpart of `stellar_security_registry_sync.rs`). It uses a fake `SecurityViewSource` whose `is_missing_*` match a fake selector error:
  - discovery stops on the source's missing-record and missing-inspection classification, and does not mistake other errors for the end;
  - snapshots read at height `H` are released only once the cursor is above `H`;
  - `read_valuation` combines both views with their own heights and maps `default_breach_at`;
  - `TimeoutSource` forwards `latest_ledger` and both classifiers, and times out a hanging `latest_ledger`.
- **Stellar regression.**
  - `stellar_security_registry_sync.rs`: `Fake` / `Hang` gain `latest_ledger`, `is_missing_record` and `is_missing_inspection` (the latter two through `is_contract_error`), with no assertion changes.
  - `stellar_security_registry_parsers.rs::topic_table_matches_the_shared_names` skips `SECURITY_EVM_ONLY_EVENT_NAMES`.
  - Every other `stellar_security_registry_*`, `stellar_supervise.rs` and `stellar_access_manager_*` test passes unchanged.
- **`packages/shared/tests/security_registry_fold.rs`** (extend):
  - the Stellar par stays `10000000` with `STELLAR_SECURITY_PARAMS`;
  - the EVM par is `1000000`;
  - a `DefaultBreach` at or below the loan snapshot's `terms_ledger` does not overwrite `default_breach_at`, and one after it does;
  - `DefaultBreachPriceStale` leaves terms untouched;
  - `TermsSet` without the extras → `None` fields, and with them → parsed;
  - `TermsView` / `CoverageDetailView` JSON without the extras still deserializes;
  - `event_name_lists_are_complete_and_disjoint` is updated to 21 and checks that `SECURITY_EVM_ONLY_EVENT_NAMES ⊂ SECURITY_LOAN_EVENT_NAMES`.
- **`packages/shared/tests/security_registry_repo_sql.rs`** (extend):
  - every worker-side `contract_logs` read uses `contract_address = ANY(`;
  - projection tables still use `contract_address = $2`;
  - the `LoanDrawn` arm of `LIST_KNOWN_LOANS_SQL` keeps `= $3`;
  - the terms, margin-event and valuation insert/select statements include the new columns.
- **`packages/shared/tests/migration_security_registry_evm.rs`** (new, counterpart of `migration_security_registry.rs`). Using `include_str!` text assertions, it checks that the five `ADD COLUMN IF NOT EXISTS` clauses are present with nullable types, and that there is no `DROP`, `NOT NULL` or CHECK change.
- **Full regression:** `cargo test -p shared`, `cargo test -p pipeline-worker` and `cargo test -p api`. API tests change only struct literals.

## Docs to Update

- **`docs/references/security-registry-events.md`.** Retitle it "SecurityRegistry events and projection (Stellar and EVM)" and keep every section and anchor. In each section, add the EVM counterpart next to the Stellar text instead of a separate EVM chapter:
  - **Intro:** the EVM source of truth (`pipeline-contracts@150631a`, the three Hoodi addresses), and a short "Differences from Stellar" table (D1 to D15 in brief).
  - **Configuration:** the three EVM keys, all or none, the distinct-role check, and the log line.
  - **Encoding rules:** 6 dp raw amounts, `uint256` ids as decimal strings, EIP-55 addresses, `bytes32` benchmark text.
  - **Event table:** an EVM table (Solidity event, emitter, stored name, params notes). It notes `DocAdded.hash → sha256`, the `TermsSet` extras and the three `SecurityDefaultBreach*` events.
  - **Allow-listed topics:** the EVM list, and the EVM legacy-CR trap warn.
  - **State without its own event:** the EVM par `1000000`; everything else is "same on EVM".
  - **Projection tables:** the new nullable columns and margin-event kinds.
  - **Sync loop:**
    - the shared core, and the source-reported head (`latest − LOG_CONFIRMATIONS_DELAY` on EVM);
    - selector-based "not found";
    - `Reader.record` / `Reader.coverageDetail`;
    - two emitters through `log_contracts`.
  - **Cursor and retention:** an EVM rewind to the deploy block backfills full history.
  - **Known limitations:** the current-state limitation is worded for both chains; the two-read valuation skew applies to both.
- **`docs/references/backend.md`.** Add an "EVM SecurityRegistry indexing" subsection after "Stellar SecurityRegistry indexing", with the same paragraph shape (keys, dark default, distinct-role check, stored events, tables, sync task, API pointer to #1940, link to the spec). The loan-book `ltv_bps` note (line 439) stays (EVM `null` until #1940).
- **`docs/references/index.md`:** update the entry title and description to "(Stellar and EVM)".
- **`ARCHITECTURE.md:64`:** "SecurityRegistry record / terms / inspection / margin-call events (Stellar and EVM)".
- **`.env.example`:** the three keys (step 7).
- **`docs/user-stories/epic-1937/1938-evm-security-registry-indexer.md`** and **`docs/user-stories/index.md`** (step 8).
- **`docs/exec-plans/tech-debt-tracker.md`.**
  - Amend TD-171: its location is now the shared `indexer/security_registry_sync.rs`. Pinning is a Stellar RPC limit, but the two-read valuation skew applies to both chains by design (each read is at its own head).
  - Add an entry: `security_marks.rs` and the API assume 7 dp for marks; EVM needs 6 dp (hand-off to #1940 / #1942).
- **Product specs:** none in this issue. `docs/product-specs/loan-security-state.md` ("Scope is Stellar only", 7 dp encoding) changes with #1940, which serves the data.
