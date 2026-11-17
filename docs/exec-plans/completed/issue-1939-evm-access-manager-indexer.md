# Issue #1939: EVM AccessManager indexer: scheduled / canceled / executed operations with calldata

Source: https://github.com/eq-lab/pipeline/issues/1939

Parent epic: #1937, merge-order step 1 (in parallel with #1938). #1941 (API `pending_operations` for EVM) reads
what this issue writes. The Stellar counterpart is #1921 (with the #1927 key fix). Contracts are frozen.

**Revision 2026-11-17 (human directive).** The EVM indexer mirrors the merged Stellar implementation (epic #1920:
#1921 + #1927) one-to-one. That covers architecture, data flow, tables, SQL, close rules, config, test layout and
docs structure. Every remaining deviation is listed in [Differences from Stellar](#differences-from-stellar), with
the chain-level reason for each.

## Scope

### Source of truth (checked by the planner on 2026-11-17)

- **Contracts:** `pipeline-contracts@150631a`.
  - `lib/openzeppelin-contracts/contracts/access/manager/AccessManager.sol`, stock OpenZeppelin, deployed plain
    (`script/deployers/DeployAccessManager.sol:17`: `new AccessManager(accessManagerAdmin)`, no subclass):
    - `schedule(target, data, when)` (:441) emits
      `OperationScheduled(bytes32 indexed operationId, uint32 indexed nonce, uint48 schedule, address caller, address target, bytes data)` (:472).
      `schedule` is the resolved timepoint (`max(when, now + setback)`). `setback` is always > 0, and
      `data.length >= 4` (`_checkSelector`).
    - `cancel` (:528) emits `OperationCanceled(bytes32 indexed operationId, uint32 indexed nonce)` (:545).
    - `_consumeScheduledOp` (:564) emits `OperationExecuted(bytes32 indexed operationId, uint32 indexed nonce)` (:577).
      Two paths reach it, and both emit from the AccessManager:
      - `AccessManager.execute`, which consumes only when a schedule exists or the caller has a delay;
      - a target's `restricted` modifier through `consumeScheduledOp`, when the target is called directly.

      Immediate calls emit nothing.
    - `hashOperation = keccak256(abi.encode(caller, target, data))` (:583).
    - `expiration()` (:159) is `return 1 weeks;`, a compile-time constant (604 800 s), as Stellar's `EXPIRATION` is.
    - The nonce is stored in `_schedules[id].nonce`, which is persistent. Cancel and execute keep the nonce. A
      re-schedule uses `nonce + 1`, and is allowed only once the previous schedule is closed or expired.
    - Other events, allow-listed below: `RoleLabel`, `RoleGranted`, `RoleRevoked`, `RoleAdminChanged`,
      `RoleGuardianChanged`, `RoleGrantDelayChanged`, `TargetClosed`, `TargetFunctionRoleUpdated`,
      `TargetAdminDelayUpdated` (`IAccessManager.sol:32-76`).
  - Targets (all ids `uint256`):
    - `src/PipelineLoanRegistry.sol`: `setDefault(uint256)`, `cure(uint256)`, `amendEconomics(uint256,uint32,uint64)`,
      `adjustInterest(uint256,int256,bytes32)`, `writeDown(uint256,uint256)`, `closeDefaulted(uint256,uint8)`, plus the
      Trustee and protocol functions (`drawLoan`, `updateMutable`, `disburse`, `undisburse`, `recordPayment`,
      `unrecordPayment`, `rollover`, `closeLoan`, setters, `pause`, `unpause`).
    - `src/minter/MinterUpgradeable.sol`: `reverseRepay(uint256 loanId, uint256 repaymentId, bytes32 refHash)` (:341),
      `reverseDisburse(uint256 loanId, uint256 amount, bytes32 refHash, uint256 originalId)` (:275), plus the other
      `restricted` functions.
    - `src/securityRegistry/SecurityRegistryUpgradeable.sol`: `setTerms(uint256 loanId, Terms)` (:303),
      `releaseWithConsent(uint256 recordId, bytes32)` (:264), `resolveFlag(uint256 recordId, FlagOutcome, bytes32)` (:271),
      plus the agent, valuer and trustee functions. `Terms` (`src/interfaces/ISecurityRegistry.sol:79`) has 15 fields.
    - `src/PipelineSecurityRecordNft.sol`: `setInspectors(address[])` (:205), `addDoc`, `recordInspection`,
      `approveInspection`, `setSecurityRegistry`.
  - Roles: `script/roles/*.sol`. All Hoodi delays are 0 (`script/base/ChainValues.sol`), so nothing is scheduled on
    Hoodi until #1944.
  - Hoodi (`deployments/hoodi-v5.json`): AccessManager `0x3dF345BF5fd3ecB1F8E031B450Ceb2BF7B645992`,
    LoanRegistry `0xdF08fdf0f47272a8Ced33A5f913f6C9D179B0231`, Minter `0x621BaAb0ced6b11f88019582183b081A118755f4`,
    SecurityRegistry `0xB51E7f13420D106946376A67Fe5921C63B09BE15`, RecordNft `0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09`.
- **Selectors and topics** (from `cast sig` / `cast keccak`; tests pin them):

  | Signature | Value |
  |---|---|
  | `OperationScheduled(bytes32,uint32,uint48,address,address,bytes)` | `0x82a2da5dee54ea8021c6545b4444620291e07ee83be6dd57edb175062715f3b4` |
  | `OperationExecuted(bytes32,uint32)` | `0x76a2a46953689d4861a5d3f6ed883ad7e6af674a21f8e162707159fc9dde614d` |
  | `OperationCanceled(bytes32,uint32)` | `0xbd9ac67a6e2f6463b80927326310338bcbb4bdb7936ce1365ea3e01067e7b9f7` |
  | `RoleLabel(uint64,string)` | `0x1256f5b5ecb89caec12db449738f2fbcd1ba5806cf38f35413f4e5c15bf6a450` |
  | `RoleGranted(uint64,address,uint32,uint48,bool)` | `0xf98448b987f1428e0e230e1f3c6e2ce15b5693eaf31827fbd0b1ec4b424ae7cf` |
  | `RoleRevoked(uint64,address)` | `0xf229baa593af28c41b1d16b748cd7688f0c83aaf92d4be41c44005defe84c166` |
  | `RoleAdminChanged(uint64,uint64)` | `0x1fd6dd7631312dfac2205b52913f99de03b4d7e381d5d27d3dbfe0713e6e6340` |
  | `RoleGuardianChanged(uint64,uint64)` | `0x7a8059630b897b5de4c08ade69f8b90c3ead1f8596d62d10b6c4d14a0afb4ae2` |
  | `RoleGrantDelayChanged(uint64,uint32,uint48)` | `0xfeb69018ee8b8fd50ea86348f1267d07673379f72cffdeccec63853ee8ce8b48` |
  | `TargetClosed(address,bool)` | `0x90d4e7bb7e5d933792b3562e1741306f8be94837e1348dacef9b6f1df56eb138` |
  | `TargetFunctionRoleUpdated(address,bytes4,uint64)` | `0x9ea6790c7dadfd01c9f8b9762b3682607af2c7e79e05a9f9fdf5580dde949151` |
  | `TargetAdminDelayUpdated(address,uint32,uint48)` | `0xa56b76017453f399ec2327ba00375dbfb1fd070ff854341ad6191e6a2e2de19c` |
  | `setDefault(uint256)` | `0xe0da6b66` |
  | `cure(uint256)` | `0xb7e5262a` |
  | `amendEconomics(uint256,uint32,uint64)` | `0x00b14774` |
  | `adjustInterest(uint256,int256,bytes32)` | `0x6d10dec4` |
  | `writeDown(uint256,uint256)` | `0x5bd45aa1` |
  | `closeDefaulted(uint256,uint8)` | `0x7892936e` |
  | `reverseRepay(uint256,uint256,bytes32)` | `0x0cff7536` |
  | `reverseDisburse(uint256,uint256,bytes32,uint256)` | `0x68b77843` |
  | `releaseWithConsent(uint256,bytes32)` | `0x115f901f` |
  | `resolveFlag(uint256,uint8,bytes32)` | `0xdf84b5b3` |
  | `setInspectors(address[])` | `0xa84489a4` |
  | `setTerms(uint256,(uint32,uint32,uint32,uint64,uint64,uint8,uint64,uint32,uint32,uint64,uint64,uint32,uint32,uint64,uint64))` | `0x45f225f5`. Re-check with `forge inspect SecurityRegistryUpgradeable methodIdentifiers` after `forge build`; the local `out/` is stale. |

- **The Stellar implementation this mirrors** (`origin/main`):
  - `packages/worker/src/indexer/stellar/access_manager_parsers.rs`: event decode into `contract_logs` rows
    (`dispatch_access_manager`), the typed param readers (`ScheduledRow`, `CanceledRow`, `ExecutedRow`),
    `hash_operation`, `args_display_json`, `TargetIds` and `loan_ref`.
  - `.../stellar/access_manager_sync.rs`: the supervised `access-manager-sync` loop.
    - Store and transaction source: `AmSyncStore`, `RepoStore`, `TxEnvelopeSource`.
    - Per-row resolve: `resolve_schedule`, `resolve_execute`, `resolve_row`.
    - Loop: `sync_once` with `KeyedBackoff<i64>`, then `run_cycle` with a 60 s budget and a panic guard, then
      `run_access_manager_sync_loop`, which sleeps 15 s when fewer than 200 rows were applied.
  - `.../stellar/poller.rs`: the AccessManager id is added to the `getEvents` filter. `dispatch_access_manager`
    feeds a plain log mapper. The `info` line "Stellar AccessManager indexer enabled" is logged, and
    `spawn_supervised("access-manager-sync", …)` is called with
    `TargetIds { loan_registry, minter, security_registry }`.
  - `.../indexer/config.rs`: optional `CHAIN_<id>_STELLAR_INDEXER_ACCESS_MANAGER_ADDRESS`. Blank means unset. A bad
    Strkey is an error naming the key. The key joins the distinct-role check as `ACCESS_MANAGER_ADDRESS`.
  - `packages/shared/src/access_manager_repo.rs`:
    - names and constants: `OP_EVENT_*`, `EXPIRATION_SECS = 604_800`, `NewScheduledOp::expires_at()`, `OpWrite`;
    - watermark and row reads: `GET_WATERMARK_SQL`, `LIST_ROWS_AFTER_SQL`, `ADVANCE_WATERMARK_SQL`;
    - projection writes: `INSERT_SCHEDULED_SQL` (`ON CONFLICT … DO NOTHING`), `MARK_CANCELED_SQL`,
      `MARK_EXECUTED_SQL`;
    - lookups: `HAS_PENDING_CALL_SQL`, `RECORD_LOAN_SQL`, `LIST_PENDING_LOAN_OPS_SQL`;
    - `AccessManagerRepo::apply`, which writes one row's change and advances the watermark in one transaction.
  - Migrations `20261116000001_access_manager_operations.sql` and `20261117000001_access_manager_operations_schedule_key.sql`
    create the table, the watermark table `access_manager_sync_state`, and the key
    `UNIQUE (chain_id, contract_address, operation_id, schedule_ledger, nonce)`.
  - Tests:
    - worker: `packages/worker/tests/stellar_access_manager_{parsers,hash,sync,loan_ref,config}.rs` and
      `stellar_access_manager_support/mod.rs` (`MemStore` emulates the SQL, `FakeTx` stands in for the RPC);
    - shared: `packages/shared/tests/access_manager_{projection,pending}_sql.rs` and
      `migration_access_manager_schedule_key.rs`.
  - Docs: `docs/references/access-manager-events.md`.
  - **Record → loan, as on Stellar:**
    - `resolve_schedule` runs `RECORD_LOAN_SQL` when the schedule is projected. It tries `security_records`, then
      the `SecurityRecordRegistered` rows of `contract_logs`, then `security_view_snapshots`.
    - On a miss, `loan_id` stays `NULL` and `record_id` is kept.
    - The fallback ("backfill") is the read-time `COALESCE(o.loan_id, <same lookup>)` in
      `LIST_PENDING_LOAN_OPS_SQL`. **No write-side backfill job exists**, and the EVM path adds none.
- **The EVM indexer today.** The code is in `packages/worker/src/indexer/{mod.rs,evm_parsers.rs,config.rs,poller.rs}`.
  - `index_once` writes every mapper of a block range, in `(block, log_index)` order (`sort_logs`), in one database
    transaction together with the cursor.
  - Optional contracts are wired through `register_*_handler`, which wraps `ContractLogMapper`. Their collision
    checks sit in `run_indexer_job`; see `plusd_transfers.rs`.
  - `run_indexer_job` spawns the supervised `evm-security-registry-sync` task from #1938 and imports the chain-neutral
    `crate::indexer::supervise` (#1938 moved it from `stellar/supervise.rs`, which re-exports it).
- **#1938, the parallel sibling** (`origin/feat/1938-evm-security-registry-indexer`, plan only). This plan aligns
  with it:
  - Config: `IndexerJobSettings.security_registry: Option<EvmSecurityRegistryConfig { registry, record_nft,
    reader }>` from `CHAIN_<id>_EVM_INDEXER_SECURITY_{REGISTRY,RECORD_NFT,REGISTRY_READER}_ADDRESS`.
  - Format: EIP-55 `contract_address`, and `SecurityRecordRegistered` params `loan_id` / `record_id` as decimal
    strings, so `RECORD_LOAN_SQL` reads EVM records unchanged.
  - Structure: chain-neutral sync code moves out of `indexer/stellar/` with re-exports; `supervise.rs` is already at
    `indexer/supervise.rs`.
  - Migration `20261118000001_security_registry_evm.sql`.

### Decisions (planner; mirror Stellar)

1. **Same data flow as Stellar: raw rows in `index_once`, projection in a supervised sync loop.**
   - `index_once` gets a plain `ContractLogMapper` for each AccessManager operation log, as on Stellar.
   - A supervised `access-manager-sync` task reads the AccessManager rows past its own watermark
     (`access_manager_sync_state`, keyed `(chain_id, EIP-55 AccessManager address)`). It writes
     `access_manager_operations` through the same `AccessManagerRepo::apply`, which applies one row and advances the
     watermark in one transaction.
   - The loop, the 15 s interval, the 200-row batch, the 60 s budget, the panic guard, `KeyedBackoff<i64>` and
     `spawn_supervised` are **shared code**, not a twin. The chain-neutral parts of
     `stellar/access_manager_sync.rs` move to `indexer/access_manager_sync.rs` (the #1938 pattern, with
     re-exports). Each chain supplies only a row resolver, the step that turns one `AmLogRow` into an `OpWrite`.
2. **Same `contract_logs` names**: `AccessManagerOperationScheduled`, `AccessManagerOperationCanceled` and
   `AccessManagerOperationExecuted` (`OP_EVENT_*`). Params use Stellar's keys and formats, with only the fields the
   EVM event carries:
   - Scheduled: `{operation_id, caller, nonce, when, target, data}`. The OpenZeppelin `schedule` field is stored
     under Stellar's key `when`. `data` is the event's calldata as `0x` + lowercase hex.
   - Canceled: `{operation_id, nonce}`, identical to Stellar.
   - Executed: `{operation_id, nonce}`.

   Formats: `operation_id` is 64 lowercase hex without `0x`, as on Stellar. `nonce` and `when` are decimal strings,
   as on Stellar. `caller` and `target` are EIP-55, the EVM `contract_logs` address convention.
   - **Decoding is in the sync loop, not the parser**, as on Stellar. The parser only decodes the event. The
     resolver derives `function`, `args_json` and the loan reference, and verifies the operation id.
3. **Same close rules and the same SQL.**
   - A cancel uses `MARK_CANCELED_SQL`: it closes the newest schedule of the `operation_id` logged before the cancel,
     only if that row is `pending` and its `nonce` matches.
   - An execute uses `MARK_EXECUTED_SQL` with `ids = [operation_id]`: newest schedule before it, only if `pending`.
   - Both run unchanged. No new close SQL is added.
   - On EVM, the newest schedule before a close is always the one the close refers to: the nonce never resets, a
     re-schedule needs the previous one closed or expired, and indexing is contiguous. So the Stellar rule gives the
     same result as an exact `(operation_id, nonce)` match. This overrides the issue text "Close the row by
     `(operation_id, nonce)`", per the directive.
4. **Same args model: a native encoding plus `args_json`.**
   - Stellar keeps `args_xdr` (base64 `ScVal::Vec`, the `args` argument of `schedule` exactly as invoked). The EVM
     equivalent is a new nullable column **`calldata`**: `0x` + lowercase hex, holding the `data` argument of
     `schedule` exactly as invoked (selector + ABI-encoded arguments). That is what `execute(target, data)` and
     `cancel(caller, target, data)` need, and #1941 already names the DTO field `calldata`.
   - A named CHECK `access_manager_operations_one_args_encoding` (`args_xdr IS NULL OR calldata IS NULL`) keeps the
     two exclusive.
   - `args_xdr`, the Stellar rows and `LIST_PENDING_LOAN_OPS_SQL` (which requires `args_xdr IS NOT NULL`) stay
     unchanged, so EVM rows are not served until #1941.
5. **Same "never guess" rule for the operation id.** The resolver recomputes
   `keccak256(abi.encode(caller, target, data))`:
   - Equal: `calldata`, `function`, `args_json`, `loan_id` and `record_id` are filled.
   - Different: the row is stored with `calldata`, `args_json`, `loan_id` and `record_id` all `NULL`, and a `warn`.
     That is exactly Stellar's no-candidate case. A mismatch cannot happen on the stock contract.
6. **`function` and `args_json`.** `function` is the contract's native function name, as on Stellar.
   - Stellar stores the `Symbol` from the event (snake_case). EVM stores the Solidity name (camelCase), decoded
     from the selector with the ABI of the configured target (LoanRegistry, Minter, SecurityRegistry, RecordNft).
   - If the selector is unknown, or the target is not one of the four (including the AccessManager itself):
     `function` = `0x` + 8 lowercase hex, `args_json = NULL`, and `calldata` is kept.
   - If the selector is known but the arguments fail to decode: `function` = the name, `args_json = NULL`, `warn`.
   - `args_json` is a positional JSON array, display only, following Stellar's `args_display_json` rules:
     - `uint8`–`uint32` and `int8`–`int32`, enums included, are numbers. This matches Stellar's `u32` / `i32`.
     - Wider integers are decimal strings.
     - `bool` stays a boolean.
     - `address` is EIP-55.
     - `bytes` / `bytesN` are lowercase hex without `0x`, as Stellar's bytes are.
     - `string` stays a string, and arrays are arrays.
     - Tuples are objects keyed by the Solidity component names, as Stellar's `Symbol`-keyed maps are. For example,
       `setTerms` → `["7", {"advanceRatioBps": 7000, …, "defaultBreachAt": "0"}]`.
7. **Loan scoping**: Stellar's `loan_ref` table with EVM targets and names, resolved by the sync loop when the row is
   projected, only when the id verified.

   | Target | Function | `loan_id` / `record_id` |
   |---|---|---|
   | LoanRegistry | `setDefault`, `cure`, `amendEconomics`, `adjustInterest`, `writeDown`, `closeDefaulted` | arg 0 is the loan id |
   | Minter | `reverseRepay` | arg 0 is the loan id (as Stellar `reverse_repay`; `reverseDisburse` is decoded but not loan-scoped, as Stellar `reverse_disburse`) |
   | SecurityRegistry | `setTerms` | arg 0 is the loan id |
   | SecurityRegistry | `releaseWithConsent`, `resolveFlag` | arg 0 is `record_id`; `loan_id` looked up |
   | anything else | `setInspectors` (RecordNft), other functions, unknown selectors, unconfigured targets | both `NULL` |

   The shared `LoanRef` (`Loan(u32)`, `Record(u32)`, `None`) is reused. A `uint256` arg 0 above `u32::MAX` gives
   `None` with a `warn`. This is the EVM counterpart of Stellar's "non-`u32` first arg", and #1938 keeps the same
   `u32` id plumbing.
8. **Record → loan: the Stellar code path.** The shared helper calls `AmSyncStore::record_loan(security_registry,
   record_id)`, which runs `RECORD_LOAN_SQL`, with the SecurityRegistry's EIP-55 address. A miss leaves `loan_id`
   `NULL` and keeps `record_id`. The API resolves it later at read time (`LIST_PENDING_LOAN_OPS_SQL`, #1941). There
   is no RPC in the sync loop and no RPC in `index_once`.
9. **`expires_at = ready_at + EXPIRATION_SECS` (604 800)**, through the unchanged `NewScheduledOp::expires_at()`.
   - Stellar uses the contract constant `EXPIRATION`. The EVM contract's `expiration()` is the compile-time constant
     `1 weeks` on the deployed stock `AccessManager`, so the closest equivalent is the same constant.
   - No `eth_call` at boot and no fallback. The issue text "reading `expiration()` once" is superseded, per the
     directive.
10. **Config: the Stellar pattern.**
    - New optional `CHAIN_<id>_EVM_INDEXER_ACCESS_MANAGER_ADDRESS`: blank means unset, an invalid address is a
      startup error naming the key, and unset ships dark (no handler, no task, the worker boots as before).
    - The address must differ from every other indexer contract key. On EVM that check lives in `run_indexer_job`
      as `reject_access_manager_collision`, next to `reject_plusd_collision`. That is EVM's equivalent of Stellar's
      distinct-role loop.
    - Set: log `info` "EVM AccessManager indexer enabled" with the chain id and address, and spawn the supervised
      `access-manager-sync` task.
    - Targets come from the existing required keys (`LOAN_REGISTRY_ADDRESS`, `MINTER_ADDRESS`) and from #1938's
      `security_registry.{registry, record_nft}`. An unset SecurityRegistry config leaves `loan_id` `NULL` for those
      operations, and the row is still stored, as on Stellar.

### Out of scope

- The API (`pending_operations` for EVM, the `calldata` DTO field, `target_kind` for EVM): #1941. The product spec
  `loan-security-state.md#pending-operations` keeps saying "EVM chains: empty array", which stays true.
- The Trustee and wallet-connect (#1942, #1943); AccessManager role events; role changes on Hoodi (#1944).
- Stage / prod deploy config (epic merge-order step 3).
- Any change to Stellar behaviour or Stellar rows. Moving the chain-neutral code is a refactor with re-exports, and
  every Stellar test must pass unchanged, apart from the test-support move in step 9.
- Decoding the AccessManager's own admin functions (`grantRole`, …) when scheduled against itself. They are stored
  with `function = 0x<selector>`.

## Differences from Stellar

Every remaining difference, with the chain-level reason. Anything not listed here is identical: table, watermark,
loop, constants, backoff, supervision, close SQL, insert SQL, record lookup, `expires_at` and the read query.

| # | Area | Stellar (#1921 / #1927) | EVM (#1939) | Chain-level reason |
|---|---|---|---|---|
| 1 | Where args come from | The sync loop fetches `getTransaction` and recovers `schedule` args from the envelope and auth trees (`TxEnvelopeSource`, `contract_invocations`, per-cycle tx cache). | From the raw row's `data` param. No RPC in the resolver, and nothing is ever retried for RPC reasons. | OpenZeppelin `OperationScheduled` carries the full calldata. The Soroban event carries no args. |
| 2 | Scheduled raw-row params | `{operation_id, caller, nonce, when, target, function}` | `{operation_id, caller, nonce, when, target, data}`. `function` is derived in the sync loop. | The EVM event has no function name, only the selector inside `data`. |
| 3 | Executed raw-row params | `{target, function, caller}` | `{operation_id, nonce}` | OpenZeppelin emits `OperationExecuted(operationId, nonce)`. Soroban emits `operation_executed(target, function, caller)`. |
| 4 | Execute resolution | `has_pending_call` gate, then a transaction fetch, then re-hash of `execute` candidates, giving `ids`. | `ids = [operation_id]` straight from the row. Same `OpWrite::Execute` and same `MARK_EXECUTED_SQL`. The event's `nonce` is not used, as on Stellar's execute. With contiguous indexing, the newest schedule before the execute carries that nonce. | The EVM event names the operation. The Soroban event names only the call triple. |
| 5 | When an execute event fires | For every `execute`, including immediate ones, which explains Stellar's "immediate execute marks a matching pending schedule `executed`" limitation (TD-187). | Only when a schedule is consumed, through `AccessManager.execute` or a direct target call (`consumeScheduledOp`). The Stellar limitation and the "sub-call without an auth entry" limitations do not exist on EVM. | `_consumeScheduledOp` is the only emitter. |
| 6 | Operation id | `sha256(XDR(Map{args, caller, function, target}))`, used to **select** the args among candidates | `keccak256(abi.encode(caller, target, data))`, used to **verify** the event's own `data`. On a mismatch the outcome is the same: stored without args, with a `warn`. | Different hash preimage per contract. |
| 7 | Native args column | `args_xdr`: base64 `ScVal::Vec(args)` | `calldata`: `0x` + lowercase hex of the whole `data`, selector included. A CHECK makes `args_xdr` and `calldata` exclusive. | Different native call encodings. An EVM `execute` takes the full `data`. |
| 8 | `function` value | Event `Symbol`, snake_case, always present | Solidity name (camelCase) decoded via the target's ABI. An unknown selector or unconfigured target gives `0x<selector>` with `args_json = NULL`. | ABI calldata is not self-describing; XDR is. Both store the contract's native name. |
| 9 | `args_json` type mapping | XDR types: `u32`/`i32` numbers, 64-bit+ strings, Strkeys, `Symbol`-keyed maps as objects, enums as `Vec[Symbol]` | ABI types: `≤32`-bit ints numbers, wider strings, EIP-55, tuples as objects by component name, enums as their `uint8` ordinal | Different type systems; the same display rules otherwise. |
| 10 | Loan id width | First arg must be `ScVal::U32` | First arg is `uint256`. Values above `u32::MAX` give `LoanRef::None` with a `warn`. | Solidity ids are `uint256`. |
| 12 | Nonce | Resets to 1 after the temporary entry lapses. #1927 made the key `(…, schedule_ledger, nonce)` and the close rule "newest before". | Never resets. The same key and rule apply with no EVM-specific code. | Persistent `_schedules[id].nonce`. |
| 13 | Formats | Strkeys, tx hash 64 hex, `schedule_ledger` = ledger | EIP-55, tx hash `0x…` (the EVM `contract_logs` convention), `schedule_ledger` = block number | Per-chain `contract_logs` conventions. |
| 14 | Allow-listed events | 8 snake_case topics | 9 OpenZeppelin topic0 values (`Role*`, `Target*`) | Different event sets. |
| 15 | Config validation site | `StellarIndexerSettings::from_chain_env` distinct-role loop | Parse in `IndexerJobSettings::from_chain_env`, collision check in `run_indexer_job` (`reject_access_manager_collision`) | The EVM indexer checks optional-key collisions in `run_indexer_job` (PLUSD, asset, DTF, #1938). |
| 16 | Retention and re-projection | RPC retention of about 7 days: never truncate the table, and a rewind is bounded by `oldestLedger` (TD-187). | No log retention. The table can be rebuilt without loss: delete the chain's AccessManager rows, reset the watermark, and the raw rows still hold the calldata. A rewind can go back to the AccessManager deploy block. | `eth_getLogs` keeps full history. |

## Assumptions and Risks

- **Nothing is scheduled on Hoodi** until #1944 lands, so there is no live data. Verification uses synthetic rows,
  plus golden logs captured once from a local Anvil AccessManager with a delayed role (step 10).
- **Parallel work with #1938.** Both issues touch `indexer/config.rs`, `indexer/mod.rs`, `.env.example` and
  `backend.md`. Expect trivial rebase conflicts.
  - Config: #1939 reads `settings.security_registry` (#1938's struct). If #1939 merges first, it adds
    `EvmSecurityRegistryConfig` and its parsing **exactly as #1938's plan specifies**: the same names, the same three
    keys and the same pairing errors (#1938 Decision 5). It adds no handler and no task; #1938 then rebases onto it.
  - Migration: #1938 takes `20261118000001`, so #1939 uses `20261118000002`. Re-check `main` and the #1938 branch
    before the PR.
  - `RECORD_LOAN_SQL` finds an EVM record only once #1938 projects `security_records` (EIP-55 registry address) or
    stores `SecurityRecordRegistered` with decimal-string `loan_id` / `record_id`; #1938's plan does both. Until
    then, `loan_id` stays `NULL` with `record_id` kept, and the read side resolves it later, as on Stellar.
- **Refactor safety.** Chain-neutral items move out of `indexer/stellar/` with `pub use` re-exports at the old paths.
  Every Stellar test (`stellar_access_manager_*.rs`) must compile and pass unchanged; the only exception is the
  support-module split in step 9.
- **`supervise.rs` is at `indexer/supervise.rs`.** #1938 moved it there with a re-export at the old Stellar path, so
  the EVM tasks import it directly and no tech-debt entry is needed.
- **Address case.** The sync loop's `contract_id` must be `am.to_checksum(None)`, exactly what `ContractLogMapper`
  writes. Otherwise `LIST_ROWS_AFTER_SQL` finds nothing. Target comparisons parse the row's `target` into an
  `Address`, so case never matters in the resolver. #1941 must compare EIP-55 strings on the read side.
- **Ordering.** The Stellar ordering argument holds on EVM. The chain's AccessManager rows are written only by that
  chain's `index_once`, sequentially, in one transaction per batch, in `(block, log_index)` order. So a higher
  `contract_logs.id` is never committed before a lower one for `(chain_id, contract_address)`.
- **First-match-wins handlers.** Some EVM handlers decode by topic0 without checking the address. The 12
  AccessManager topics do not collide with any registered event; the parser test pins the three operation topics.
  The new handler also checks `log.address() == access_manager`.
- **Execute nonce unused.** If an `OperationScheduled` failed to decode (no raw row), a later execute of the same id
  could close an older, expired `pending` row of that id. Stellar has the same exposure. A decode failure logs
  `warn` and cannot happen for the stock event.
- **Expired-then-rescheduled operations** keep the old row `pending` (it reads as expired). The API's existing
  "later schedule supersedes" rule handles it, as on Stellar.

## Decisions (human, 2026-11-17)

All open questions of the first plan were resolved. The steps below implement these answers, as amended by the
directive.

0. **Directive (2026-11-17, overrides earlier plan choices):** "Everything must be done the same way as on Stellar —
   one and the same approach." The EVM indexer mirrors #1921 + #1927 one-to-one. It deviates only where the EVM chain
   data makes the Stellar mechanism impossible or meaningless; see [Differences from Stellar](#differences-from-stellar).
1. **Loan-scoped functions:** the explicit list from the issue, exactly as on Stellar. *Changed 2026-11-17:* the
   human dropped `Minter.reverseDisburse` for strict parity, because Stellar's `loan_ref` covers only `reverse_repay`.
   `reverseDisburse` is still decoded (`function`, `args_json`), but its `loan_id` stays NULL.
2. **`function` naming:** Solidity camelCase. #1941 / #1943 map it per chain. *Unchanged, and consistent with
   Stellar:* both chains store the contract's native name.
3. **Record → loan:** the same approach as Stellar. *Unchanged; wording corrected:*
   - First, `RECORD_LOAN_SQL` (`security_records`, then the `SecurityRecordRegistered` log, then
     `security_view_snapshots`), run from the sync loop as on Stellar.
   - If that misses, `loan_id` stays NULL with `record_id` kept. The fallback that fills it is the read-time
     `COALESCE` lookup in `LIST_PENDING_LOAN_OPS_SQL`; `access_manager_repo.rs` has no write-side backfill job.
   - No RPC inside `index_once`, and none in the sync loop either.
4. **SecurityRegistry / RecordNft keys:** shared with #1938 (`CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS`,
   `…_SECURITY_RECORD_NFT_ADDRESS`). Whichever PR merges first adds them. *Unchanged.* The field shape now follows
   #1938's plan: `security_registry: Option<EvmSecurityRegistryConfig>`.
5. **`expiration()` unreadable at boot:** fall back to 604800 and log a warning. *Superseded and moot.* There is no
   boot read: `expires_at` uses `EXPIRATION_SECS`, as on Stellar (planner Decision 9).
6. **Anvil:** golden log fixtures only, with no end-to-end worker run against Postgres. *Unchanged.*

**Earlier planner choices changed by the directive:**

| Before | Now |
|---|---|
| No sync loop; a custom mapper projected inside `index_once` | Raw `contract_logs` rows in `index_once`, plus the shared supervised `access-manager-sync` loop, watermark and backoff |
| New `CLOSE_BY_NONCE_SQL` (exact `(operation_id, nonce)`) | `MARK_CANCELED_SQL` / `MARK_EXECUTED_SQL` unchanged |
| `function` decoded in the parser and stored in the raw row | Raw row stores only event fields (`data`); decoding happens in the sync resolver |
| `expiration()` `eth_call` at boot, and `NewScheduledOp.expires_at` as a field | `EXPIRATION_SECS` constant and the unchanged `expires_at()` method |
| Hash mismatch: store the args anyway | Never guess: store without args, with a `warn` |
| `insert_scheduled_on`, `close_by_nonce_on`, `record_loan_on`, `insert_log_returning_id`, savepoint | Dropped: the existing `AccessManagerRepo` pool methods are used through `RepoStore` |
| Field-per-key `security_registry_address` / `security_record_nft_address` | #1938's `EvmSecurityRegistryConfig` |
| Test files `evm_access_manager_parsers.rs`, `_config.rs`, `access_manager_evm_sql.rs` | Stellar's layout: `evm_access_manager_{parsers,hash,sync,loan_ref,config}.rs`, plus `migration_access_manager_calldata.rs` and the extended `access_manager_projection_sql.rs` |

## Open Questions

_None_ (the `reverseDisburse` question was resolved 2026-11-17: dropped on EVM, see Decisions 1).

## Implementation Steps

1. **Migration** (done) `packages/shared/migrations/20261118000002_access_manager_operations_calldata.sql`. Re-check the
   version against `main` and #1938 first.
   - Header `-- spec: docs/references/access-manager-events.md#table` and a `-- Rollback:` block, in the style of
     `20261117000001`: drop the constraint, drop the column, delete the `_sqlx_migrations` row.
   - `ALTER TABLE access_manager_operations ADD COLUMN IF NOT EXISTS calldata TEXT NULL;`
   - `access_manager_operations_one_args_encoding CHECK (args_xdr IS NULL OR calldata IS NULL)`, added in a `DO $$`
     block guarded by a `pg_constraint` lookup, so a re-run is a no-op.
   - No index or data change.
2. **Shared repo** (done) `packages/shared/src/access_manager_repo.rs`:
   - `NewScheduledOp` gains `calldata: Option<String>`. `expires_at()` is unchanged.
   - `INSERT_SCHEDULED_SQL` gains the `calldata` column and a placeholder. The `ON CONFLICT` target and `DO NOTHING`
     are unchanged. `AccessManagerRepo::apply` binds it.
   - Everything else is unchanged: `MARK_*`, `RECORD_LOAN_SQL`, the watermark SQL, `LIST_ROWS_AFTER_SQL`,
     `HAS_PENDING_CALL_SQL`, `LIST_PENDING_LOAN_OPS_SQL` and `PendingOpRow`.
3. **Chain-neutral sync core** (done): new `packages/worker/src/indexer/access_manager_sync.rs`, with header
   `// spec: docs/references/access-manager-events.md#sync-loop`, declared in `indexer/mod.rs`.
   - Move out of `stellar/access_manager_sync.rs`:
     - `ACCESS_MANAGER_SYNC_INTERVAL`, `ROWS_PER_CYCLE`, `CYCLE_BUDGET`;
     - `Retry`, `AmSyncStore`, `RepoStore`;
     - `unparsable`, as `pub fn unparsable_row`.
   - Move out of `stellar/access_manager_parsers.rs`:
     - `CanceledRow` and its `str_param` / `num_param` helpers, which are chain-neutral;
     - `LoanRef` and `AmTopic`.
   - New: `#[async_trait] pub trait AmRowResolver: Send { fn begin_cycle(&mut self) {} async fn resolve(&mut self,
     row: &AmLogRow, store: &dyn AmSyncStore) -> Result<OpWrite, Retry>; }`.
   - New: `pub fn cancel_write(row: &AmLogRow) -> OpWrite`. This is today's `OP_EVENT_CANCELED` arm; both chains
     use it.
   - New: `pub async fn loan_columns(loan_ref: LoanRef, security_registry: Option<&str>, store: &dyn AmSyncStore) ->
     Result<(Option<i64>, Option<i64>), Retry>`. This is today's `loan_ref` match block in `resolve_schedule`,
     including the `record_loan` call.
   - `pub async fn sync_rows(store, resolver: &mut dyn AmRowResolver, backoff: &mut KeyedBackoff<i64>, now) ->
     Result<usize>`. It is today's `sync_once` body: `begin_cycle()` first, then `resolver.resolve(&row, store)`
     in place of `resolve_row`. The warn/debug messages, `break` rules and backoff are unchanged.
   - `run_cycle(chain_id, store, resolver, backoff)` keeps the budget and the panic guard.
   - `pub async fn run_sync_loop(chain_id, store: &dyn AmSyncStore, resolver: &mut dyn AmRowResolver) ->
     Result<()>`: sleep `ACCESS_MANAGER_SYNC_INTERVAL` when `applied < ROWS_PER_CYCLE`.
   - `KeyedBackoff` is imported from `crate::indexer::supervise`.
4. **Stellar becomes a resolver** (done) (refactor only, no behaviour change):
   - `stellar/access_manager_sync.rs` keeps `TxFetch`, `TxEnvelopeSource`, `AmSyncConfig`, `classify_transaction`,
     `RpcTxSource`, `TX_FETCH_TIMEOUT`, `fetch_cached`, `resolve_schedule` and `resolve_execute`.
     - New `StellarRowResolver<'a> { tx: &'a dyn TxEnvelopeSource, cfg: &'a AmSyncConfig, cache: HashMap<String,
       TxFetch> }` implements `AmRowResolver`. `begin_cycle` clears the cache, so there is one cache per cycle, as
       today.
     - `resolve_schedule` sets `calldata: None` and uses `loan_columns`. The cancel arm uses `cancel_write`.
     - `pub async fn sync_once(store, tx, cfg, backoff, now)` keeps its signature and calls `sync_rows` with a fresh
       resolver.
     - `run_access_manager_sync_loop(rpc, repo, chain_id, contract_id, ids)` keeps its signature and calls
       `run_sync_loop`.
     - `pub use crate::indexer::access_manager_sync::{AmSyncStore, RepoStore, Retry, ACCESS_MANAGER_SYNC_INTERVAL,
       ROWS_PER_CYCLE, CYCLE_BUDGET};`.
   - `stellar/access_manager_parsers.rs`: `pub use crate::indexer::access_manager_sync::{AmTopic, CanceledRow, LoanRef};`.
5. **EVM parser** (done): new `packages/worker/src/indexer/access_manager_evm_parsers.rs`, header
   `// spec: docs/references/access-manager-events.md#evm-encoding`. It is pure and DB-free; naming follows #1938's
   `security_registry_evm_parsers.rs`.
   - `sol!` events: the 3 operation events and the 9 allow-listed `IAccessManager` events (topic0 only).
   - `pub const ACCESS_MANAGER_EVM_ALLOW_LISTED_TOPICS: [B256; 9]` and
     `pub fn classify_access_manager_topic(topic0: B256) -> AmTopic`, with the shared `AmTopic` semantics:
     Scheduled, Canceled, Executed, AllowListed, Unknown. It returns the shared `AmTopic` (moved to the core in step 3).
   - `pub fn parse_access_manager_log(log: &Log, access_manager: Address) -> Option<ContractLog>`. It mirrors
     `dispatch_access_manager`:
     - `None` for another emitter;
     - silent `None` for allow-listed topics;
     - `warn` + `None` for an unknown topic, or for one of the three that fails to decode;
     - otherwise a `ContractLog` named `OP_EVENT_*` with the Decision 2 params, built with `extract_log_meta`
       (`block_timestamp: 0`, set later by `index_once`).
   - Typed readers: `EvmScheduledRow { operation_id, caller, nonce: u32, when: u64, target, data: String }` and
     `EvmExecutedRow { operation_id, nonce: u32 }`, each with `from_params`. Canceled uses the shared `CanceledRow`.
   - `pub fn hash_operation(caller: Address, target: Address, data: &[u8]) -> [u8; 32]`, which is
     `keccak256((caller, target, Bytes(data)).abi_encode_params())`. Verify the encoding against a `cast` vector
     (Test Strategy).
   - `pub struct EvmTargets { loan_registry: Address, minter: Address, security_registry: Option<Address>,
     record_nft: Option<Address> }`, the counterpart of `TargetIds`.
   - ABI tables: `alloy::sol!` interface blocks for the four contracts, covering every external non-view function,
     with named parameters and the `Terms` struct. Build a per-target selector → `alloy::json_abi::Function` lookup:
     via `#[sol(abi)]`, or via `Function::parse` of full human-readable signatures with parameter names if
     `#[sol(abi)]` is unavailable under the workspace's alloy 0.8 features (`contract` enables `dyn-abi` and
     `json-abi`).
     - `pub fn decode_call(target: Address, data: &[u8], targets: &EvmTargets) -> DecodedCall { function: String,
       args: Option<Vec<DynSolValue>>, args_json: Option<Value> }` follows Decision 6. Decode with
       `abi_decode_input(&data[4..], true)`.
   - `pub fn args_display_json(values: &[DynSolValue], params: &[Param]) -> Value` follows Decision 6, by analogy
     with Stellar's `args_display_json`.
   - `pub fn loan_ref(target: Address, function: &str, args: &[DynSolValue], targets: &EvmTargets) -> LoanRef`
     follows Decision 7. Use const name lists like Stellar's `LOAN_REGISTRY_FUNCTIONS`. Arg 0 must be a
     `Uint(_, 256)` that fits `u32`; otherwise `None` with a `warn`.
6. **EVM resolver and loop** (done): new `packages/worker/src/indexer/access_manager_evm_sync.rs`, header
   `// spec: docs/references/access-manager-events.md#evm-sync-loop`.
   - `pub struct EvmAmSyncConfig { contract_id: String /* EIP-55 */, targets: EvmTargets }`.
   - `pub struct EvmRowResolver<'a> { cfg: &'a EvmAmSyncConfig }` implements `AmRowResolver`:
     - `OP_EVENT_SCHEDULED`: `EvmScheduledRow::from_params`; if that fails, `unparsable_row`. Decode `data` (`0x`
       hex); if invalid hex or shorter than 4 bytes, `unparsable_row` + `warn`. Then the hash check (Decision 5):
       - mismatch → `NewScheduledOp` with `calldata`, `args_json`, `loan_id` and `record_id` all `None`, plus the
         `warn` "no schedule reproduces the operation id; args not stored". `function` comes from `decode_call`,
         with no args.
       - match → `decode_call`, then `loan_ref`, then `loan_columns(.., targets.security_registry.map(|a|
         a.to_checksum(None)), store)`. `calldata` = the normalised `0x` lowercase hex.

       The other fields are as on Stellar: `ready_at = when`, `schedule_tx_hash` / `schedule_ledger` /
       `scheduled_at` / `source_log_id` from the row, and `args_xdr: None`.
     - `OP_EVENT_CANCELED`: `cancel_write(row)`.
     - `OP_EVENT_EXECUTED`: `EvmExecutedRow::from_params`, giving `OpWrite::Execute { ids: vec![operation_id],
       tx_hash, ledger }`. If it fails, `unparsable_row`.
     - Anything else: `unparsable_row`.
   - `pub async fn sync_once(store, cfg: &EvmAmSyncConfig, backoff, now) -> Result<usize>`, a thin wrapper over
     `sync_rows`, mirroring the Stellar entry point for tests.
   - `pub async fn run_access_manager_sync_loop(repo: AccessManagerRepo, chain_id, cfg: EvmAmSyncConfig) ->
     Result<()>`. It builds `RepoStore { repo, chain_id, contract_id }` and calls `run_sync_loop`.
7. **Config** (done) `packages/worker/src/indexer/config.rs`:
   - Add `IndexerJobSettings.access_manager_address: Option<Address>` from `{ip}ACCESS_MANAGER_ADDRESS`, via
     `env_nonblank` + `parse_evm_address`.
   - If #1938 has not merged yet, also add `security_registry: Option<EvmSecurityRegistryConfig>` exactly as #1938's
     plan step 7 defines it: parsing and pairing errors only, no handler.
8. **Wiring** (done) (`packages/worker/src/indexer/mod.rs`, plus the handler module):
   - `access_manager_evm_parsers.rs`:
     - `pub fn reject_access_manager_collision(chain_id, am: Address, roles: &[(&str, Address)]) -> Result<()>`,
       following the `reject_plusd_collision` pattern. Its error names both keys, and `ASSET_ADDRESS` maps to
       `JOB_INDEXER_EVM_<id>_ASSET_ADDRESS`.
     - `pub fn register_access_manager_handler(builder, chain_id, am, repo: Arc<EventRepo>) ->
       EvmEventPollerBuilder`, built with `add_event_handler(vec![am], …)`. It wraps `parse_access_manager_log` in a
       plain `ContractLogMapper`, as `register_plusd_transfer_handler` does.
   - `run_indexer_job`, when `settings.access_manager_address` is `Some(am)`, does the following after the PLUSD
     block (and after #1938's security block):
     1. Run `reject_access_manager_collision` against `core_roles`, which by then include DM, WQ, sPLUSD, LR,
        Minter, CR, DTF and #1938's security keys, plus `PLUSD_ADDRESS` and `ASSET_ADDRESS` when set.
     2. Log `info` "EVM AccessManager indexer enabled" (chain_id, access_manager).
     3. Register the handler.
     4. Keep `let _access_manager_guard = spawn_supervised("access-manager-sync", chain_id, move || …)` alive across
        `index_loop`. The task builds `EvmAmSyncConfig` with:
        - `contract_id: am.to_checksum(None)`;
        - `loan_registry` / `minter` from the parsed `loan_registry_contracts[0]` and `yield_minter_contracts[0]`;
        - `security_registry` / `record_nft` from `settings.security_registry`.

     When the key is unset, none of this runs.
9. **Test support split** (done) (no Stellar behaviour change). Move the chain-neutral fakes `Op`, `StoreState`,
   `MemStore`, `newest_before` and its `AmSyncStore` impl from `packages/worker/tests/stellar_access_manager_support/mod.rs`
   to a new `packages/worker/tests/access_manager_support/mod.rs`.
   - `stellar_access_manager_support/mod.rs` includes it with `#[path = "../access_manager_support/mod.rs"] mod
     access_manager_support; pub use access_manager_support::*;`, so every Stellar test keeps its imports.
   - `MemStore` stores the new `calldata` through `NewScheduledOp`; no other change.
   - A new `packages/worker/tests/evm_access_manager_support/mod.rs` holds the EVM builders and fixtures:
     - log builders for the three events and an allow-listed event, using `SolEvent::encode_log_data` as in
       `evm_minter_parsers.rs`;
     - `scheduled_row` / `canceled_row` / `executed_row` `AmLogRow` builders;
     - `config()`, which returns the `EvmAmSyncConfig`;
     - the Anvil golden constants from step 10.
10. **Anvil fixtures** (done) (manual, once). Keep the recipe in the PR description and commit the results as test
    constants:
    1. Start `anvil`. Deploy OpenZeppelin `AccessManager(admin)` from `pipeline-contracts/lib/openzeppelin-contracts`
       with `forge create`, then deploy a trivial target with a payable fallback.
    2. As admin: `setTargetFunctionRole(target, [0xe0da6b66, 0xdf84b5b3], 7)` and `grantRole(7, caller, 3600)`.
    3. As caller: `schedule(target, setDefault(7) calldata, 0)`, `evm_increaseTime 3601`, `execute(target, data)`.
    4. Schedule `resolveFlag(3, 1, 0x…)` and `cancel` it.
    5. Save the four logs (address, topics, data, block, tx hash, log index, from `cast logs`) and the four
       `operationId`s into `evm_access_manager_support/mod.rs`.

    Never point anything at the local pipeline database.
11. **Docs and env** (done): see Docs to Update.
12. **Checks:** (done)
    - `cargo fmt --all --check` and `cargo clippy --all -- -D warnings`;
    - `cargo test -p pipeline-worker -p shared -p api` (the API crate confirms the #1922 tests still pass);
    - `scripts/check-chain-env-names.sh` and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests live in `packages/<pkg>/tests/*.rs`. They are pure, never open a database, and never read `DATABASE_URL`
or `POSTGRES_URL`. The layout mirrors the Stellar suites one-to-one.

- `packages/worker/tests/evm_access_manager_parsers.rs` (mirrors `stellar_access_manager_parsers.rs`):
  - Topic hashes for all 12 events, and every selector in the Scope table, equal the computed values. This catches a
    mistyped signature, especially the 15-field `Terms` tuple.
  - The golden `OperationScheduled` decodes to `AccessManagerOperationScheduled` with
    `{operation_id (no 0x), caller, nonce, when, target (EIP-55), data (0x hex)}` and the right block, tx and log
    index.
  - Canceled and executed logs decode to `{operation_id, nonce}`.
  - A wrong topic count or truncated data gives `None`. A log from another address with the same topic gives
    `None`. Each allow-listed topic is dropped silently. An unknown topic is dropped.
  - `EvmScheduledRow` / `EvmExecutedRow` / `CanceledRow` round-trip through `from_params` and reject missing or
    malformed fields.
  - `decode_call`:
    - every Risk Council function and `setInspectors` decodes to the right name and `args_json`;
    - an unknown selector, an unconfigured target, or the AccessManager as target gives `function = "0x…"` and
      `args_json = None`;
    - a known selector with garbage arguments keeps the name and gives `args_json = None`.
- `packages/worker/tests/evm_access_manager_hash.rs` (mirrors `stellar_access_manager_hash.rs`):
  - `hash_operation` equals the event `operationId` for every Anvil golden log.
  - It equals a precomputed `cast keccak $(cast abi-encode "f(address,address,bytes)" …)` vector, which pins the
    `abi.encode` layout of the dynamic `bytes`.
  - Changing the caller, the target or one byte of data changes the id.
  - The golden schedule and execute share the id.
- `packages/worker/tests/evm_access_manager_sync.rs` (mirrors `stellar_access_manager_sync.rs`; uses `MemStore` and
  the EVM `sync_once`):
  - A schedule becomes a `pending` row with `calldata`, `function`, `args_json` and `ready_at = when`,
    `expires_at = when + 604800`, and `args_xdr = None`.
  - An id mismatch stores the row without `calldata`, args or loan, and advances the watermark.
  - Schedule then execute in one batch gives `executed`. Schedule then cancel in one batch gives `canceled`.
  - A cancel or execute of an unknown operation is a no-op that advances the watermark.
  - An execute touches only the newest schedule of the id.
  - A cancel naming another nonce than the newest schedule changes nothing.
  - A re-schedule after a cancel (`nonce + 1`) gets its own row. A later cancel closes only that row, and a replay
    never closes the later schedule.
  - Replaying from a reset watermark changes nothing.
  - An unknown selector is stored with `function = "0x…"`, `args_json = None` and `calldata` set.
  - Invalid hex `data`, or data shorter than 4 bytes, is skipped and advances the watermark.
  - One call is capped at `ROWS_PER_CYCLE`.
  - A failing apply backs off without advancing and retries later.
  - Unparsable params are skipped and advance the watermark.
- `packages/worker/tests/evm_access_manager_loan_ref.rs` (mirrors `stellar_access_manager_loan_ref.rs`):
  - `loan_ref` matches every row of the Decision 7 table.
  - Loan 0 is valid. An id above `u32::MAX` gives `None`.
  - The same function on the wrong target, or an unset SecurityRegistry, gives `None`.
  - A record is resolved through the store (`MemStore.records`). An unresolved record keeps `record_id`.
  - `args_display_json`:
    - small integers and enums are numbers, wide integers are decimal strings, and a negative `int256`
      (`adjustInterest`) is right;
    - `bytes32` is hex without `0x`, and `address[]` is EIP-55;
    - the `setTerms` tuple is an object with all 15 field names, and the output never contains NUL.
- `packages/worker/tests/evm_access_manager_config.rs` (mirrors `stellar_access_manager_config.rs`; uses the
  `ENV_LOCK` pattern of `evm_collateral_registry_config.rs`):
  - An unset or whitespace-only key gives `None`. A valid key gives `Some`. An invalid key is an error naming the
    key.
  - `reject_access_manager_collision` names both keys for a clash with each role (core, CR, DTF, PLUSD, asset,
    security registry, record NFT), and passes for a distinct address.
  - The key coexists with the security registry and loan registry keys.
- `packages/shared/tests/migration_access_manager_calldata.rs` (mirrors `migration_access_manager_schedule_key.rs`):
  - The migration adds a nullable `calldata` column and the named CHECK, guarded by a `pg_constraint` lookup.
  - It has no data change and has a rollback block.
- `packages/shared/tests/access_manager_projection_sql.rs` (extended): `INSERT_SCHEDULED_SQL` lists `calldata`, and
  its conflict target still equals the `access_manager_operations_schedule_key` columns. The existing `MARK_*`
  assertions stay and now cover both chains.
- `packages/shared/tests/access_manager_pending_sql.rs`: unchanged. It still pins `args_xdr IS NOT NULL`, so EVM
  rows stay out of the #1922 read until #1941.
- Existing Stellar suites (`stellar_access_manager_*.rs`, `stellar_supervise.rs`, `packages/api/tests/pending_operations.rs`)
  pass unchanged after the refactor and the support split.

## Docs to Update

- `docs/references/access-manager-events.md`:
  - Retitle it to "AccessManager scheduled operations" and update the intro to cover both chains.
  - Keep every existing section and anchor (`#configuration`, `#encoding`, `#table`, `#sync-loop`, `#args-recovery`,
    `#loan-id`, `#cursor-and-retention`, `#api-read`, `#known-limitations`) as the Stellar description.
  - `## Table`: add the `calldata` column and the CHECK. State that the status rules and close SQL apply to both
    chains, and that `expires_at` is `ready_at + 604800` on both.
  - `## Sync loop`: one sentence saying that the loop, watermark, ordering, per-row transaction and backoff are
    shared, and that only the per-chain row resolver differs.
  - Append `## EVM` with these subsections, which are the anchors the EVM `// spec:` headers point at:
    - `### EVM configuration`: the key, the dark default, the collision rule, and the targets from the indexer keys.
    - `### EVM encoding`: the event table, stored names and params, and the allow-list.
    - `### EVM sync loop`: the resolver: no RPC, execute by id, `cancel_write`.
    - `### EVM args and operation id`: `calldata`, the keccak check and "never guess", decoding, `function`
      naming, and the `args_json` form.
    - `### EVM loan id`: the table and the record lookup.
    - `### EVM cursor and rollout`: no retention, rewind to the AccessManager deploy block if needed, lossless
      re-projection, and the check queries.
    - `### EVM known limitations`: the unused execute nonce, and AccessManager-self targets shown as selectors.
    - `### Differences from Stellar`: the table from this plan.
- `docs/references/index.md`: update the entry title and summary; it is no longer Stellar-only.
- `docs/references/backend.md`:
  - Add a new "#### EVM AccessManager indexing" next to the Stellar subsection: the key, the dark default, the raw
    rows plus the shared `access-manager-sync` task with no RPC, and a link to the reference.
  - Add one EVM rollout line next to the Stellar "AccessManager rollout" paragraph.
- `ARCHITECTURE.md` line 64: change "AccessManager scheduled-operation events (Stellar)" to "(EVM and Stellar)".
- `.env.example`: in the EVM block after `…_PLUSD_ADDRESS`, add `# CHAIN_1_EVM_INDEXER_ACCESS_MANAGER_ADDRESS=  #
  optional — OZ AccessManager (Hoodi 0x3dF345BF5fd3ecB1F8E031B450Ceb2BF7B645992); OperationScheduled/Canceled/Executed
  into contract_logs + access_manager_operations (calldata) via the access-manager-sync task (#1939); unset ships
  dark; rewind the cursor to at or before the earliest pending schedule`.
- `docs/user-stories/epic-1937/1939-evm-access-manager-indexer.md` (new): operator stories mirroring
  `epic-1920/1921-access-manager-indexer.md`. Add an "Epic #1937" table to `docs/user-stories/index.md` if #1938 has
  not added one.
  - Config: the key set, unset, invalid or colliding.
  - Projection: a scheduled Risk Council call is projected by the sync task with `calldata`, `function`,
    `args_json`, `loan_id`, `ready_at` and `expires_at`, and `access_manager_sync_state` advances.
  - Closing: execute (via `AccessManager.execute`, or via a direct target call) and cancel close the row. A
    re-schedule adds a row with `nonce + 1`.
  - Role events produce nothing.
  - Live-chain stories are marked as needing #1944 on Hoodi.
- `docs/product-specs/loan-security-state.md`: no change. API behaviour is unchanged; #1941 updates it.
- `docs/exec-plans/tech-debt-tracker.md`: no change. #1938 moved `supervise.rs` to `indexer/supervise.rs`, so there
  is no `supervise.rs` debt entry. No EVM counterpart of TD-187 is needed.
