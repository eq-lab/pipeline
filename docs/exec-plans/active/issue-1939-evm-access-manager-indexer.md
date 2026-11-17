# Issue #1939: EVM AccessManager indexer: scheduled / canceled / executed operations with calldata

Source: https://github.com/eq-lab/pipeline/issues/1939

Parent epic: #1937, merge-order step 1 (in parallel with #1938). #1941 (API `pending_operations` for EVM) reads
what this issue writes. The Stellar counterpart is #1921 (with the #1927 key fix). Contracts are frozen.

## Scope

### Source of truth (checked by the planner on 2026-11-17)

- **Contracts:** `pipeline-contracts@150631a`.
  - `lib/openzeppelin-contracts/contracts/access/manager/AccessManager.sol`, stock OpenZeppelin:
    - `schedule(target, data, when)` (:441) emits
      `OperationScheduled(bytes32 indexed operationId, uint32 indexed nonce, uint48 schedule, address caller, address target, bytes data)` (:472).
      `schedule` is the resolved timepoint (`max(when, now + setback)`).
    - `cancel` (:528) emits `OperationCanceled(bytes32 indexed operationId, uint32 indexed nonce)` (:545).
    - `_consumeScheduledOp` (:564) emits `OperationExecuted(bytes32 indexed operationId, uint32 indexed nonce)` (:577).
      It is reached from `AccessManager.execute` (only when a schedule exists or the caller has a delay) and from a
      target's `restricted` modifier via `consumeScheduledOp` (a direct call to the target). Both emit from the
      AccessManager. Immediate calls emit nothing.
    - `hashOperation = keccak256(abi.encode(caller, target, data))` (:583).
    - `expiration()` (:159) returns `1 weeks` (604 800 s).
    - The nonce is in `_schedules[id].nonce` (persistent). Cancel and execute keep it; a re-schedule (allowed only once
      the previous one is closed or expired) uses `nonce + 1`. So `(operation_id, nonce)` is unique for the life of
      the contract. The Stellar nonce-reset logic (#1927) is not needed.
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
      `record(recordId)` (:364) returns `Record { recordId, loanId, … }`. `RecordRegistered(loanId indexed, recordId indexed, …)` (:30).
    - `src/PipelineSecurityRecordNft.sol`: `setInspectors(address[])` (:205), `addDoc`, `recordInspection`,
      `approveInspection`, `setSecurityRegistry`.
  - Roles: `script/roles/*.sol`. All Hoodi delays are 0 (`script/base/ChainValues.sol`), so nothing is scheduled on
    Hoodi until #1944.
  - Hoodi (`deployments/hoodi-v5.json`): AccessManager `0x3dF345BF5fd3ecB1F8E031B450Ceb2BF7B645992`,
    LoanRegistry `0xdF08fdf0f47272a8Ced33A5f913f6C9D179B0231`, Minter `0x621BaAb0ced6b11f88019582183b081A118755f4`,
    SecurityRegistry `0xB51E7f13420D106946376A67Fe5921C63B09BE15`, RecordNft `0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09`.
- **Selectors and topics** (`cast sig` / `cast keccak`; tests pin them):

  | Signature | Value |
  |---|---|
  | `OperationScheduled(bytes32,uint32,uint48,address,address,bytes)` | `0x82a2da5dee54ea8021c6545b4444620291e07ee83be6dd57edb175062715f3b4` |
  | `OperationExecuted(bytes32,uint32)` | `0x76a2a46953689d4861a5d3f6ed883ad7e6af674a21f8e162707159fc9dde614d` |
  | `OperationCanceled(bytes32,uint32)` | `0xbd9ac67a6e2f6463b80927326310338bcbb4bdb7936ce1365ea3e01067e7b9f7` |
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
  | `setTerms(uint256,(uint32,uint32,uint32,uint64,uint64,uint8,uint64,uint32,uint32,uint64,uint64,uint32,uint32,uint64,uint64))` | `0x45f225f5` (re-check with `forge inspect SecurityRegistryUpgradeable methodIdentifiers` after `forge build`; the local `out/` is stale) |
  | `expiration()` | `0x4665096d` |

- **Pipeline today:** `access_manager_operations` (migrations `20261116000001`, `20261117000001`) holds Stellar rows
  only. `AccessManagerRepo` (`packages/shared/src/access_manager_repo.rs`) works on a `PgPool` with a watermark
  (`access_manager_sync_state`). The #1922 API query `LIST_PENDING_LOAN_OPS_SQL` requires `args_xdr IS NOT NULL`
  and `pending_ops_by_loan` (`packages/api/src/routes/loan_book.rs:1511`) skips non-Stellar chains. The EVM indexer
  (`packages/worker/src/indexer/{mod.rs,evm_parsers.rs,config.rs,poller.rs}`) writes every mapper of a block range in
  one database transaction together with the cursor (`index_once`).

### Decisions

1. **Schema: a new nullable `calldata TEXT` column.** No generalized column. `args_xdr` keeps its name and meaning, so
   the Stellar rows, the Stellar sync code, `LIST_PENDING_LOAN_OPS_SQL`, `PendingOpRow` and the #1922 DTO stay
   unchanged. EVM rows have `args_xdr = NULL` and are therefore never served by the current API query (which also
   skips EVM chains); #1941 adds the EVM read. A named CHECK `access_manager_operations_one_args_encoding`
   (`args_xdr IS NULL OR calldata IS NULL`) keeps the two encodings exclusive. Both may be `NULL` (a Stellar row
   out of retention). Value: the full calldata (selector + arguments) as `0x` + lowercase hex, exactly the event's
   `data`, which is what `execute(target, data)` and `cancel(caller, target, data)` need.
2. **No sync loop for EVM: direct projection in the EVM log mapper.** The event carries everything; no transaction
   fetch is needed. A new `AccessManagerLogMapper` writes the raw `contract_logs` row **and** the projection change in
   the same `index_once` transaction as the cursor. Ordering, idempotence and crash safety come from that transaction:
   the raw row and the projection are committed together or not at all, and a replay skips both (`is_duplicate` on
   `contract_logs`). No watermark, no `access_manager_sync_state` row, no new task, no backoff. The EVM path does not
   touch `access_manager_sync.rs`.
   - The raw row is still written (parity, audit, and a re-projection source).
   - Re-projection after a decoder fix: stop the worker, delete the chain's AccessManager rows from `contract_logs`
     and `access_manager_operations`, rewind the EVM cursor to at or before the earliest schedule to rebuild, start.
     EVM RPC keeps full history, so (unlike Stellar) nothing is lost.
3. **Close by `(operation_id, nonce)` exactly.** Cancel sets `canceled`, execute sets `executed`, only when the row is
   `pending`. New SQL constants; the Stellar `MARK_CANCELED_SQL` / `MARK_EXECUTED_SQL` stay unchanged. A close with no
   matching row (schedule before indexing started) changes nothing and logs `debug`.
4. **Decoding.** Per target, using the ABI of the configured contract (LoanRegistry, Minter, SecurityRegistry,
   RecordNft):
   - `function` = the Solidity function name (`setDefault`, `releaseWithConsent`, …). Unknown selector, or a target
     that is none of the four configured contracts (including the AccessManager itself): `function` =
     `0x` + 8 lowercase hex of the selector, `args_json = NULL`. A known selector whose arguments fail to decode:
     `function` = the name, `args_json = NULL`, `warn`. `calldata` is always stored.
   - `args_json` is a positional JSON array, display only, same spirit as the Stellar form: `uint8`–`uint32` and
     `int8`–`int32` (enums included) as JSON numbers; wider integers as decimal strings; `bool`; `address` as EIP-55;
     `bytes` / `bytesN` as lowercase hex without `0x` (the EVM `contract_logs` hash convention and the Stellar
     `args_json` bytes form); `string` as string; arrays as arrays; tuples as objects keyed by the Solidity component
     names (`setTerms` → `["7", {"advanceRatioBps": 7000, …, "defaultBreachAt": "0"}]`).
   - ABI source: `alloy::sol!` interface blocks for the four contracts (structs with field names) in the new parser
     module, compiled into a selector → `alloy::json_abi::Function` table (via `#[sol(abi)]`, or
     `Function::parse` of full human-readable signatures with parameter names if `#[sol(abi)]` is not available
     under the workspace's alloy 0.8 features; `contract` already enables `dyn-abi` and `json-abi`). Decode with
     `alloy::dyn_abi::JsonAbiExt::abi_decode_input(&data[4..], true)` and render `DynSolValue` with the `Param`
     component names.
   - Sanity check: recompute `keccak256(abi.encode(caller, target, data))` and compare with `operationId`. A mismatch
     cannot happen on the stock contract; if it does, store the row anyway (the event is authoritative) and `warn`.
5. **Loan scoping** (see Open Question 1), resolved when the schedule is projected, by comparing `target` with the
   indexer's own addresses:

   | Target | Function | `loan_id` / `record_id` |
   |---|---|---|
   | LoanRegistry | `setDefault`, `cure`, `amendEconomics`, `adjustInterest`, `writeDown`, `closeDefaulted` | arg 0 is the loan id |
   | Minter | `reverseRepay`, `reverseDisburse` | arg 0 is the loan id |
   | SecurityRegistry | `setTerms` | arg 0 is the loan id |
   | SecurityRegistry | `releaseWithConsent`, `resolveFlag` | arg 0 is `record_id`; `loan_id` looked up |
   | anything else | `setInspectors` (RecordNft), other functions, unknown selectors, unconfigured targets | both `NULL` |

   A `uint256` id above `i64::MAX` leaves the column `NULL` with a `warn`. The table is driven by a const list so a
   later widening is one line.
6. **`record_id → loan_id` without RPC** (see Open Question 3). Inside the mapper, in a `SAVEPOINT`
   (`conn.begin()` on the `PgConnection`), run the existing `RECORD_LOAN_SQL` (security_records, then
   `SecurityRecordRegistered` rows of `contract_logs`, then `security_view_snapshots`) with the SecurityRegistry
   address. A miss or any error leaves `loan_id = NULL` with `record_id` kept (`debug` on a miss, `warn` on an error);
   the read side already resolves `COALESCE(loan_id, lookup)` at read time (#1922 pattern, reused by #1941). The
   savepoint keeps a lookup failure from aborting the batch, so it can never stall the chain cursor. A record's
   loan is immutable, so read-time resolution gives the same answer an `eth_call record(recordId)` would.
7. **`expires_at = schedule + expiration()`**, `expiration()` read once at `run_indexer_job` start when the key is set:
   `eth_call` on the AccessManager, up to 3 attempts with a 10 s timeout each. On failure, use 604 800 (the stock
   OpenZeppelin constant) and `warn` (see Open Question 5). Never fail the job: `run_indexer_job` errors are not
   restarted (`packages/worker/src/main.rs:47`), so an RPC blip at boot must not kill the whole EVM indexer.
   `NewScheduledOp` gets an explicit `expires_at: i64` field in place of the `expires_at()` method (the Stellar sync
   sets `when + EXPIRATION_SECS`, same values as today).
8. **Stored formats** (EVM rows): `contract_address`, `caller`, `target` EIP-55 (same as `contract_logs.contract_address`
   on EVM); `operation_id` 64 lowercase hex without `0x` (same as Stellar); `nonce` from the event; `ready_at` = the
   event's `schedule`; `schedule_tx_hash` / `closed_tx_hash` `0x` lowercase (the EVM `contract_logs.tx_hash` format);
   `schedule_ledger` / `closed_ledger` = block numbers; `scheduled_at` = block timestamp; `source_log_id` = the
   `contract_logs.id` of the schedule row (needs `RETURNING id`).
9. **`contract_logs` rows** reuse the Stellar event names (`OP_EVENT_SCHEDULED` / `_CANCELED` / `_EXECUTED`):
   - `AccessManagerOperationScheduled`: `{operation_id, nonce, when, caller, target, function, data}`
     (`nonce` and `when` decimal strings, `data` the calldata hex with `0x`).
   - `AccessManagerOperationCanceled` and `AccessManagerOperationExecuted`: `{operation_id, nonce}`. (The Stellar
     execute row carries `{target, function, caller}` instead; consumers already scope by chain and contract.)
   - Other AccessManager events (role, target, guardian, delay events) produce no row and no log line. One of the
     three topics that fails to decode logs `warn` and produces no row.
10. **Config.** New optional `CHAIN_<id>_EVM_INDEXER_ACCESS_MANAGER_ADDRESS` (`IndexerJobSettings.access_manager_address:
    Option<Address>`, blank = unset, invalid = startup error naming the key). Unset ships dark: no handler, no
    `eth_call`, the worker boots as before. It must differ from every core role, the collateral registry, the
    deal-token factory, PLUSD, the tracked asset and the security registry / record NFT keys (startup error naming
    both keys). Set: log `info` "EVM AccessManager indexer enabled" with chain id, address and expiration.
    The SecurityRegistry and RecordNft addresses come from the keys #1938 introduces,
    `CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS` and `CHAIN_<id>_EVM_INDEXER_SECURITY_RECORD_NFT_ADDRESS`
    (see Open Question 4). LoanRegistry and Minter are required keys already.

### Out of scope

- The API (`pending_operations` for EVM, the `calldata` DTO field, `target_kind` for EVM): #1941. The product spec
  `loan-security-state.md#pending-operations` keeps saying "EVM chains: empty array", which stays true.
- The Trustee and wallet-connect (#1942, #1943); AccessManager role events; role changes on Hoodi (#1944).
- Stage / prod deploy config (epic merge-order step 3).
- Any change to the Stellar indexer behaviour or the Stellar rows.

## Assumptions and Risks

- **Nothing is scheduled on Hoodi** until #1944 lands, so there is no live data to verify against. Verification uses
  synthetic logs plus golden logs captured from a local Anvil AccessManager with a delayed role (step 9).
- **Parallel work with #1938** (worktree `pipeline-feat-1938-evm-security-registry-indexer`, no plan yet at
  planning time):
  - Both may add the SecurityRegistry / RecordNft keys to `IndexerJobSettings`. Whichever merges second rebases onto
    the first one's fields; the key names must be identical.
  - Both may add a migration dated 2026-11-17/18. sqlx versions must be unique: before writing the migration, check
    `main` and the #1938 branch and pick an unused version (default `20261118000001`; if #1938 has taken it, the
    next free one).
  - `RECORD_LOAN_SQL` finds an EVM record only if #1938 projects EVM records into `security_records` (keyed by the
    EIP-55 SecurityRegistry address and a `BIGINT` record id) or stores `SecurityRecordRegistered` rows with
    `loan_id` / `record_id` params. If #1938 picks other names, `loan_id` stays `NULL` on EVM until the lookup gets
    an EVM branch; that branch belongs to #1941 (read side) or a follow-up. The savepoint keeps any cast error in
    that SQL (for example a `record_id` above `BIGINT`) from aborting the batch.
- **First-match-wins handlers.** Other EVM handlers decode by topic0 without an address check. The three AccessManager
  topics are unique to OpenZeppelin AccessManager, and the new handler checks `log.address() == access_manager`.
- **Address string comparison.** Loan scoping compares the event `target` (an `Address`) with the configured
  `Address` values, so case never matters in the worker. #1941 must compare EIP-55 strings (or normalise) on the read
  side; noted for that issue.
- **Projection write failure** (as opposed to the lookup) aborts the `index_once` batch and retries it, like every
  other EVM mapper. That is the intended behaviour for a transient DB error; a deterministic one would show up in the
  SQL text tests.
- **Expired-then-rescheduled operations** keep the old row `pending` (it reads as expired); the API's existing
  "later schedule supersedes" rule handles it. Same as Stellar.
- No RPC is added inside `index_once`; the only new RPC call is the one-off `expiration()` read at job start.

## Open Questions

1. **Which functions are loan-scoped on EVM?** Recommended default: the explicit list in Decision 5 (the issue's list:
   the six LoanRegistry Risk Council functions, `Minter.reverseRepay` / `reverseDisburse`, `setTerms`,
   `releaseWithConsent`, `resolveFlag`). Alternative: scope every decoded call on a configured target whose first
   input is named `loanId` / `recordId` (would also attach `rollover`, `closeLoan`, `updateMutable`, `disburse`, …
   if #1944 ends up putting a delay on the shared `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`).
2. **`function` naming on EVM.** Recommended default: the Solidity name (`setDefault`, `releaseWithConsent`), with #1941
   and #1943 mapping per chain kind. Alternative: store the Stellar snake_case names (`set_default`) so the Trustee's
   label maps are shared; arguments still differ per chain.
3. **`record_id → loan_id`.** Recommended default: the in-transaction `RECORD_LOAN_SQL` lookup in a savepoint (no
   RPC), `loan_id = NULL` with `record_id` kept on a miss, read-time resolution in the API. Alternative: an
   `eth_call record(recordId)` in the mapper (RPC inside `index_once`; an RPC failure would stall the chain cursor).
4. **Shared SecurityRegistry / RecordNft keys with #1938.** Recommended default: reuse
   `CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS` / `…_SECURITY_RECORD_NFT_ADDRESS`, added by whichever of #1938
   and #1939 merges first; no AccessManager-specific copies.
5. **`expiration()` read failure at boot.** Recommended default: fall back to 604 800 with a `warn` and keep indexing.
   Alternative: leave the AccessManager handler off (dark) for that run with an `error`, so no row is ever written
   with an assumed expiration.
6. **Anvil verification depth.** Recommended default: capture real `OperationScheduled` / `OperationExecuted` /
   `OperationCanceled` logs from a local Anvil AccessManager with a delayed role and commit them as golden test
   constants; no end-to-end worker run (that needs a Postgres, and tests and checks never use the local pipeline
   database). Alternative: also run the worker against Anvil with a disposable Postgres container.

## Implementation Steps

1. **Migration** `packages/shared/migrations/20261118000001_access_manager_operations_calldata.sql` (version per the
   Risks note):
   - Header `-- spec: docs/references/access-manager-events.md#table` and a rollback note, as in `20261117000001`.
   - `ALTER TABLE access_manager_operations ADD COLUMN IF NOT EXISTS calldata TEXT NULL;`
   - Add `CONSTRAINT access_manager_operations_one_args_encoding CHECK (args_xdr IS NULL OR calldata IS NULL)`,
     guarded by a `pg_constraint` existence check in a `DO $$` block so a re-run is a no-op.
   - No index change (EVM closes by `(chain_id, contract_address, operation_id, …)`, covered by the unique key's
     leading columns).
2. **Shared repo** `packages/shared/src/access_manager_repo.rs`:
   - `NewScheduledOp`: add `calldata: Option<String>`, replace `fn expires_at()` with a field `expires_at: i64`.
   - `INSERT_SCHEDULED_SQL`: add the `calldata` column and placeholder; `ON CONFLICT` target and `DO NOTHING`
     unchanged.
   - Extract the schedule insert into `pub async fn insert_scheduled_on(conn: &mut PgConnection, chain_id, contract,
     op: &NewScheduledOp) -> anyhow::Result<u64>`; `AccessManagerRepo::apply` calls it inside its own transaction
     (Stellar behaviour unchanged).
   - New `pub const CLOSE_BY_NONCE_SQL`: `UPDATE access_manager_operations SET status = $5, closed_tx_hash = $6,
     closed_ledger = $7, updated_at = now() WHERE chain_id = $1 AND contract_address = $2 AND operation_id = $3 AND
     nonce = $4 AND status = 'pending'`, plus `pub async fn close_by_nonce_on(conn, chain_id, contract, operation_id,
     nonce, status: OpStatus, tx_hash, block) -> anyhow::Result<u64>` (rejects `OpStatus::Pending`).
   - `pub async fn record_loan_on(conn: &mut PgConnection, chain_id, security_contract, record_id) ->
     anyhow::Result<Option<i64>>` running `RECORD_LOAN_SQL`; `AccessManagerRepo::record_loan` keeps its pool version.
   - `LIST_PENDING_LOAN_OPS_SQL`, `PendingOpRow`, the watermark SQL and the Stellar close SQL: unchanged.
3. **Raw row insert with id** `packages/shared/src/db.rs`: `EventRepo::insert_log_returning_id(conn, event:
   &ContractLog, chain_id) -> anyhow::Result<i64>` (same columns and formats as `insert_log`, `RETURNING id`).
4. **Stellar call sites** (mechanical, no behaviour change):
   `packages/worker/src/indexer/stellar/access_manager_sync.rs` `resolve_schedule` sets `calldata: None` and
   `expires_at: sched.when as i64 + EXPIRATION_SECS`; update
   `packages/worker/tests/stellar_access_manager_support/mod.rs` (`expires_at: new.expires_at`) and any other
   `NewScheduledOp` literal (`stellar_access_manager_loan_ref.rs`).
5. **Config** `packages/worker/src/indexer/config.rs`: `IndexerJobSettings.access_manager_address: Option<Address>` from
   `{ip}ACCESS_MANAGER_ADDRESS` via `env_nonblank` + `parse_evm_address`. If #1938 has not merged yet, also add
   `security_registry_address` / `security_record_nft_address: Option<Address>` from
   `{ip}SECURITY_REGISTRY_ADDRESS` / `{ip}SECURITY_RECORD_NFT_ADDRESS` (parse only; #1938 uses the same fields).
6. **Pure parser module** `packages/worker/src/indexer/evm_access_manager_parsers.rs` (spec header pointing at
   `docs/references/access-manager-events.md#evm`), all synchronous and DB-free:
   - `sol!` events `OperationScheduled`, `OperationExecuted`, `OperationCanceled`.
   - `pub struct EvmAmTargets { loan_registry: Address, minter: Address, security_registry: Option<Address>,
     record_nft: Option<Address> }`.
   - ABI tables for the four targets (Decision 4) and `pub fn decode_call(target: Address, data: &[u8], targets:
     &EvmAmTargets) -> DecodedCall { function: String, args_json: Option<Value>, args: Option<Vec<DynSolValue>> }`.
   - `pub fn abi_display_json(value: &DynSolValue, param: &Param) -> Value` per Decision 4.
   - `pub enum EvmLoanRef { Loan(i64), Record(i64), None }` and `pub fn evm_loan_ref(target, function, args,
     targets) -> EvmLoanRef` per Decision 5 (const function lists; arg 0 must be a `Uint(_, 256)`; overflow → `None`
     with `warn`).
   - `pub fn hash_operation(caller: Address, target: Address, data: &[u8]) -> B256`.
   - `pub enum ParsedAmLog { Scheduled { log: ContractLog, op: EvmScheduled }, Canceled { log, operation_id, nonce },
     Executed { log, operation_id, nonce } }` with `EvmScheduled { operation_id, nonce, ready_at: u64, caller,
     target, function, calldata: String, args_json, loan_ref }`.
   - `pub fn parse_access_manager_log(log: &Log, access_manager: Address, targets: &EvmAmTargets) ->
     Option<ParsedAmLog>`: returns `None` for another emitter, silently for non-operation topics, with `warn` for one
     of the three topics that fails to decode. Builds the `contract_logs` params of Decision 9 and runs the hash check.
   - `pub fn schedule_write(op: &EvmScheduled, loan_id: Option<i64>, source_log_id: i64, tx_hash: &str, block: u64,
     block_timestamp: u64, expiration_secs: u32) -> NewScheduledOp` (pure, so the mapper glue stays thin and the
     row shape is testable without a DB).
7. **Mapper and wiring** `packages/worker/src/indexer/evm_access_manager.rs`:
   - `pub fn reject_access_manager_collision(chain_id, am: Address, roles: &[(&str, Address)]) -> Result<()>`
     (pattern: `plusd_transfers::reject_plusd_collision`).
   - `pub async fn read_expiration(rpc_url: &str, am: Address) -> u32` per Decision 7 (alloy provider +
     `sol!` `function expiration() external view returns (uint32)`; pattern: `loan_registry_reader.rs`).
   - `pub struct AccessManagerLogMapper { parsed: ParsedAmLog, chain_id, contract: String, security_registry:
     Option<String>, expiration_secs: u32, repo: Arc<EventRepo> }` implementing `LogMapper`:
     - `is_duplicate`: `EventRepo::is_duplicate` on the raw row.
     - `insert`: `insert_log_returning_id`; then for a schedule resolve `EvmLoanRef::Record` with `record_loan_on`
       inside a savepoint (Decision 6), build `schedule_write(..)`, `insert_scheduled_on`; for cancel / execute
       `close_by_nonce_on` (`debug` when 0 rows).
     - `set_block_timestamp` sets the raw row's timestamp (used as `scheduled_at`).
   - `pub fn register_access_manager_handler(builder, chain_id, am, targets, expiration_secs, repo) ->
     EvmEventPollerBuilder` using `add_event_handler(vec![am], …)`.
   - `packages/worker/src/indexer/mod.rs`: declare both modules. In `run_indexer_job`, when
     `settings.access_manager_address` is `Some`: run the collision check against `core_roles` plus the deal-token
     factory, PLUSD, the asset and the security keys; `read_expiration`; log the `info` line; register the handler on
     the builder before `build()`. Unset: none of this runs.
8. **Docs and env** (see Docs to Update).
9. **Anvil fixtures** (manual, once; recipe kept in the PR description, results committed as test constants):
   `anvil`; deploy OpenZeppelin `AccessManager(admin)` from `pipeline-contracts/lib/openzeppelin-contracts` with
   `forge create`; deploy a trivial target with a payable fallback; as admin `setTargetFunctionRole(target,
   [0xe0da6b66], 7)` and `grantRole(7, caller, 3600)`; as caller `schedule(target, setDefault(7) calldata, 0)`,
   `evm_increaseTime 3601`, `execute(target, data)`; schedule a second call (`resolveFlag(3, 1, 0x…)`) and `cancel`
   it. Save the three logs (`cast logs` / `eth_getLogs`: address, topics, data, block, tx hash, log index) as
   constants in `packages/worker/tests/evm_access_manager_parsers.rs`. With the target address configured as the
   LoanRegistry (respectively SecurityRegistry) in the test, they must decode to the expected rows. Never point
   anything at the local pipeline database.
10. **Checks:** `cargo clippy --all -- -D warnings`, `cargo test -p pipeline-worker -p shared -p api` (the API crate
    only to confirm #1922 tests still pass), `scripts/check-chain-env-names.sh`, `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests live in `packages/<pkg>/tests/*.rs`, are pure and never open a database or read `DATABASE_URL` /
`POSTGRES_URL`.

- `packages/worker/tests/evm_access_manager_parsers.rs` (new):
  - Topic hashes and the selectors in the Scope table equal the computed values (catches a mistyped signature,
    especially the 15-field `Terms` tuple).
  - `OperationScheduled` synthetic log (built with `SolEvent::encode_log_data`, as in `evm_minter_parsers.rs`) →
    `ParsedAmLog::Scheduled` with params `{operation_id (no 0x), nonce, when, caller, target (EIP-55), function, data}`.
  - Executed and Canceled → `{operation_id, nonce}`; a `RoleGranted`-style log from the AccessManager → `None`;
    a log from another address with the same topic → `None`; a truncated `OperationScheduled` → `None`.
  - `decode_call` for every Risk Council function and `setInspectors`: name and `args_json` (numbers vs decimal
    strings, negative `int256` for `adjustInterest`, `bytes32` hex without `0x`, enum as number, `setTerms` tuple
    as an object with all 15 field names, address array as EIP-55).
  - Unknown selector, unconfigured target, AccessManager-as-target → `function = "0x…"`, `args_json = None`; known
    selector with garbage arguments → name kept, `args_json = None`; data shorter than 4 bytes → no panic.
  - `evm_loan_ref`: each row of the Decision 5 table, the same function on the wrong target, an unset
    SecurityRegistry, loan id 0, an id above `i64::MAX` → `None`.
  - `hash_operation` equals the event `operationId` for the Anvil golden logs; a mismatching synthetic id still
    parses.
  - `schedule_write`: `ready_at` = `schedule`, `expires_at = ready_at + expiration`, `calldata` set, `args_xdr`
    `None`, `source_log_id`, tx hash and block fields copied; `Record` ref keeps `record_id` and takes the given
    `loan_id` (or `None`).
  - Anvil golden logs (step 9) decode to the expected schedule, execute and cancel rows.
- `packages/worker/tests/evm_access_manager_config.rs` (new, `ENV_LOCK` pattern of
  `evm_collateral_registry_config.rs`): unset and blank key → `None`; invalid → error naming the key; valid →
  `Some`; `reject_access_manager_collision` names both keys for a clash with each role (core, CR, DTF, PLUSD, asset,
  security registry, record NFT) and passes for a distinct address.
- `packages/shared/tests/access_manager_evm_sql.rs` (new, SQL-text pattern of `access_manager_projection_sql.rs`):
  the calldata migration adds a nullable `calldata` column and the named CHECK; `INSERT_SCHEDULED_SQL` lists
  `calldata` and its conflict target still equals the `access_manager_operations_schedule_key` columns;
  `CLOSE_BY_NONCE_SQL` filters on `operation_id`, `nonce` and `status = 'pending'` and has no `ORDER BY`;
  `LIST_PENDING_LOAN_OPS_SQL` still requires `args_xdr IS NOT NULL` (EVM rows stay out of the #1922 read).
- Existing Stellar suites (`stellar_access_manager_*.rs`, `access_manager_projection_sql.rs`,
  `access_manager_pending_sql.rs`, `packages/api/tests/pending_operations.rs`) pass unchanged apart from the
  `NewScheduledOp` field updates.
- Edge cases covered above: cancel / execute for an unknown schedule (0 rows, no error) is a mapper-glue path
  verified by review and the SQL text test; re-schedule after cancel (nonce + 1, new row) is covered by
  `schedule_write` + the unique key test.

## Docs to Update

- `docs/references/access-manager-events.md`: retitle to "AccessManager scheduled operations"; keep the Stellar
  content under a "Stellar" heading and add an `## EVM` section: configuration key and collision rule, the three
  events and their `contract_logs` params, decoding and `args_json` form, the `calldata` column, direct projection
  in `index_once` (no sync loop, no watermark), close by `(operation_id, nonce)`, loan id table, record lookup,
  `expires_at` from `expiration()`, re-projection procedure, rollout (set the key, rewind the cursor to at or before
  the earliest pending schedule, or to the AccessManager deploy block), and known limitations. Update the Table
  section with the `calldata` column and the CHECK, and note that EVM rows never touch `access_manager_sync_state`.
- `docs/references/index.md`: the entry title and summary (no longer Stellar only).
- `docs/references/backend.md`: a new "#### EVM AccessManager indexing" subsection next to the Stellar one (key,
  dark default, direct projection, link to the reference); note the key in the EVM env text if an EVM key table
  exists there.
- `.env.example`: `# CHAIN_1_EVM_INDEXER_ACCESS_MANAGER_ADDRESS=  # optional — OZ AccessManager (Hoodi 0x3dF345BF5fd3ecB1F8E031B450Ceb2BF7B645992); OperationScheduled/Canceled/Executed into contract_logs + access_manager_operations with calldata (#1939); unset ships dark; rewind the cursor to at or before the earliest pending schedule`.
- `docs/user-stories/epic-1937/1939-evm-access-manager-indexer.md` (new; the epic names this folder): operator stories
  mirroring `epic-1920/1921-access-manager-indexer.md` — key set / unset / invalid / colliding; a scheduled
  Risk Council call projected with `calldata`, `args_json`, `loan_id`, `ready_at`, `expires_at`; execute (via
  `AccessManager.execute` and via a direct target call) and cancel close the row; re-schedule adds a row with
  `nonce + 1`; role events produce nothing. Live-chain stories are marked as needing #1944 on Hoodi.
- `docs/product-specs/loan-security-state.md`: no change (API behaviour is unchanged; #1941 updates it).
- `docs/exec-plans/tech-debt-tracker.md`: none expected. If Open Question 3 is resolved as "DB lookup" and #1938
  stores EVM records under names `RECORD_LOAN_SQL` does not read, log the missing EVM branch as a TD.
