# Issue #1485: EVM indexer: index DealTokenFactory events and DealToken Transfer

Source: https://github.com/eq-lab/pipeline/issues/1485

Parent epic: #1478. Siblings planned in parallel: #1480 (Stellar minter cash), #1481
(Stellar collateral-registry), **#1482 (Stellar deal-token-factory — direct counterpart,
same runtime-discovered token-address problem)**, #1483 (EVM Minter cash), #1484 (EVM
CollateralRegistry). QA: #1479.

Backend-only. No Figma reference on the Issue or the epic — no visual verification step.

## Ground truth

Verified 2026-10-13 against `/Users/aabliazimov/Documents/work/pipeline-contracts` at
`3b74e98` ("Deploy updated contracts to hoodi testnet (#50)").

`src/dealTokenFactory/DealTokenFactoryUpgradeable.sol:24-26`:

```solidity
event DealRegistered(uint256 indexed loanId, address debt, address cargo);
event DebtSynced(uint256 indexed loanId, uint256 target, uint256 previous, uint256 minted, uint256 clawed);
event CargoSynced(uint256 indexed loanId, uint256 target, uint256 previous, uint256 minted, uint256 burned);
```

`LoanRegistrySet` / `CollateralRegistrySet` (`:27-28`) are config events — out of scope per
the epic.

`src/dealTokenFactory/DealToken.sol`: OpenZeppelin `ERC20`, `decimals() = 6`, `mint` /
`burn` gated to the immutable `factory`, `_update` reverts unless `from == 0` or `to == 0`.
So the only `Transfer(address indexed from, address indexed to, uint256 value)` logs a
DealToken can emit are mint (`from = 0x0`) and burn (`to = 0x0`). The constructor emits
nothing.

Behaviour that shapes the design:

- `registerDeal` deploys both tokens with `CREATE2` (salt = `loanId`) and emits
  `DealRegistered` in the same tx; no mint happens there.
- `syncDebt` / `syncCargo` are **permissionless** and emit `DebtSynced` / `CargoSynced`
  even when `target == previous` (no mint/burn). When they do move supply, the token's
  `Transfer` is emitted **before** the `*Synced` event in the same tx (lower `log_index`).
- A `syncDebt` can share a block — or, via any multicall, a tx — with the `registerDeal`
  that created the token. So a token's first `Transfer` can land in the same
  `eth_getLogs` chunk as the `DealRegistered` that revealed its address.
- `debtAddress()` / `cargoAddress()` recompute from the *current* `DealToken` creation code
  and must not be used (Issue note). The addresses come only from `DealRegistered`.

**Finding F1 — already deployed on hoodi.** The Issue says the factory is "not yet deployed
on any EVM network"; that is out of date. `pipeline-contracts/deployments/hoodi-v5.json`
(2026-10-08) deploys `PipelineDealTokenFactory` (proxy
`0x2886135EDF68665dC796A33F7723000fe2E0DC81`, implementation
`0x1A50d9165e67637Dd90F677764e97dFd42fC0eF3`). The change still ships dark: no
environment configures an EVM chain in `CHAINS`, and the new key is optional. When hoodi
is enabled, set the factory address together with a start block at or before the hoodi-v5
deploy, so its `DealRegistered` events are indexed (Resolved decision 2).

Stellar counterpart (`pipeline-stellar-contracts/contracts/deal-token-factory/src/event.rs`)
uses the same field names (`loan_id`, `debt`, `cargo`, `target`, `previous`, `minted`,
`clawed`, `burned`), so snake_case of the EVM fields lines up with no renames.

## Cross-arm contract (decided here, for #1482 to mirror)

`contract_logs` rows written by this Issue. `loan_id` and all amounts are **decimal
strings**; EVM addresses are EIP-55 checksummed (Stellar uses Strkey).

| `event_name` | `contract_address` | `params` keys |
|---|---|---|
| `DealRegistered` | factory | `loan_id`, `debt`, `cargo` |
| `DebtSynced` | factory | `loan_id`, `target`, `previous`, `minted`, `clawed` |
| `CargoSynced` | factory | `loan_id`, `target`, `previous`, `minted`, `burned` |
| `DealTokenTransfer` | the DEBT/CARGO token | `loan_id`, `token_kind` (`"debt"` \| `"cargo"`), `token`, `from`, `to`, `amount` |

`DealTokenTransfer.from` is JSON `null` on mint, `to` is JSON `null` on burn (the zero
address is never stored). `token` repeats `contract_address` so consumers need not join on
the column. `amount` is the raw on-chain integer (EVM DealToken is 6-decimals; the
Stellar SAC is 7) — no normalisation at write time, per the existing `contract_logs`
convention (`shared::chains::normalize_usdc_amount` doc).

Why a dedicated `DealTokenTransfer` name rather than `Transfer`/`AssetTransfer`:
`AssetTransfer` consumers (`list_asset_transfers`, `get_wallet_balance_as_of`) filter on
`event_name` without `contract_address` (see `docs/references/backend.md`, ShareTransfer
paragraph); sharing a name would fold deal-token supply into USDC custody balances.

## Scope

### In scope

1. Parsers for `DealRegistered`, `DebtSynced`, `CargoSynced` and DealToken `Transfer`.
2. Optional config `CHAIN_<id>_EVM_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS` (`None` → ships
   dark: no handler, no extra RPC calls, no DB seed query).
3. **Runtime address discovery in `EvmEventPoller`**: a dynamic address source whose set
   grows when a `DealRegistered` log is seen, seeded at startup from already-indexed
   `DealRegistered` rows, with a same-chunk second fetch so a token's `Transfer` in the
   same chunk as its `DealRegistered` is not missed.
4. Additive doc updates (`.env.example`, `docs/references/backend.md`).

### Out of scope

- Any read model / API over these rows (no consumer yet; separate Issue).
- Config events (`LoanRegistrySet`, `CollateralRegistrySet`).
- Backfilling deals registered in blocks the cursor has already passed (no `deal(loanId)` sweep — Resolved decision 2; remedy is a cursor rewind).
- Fixing BUG-26 (malformed/empty EVM address filters) beyond not making it worse — this
  Issue guarantees it never issues an empty-address `eth_getLogs` itself.
- `packages/shared/src/chains.rs`: the epic lists it, but it holds no per-key list —
  `validate_chain_kind_keys` is prefix-based, so `CHAIN_<id>_EVM_INDEXER_*` is covered
  automatically. No change there.

## Assumptions and Risks

- **Merge conflicts with #1483 / #1484.** Both touch `IndexerJobSettings`,
  `EvmContractAddresses`, `register_evm_handlers`, `run_indexer_job`, `.env.example` and
  likely `tests/parsers.rs`. Mitigation: all edits here are additive; new tests go into
  new files; parsers go into a new module rather than the shared `parsers.rs`. Whoever
  merges second rebases.
- **#1484 is also EVM and dark**; neither depends on the other.
- **Empty address filter = every log on the chain** (BUG-26, alloy omits `address` for an
  empty set). The dynamic second fetch must be skipped when the dynamic set is empty or no
  new address was discovered in the chunk.
- **Topic-only decode.** Existing decode closures match on `topic0` only and never check
  `log.address` (BUG-26). `Transfer(address,address,uint256)` is emitted by the sPLUSD
  vault (ERC-4626 is an ERC-20) which is in the static filter — so the DealToken `Transfer`
  decoder **must** return `None` unless `log.address()` is a registered deal token. The
  factory decoders also check `log.address() == factory` (cheap guard, since a discovered
  address enlarges the filter).
- **Address-list size.** Each deal adds two addresses to every `eth_getLogs`. Fine for
  tens–hundreds of loans; providers cap address arrays somewhere in the thousands.
  Logged as a risk, not handled.
- **In-memory registry vs. rolled-back tx.** The registry is updated during `poll()`,
  before the DB tx commits. If the cycle fails, the next retry re-polls the same range;
  the extra registry entries are correct (the same `DealRegistered` will be re-read) and
  harmless. On restart the registry is rebuilt from committed rows only, which is
  consistent with the committed cursor.
- **Seed query has no DB test** (project rule: no DB-backed tests). Keep the SQL trivial
  and push all row interpretation into a pure function that is tested.
- `syncDebt`/`syncCargo` are permissionless, so `*Synced` rows with
  `minted = clawed/burned = 0` will be frequent. Stored as emitted (Resolved decision 4); dedup is per log, not per
  value.

## Resolved decisions (human, 2026-10-14)

1. **Transfer shape confirmed.** `DealTokenTransfer {loan_id, token_kind, token, from, to, amount}`
   is the cross-arm shape; #1482 adopts it unchanged.
2. **No startup `deal(loanId)` sweep.** The registry is seeded only from indexed
   `DealRegistered` rows. Deals registered before the factory is indexed are an accepted,
   documented limitation; operator remedy: set the factory address at deploy time, or
   rewind the chain cursor to at or before the factory's first `registerDeal`. The same rule applies on
   Stellar.
3. **Seed scope.** All `DealRegistered` rows on the chain, regardless of
   `contract_address` (a factory address change keeps watching earlier tokens).
4. **No-op syncs.** `DebtSynced` / `CargoSynced` with `minted = clawed/burned = 0` are
   stored as emitted.
5. **Deployment status (correction).** See Finding F1: the factory is already deployed on
   hoodi; this Issue still ships dark.

## Open Questions

_None_

## Implementation Steps

Comment-less code rule applies: at most a 2–3-line spec-pointer header per new file
(pointing at this plan / `docs/references/backend.md`), no other comments.

1. **Config — `packages/worker/src/indexer/config.rs`**
   - Add `pub deal_token_factory_address: Option<String>` to `IndexerJobSettings`.
   - In `IndexerJobSettings::from_chain_env`, read
     `{ip}DEAL_TOKEN_FACTORY_ADDRESS`; unset or whitespace-only → `None`, else
     `Some(trimmed)`. Mirror the Stellar optional-key pattern
     (`Ok(raw) if !raw.trim().is_empty()`).

2. **Parsers — new `packages/worker/src/indexer/deal_token_parsers.rs`** (register in
   `indexer/mod.rs`). Kept out of `parsers.rs` to avoid sibling conflicts; reuse
   `extract_log_meta` by making it `pub(crate)` in `parsers.rs` (one-word change).
   - `sol!` in `mod deal_token_factory { DealRegistered, DebtSynced, CargoSynced }` and
     `mod deal_token { event Transfer(address indexed from, address indexed to, uint256 value); }`
     with the exact signatures from Ground truth.
   - `pub fn decode_deal_registered(log: &Log) -> Option<(U256, Address, Address)>` —
     returns `(loan_id, debt, cargo)`; used by both the parser and discovery.
   - `pub fn parse_deal_registered(log: &Log) -> Option<ContractLog>`,
     `parse_debt_synced`, `parse_cargo_synced` — `event_name` / `params` per the
     cross-arm table; numbers via `U256::to_string()`, addresses via `to_checksum(None)`.
   - `pub fn parse_deal_token_transfer(log: &Log, info: &DealTokenInfo) -> Option<ContractLog>`
     — `event_name = "DealTokenTransfer"`; `from`/`to` → `Value::Null` when
     `Address::ZERO`; `loan_id` and `token_kind` from `info`; `token` =
     `log.address().to_checksum(None)`; `amount` = `value.to_string()`.

3. **Registry — new `packages/worker/src/indexer/deal_tokens.rs`**
   - `pub enum DealTokenKind { Debt, Cargo }` with `as_str()` → `"debt"` / `"cargo"`.
   - `pub struct DealTokenInfo { pub loan_id: String, pub kind: DealTokenKind }`.
   - `pub struct DealTokenRegistry { factory: Address, tokens: std::sync::RwLock<HashMap<Address, DealTokenInfo>> }`
     with `new(factory)`, `lookup(&Address) -> Option<DealTokenInfo>` (clone),
     `insert_deal(loan_id: String, debt: Address, cargo: Address) -> Vec<Address>`
     (returns only addresses that were not already present),
     `pub fn seed(&self, rows: &[DealRegistrationRow]) -> usize` — parses `debt`/`cargo`
     strings, skips unparseable rows with `tracing::warn!`, returns count inserted.
   - `impl DynamicAddressSource for DealTokenRegistry`:
     `addresses()` → snapshot of keys; `observe(log)` → if `log.address() == factory`
     and `decode_deal_registered(log)` matches, `insert_deal(...)` and return the new
     addresses, else empty.

4. **Seed query — `packages/shared/src/contract_logs_repo.rs`**
   - `pub struct DealRegistrationRow { pub loan_id: String, pub debt: String, pub cargo: String }`.
   - `pub async fn list_deal_registrations(&self, chain_id: i64) -> anyhow::Result<Vec<DealRegistrationRow>>`:
     `SELECT params->>'loan_id', params->>'debt', params->>'cargo' FROM contract_logs
      WHERE chain_id = $1 AND event_name = 'DealRegistered' ORDER BY block_number, log_index`.
     (#1482 can reuse it verbatim — the row shape is the cross-arm contract.)

5. **Poller — `packages/worker/src/indexer/poller.rs`**
   - New trait:
     ```rust
     pub trait DynamicAddressSource: Send + Sync {
         fn addresses(&self) -> Vec<Address>;
         fn observe(&self, log: &Log) -> Vec<Address>;
     }
     ```
   - New `#[async_trait] pub trait LogFetcher: Send + Sync { async fn get_logs(&self, addresses: Vec<Address>, from: u64, to: u64) -> Result<Vec<Log>>; }`,
     implemented for a thin wrapper over the existing `HttpProvider` (the current
     `Filter::new().address(..).from_block(..).to_block(..)` call moves there).
   - Builder: `pub fn add_dynamic_address_source(self, source: Arc<dyn DynamicAddressSource>) -> Self`
     storing `Vec<Arc<dyn DynamicAddressSource>>`; handlers stay as today
     (`add_event_handler` with a static `Vec<Address>`; the deal-token handler is
     registered with an empty static list and filters via the registry itself).
   - Extract the per-chunk fetch into a pure-of-RPC, testable free function:
     ```rust
     pub async fn fetch_chunk_logs(
         fetcher: &dyn LogFetcher,
         static_addresses: &[Address],
         sources: &[Arc<dyn DynamicAddressSource>],
         from: u64,
         to: u64,
     ) -> Result<Vec<Log>>
     ```
     Algorithm:
     a. `first = static_addresses ∪ (every source's addresses())`, deduped; one
        `get_logs(first, from, to)`.
     b. For every non-`removed` log, call `observe` on each source; collect the newly
        discovered addresses.
     c. If the discovered set is non-empty, one more `get_logs(discovered, from, to)`
        (never with an empty list) and append its logs.
     d. Sort the combined vector by `(block_number, log_index)` (missing → `u64::MAX`),
        so `Transfer` precedes its `*Synced` and insert order matches chain order.
   - `EvmEventPoller::poll` keeps its chunk loop and decode loop; it calls
     `fetch_chunk_logs` for each chunk instead of building the filter inline. With no
     dynamic sources, behaviour and RPC count are unchanged.

6. **Handler registration — `packages/worker/src/indexer/evm_parsers.rs`**
   - `EvmContractAddresses` gains `pub deal_token_factory: Option<Address>`.
   - `register_evm_handlers` gains a `deal_tokens: Option<Arc<DealTokenRegistry>>`
     argument (or a field on a new small struct; keep the existing call shape otherwise).
     When both are `Some`:
     - `.add_event_handler(vec![factory], ...)` → guard `log.address() == factory`, then
       `parse_deal_registered(log).or_else(parse_debt_synced).or_else(parse_cargo_synced)`
       → `ContractLogMapper::new(ev, chain_id, repo)`.
     - `.add_event_handler(vec![], ...)` → `registry.lookup(&log.address())` then
       `parse_deal_token_transfer(log, &info)` → `ContractLogMapper`.
       Register this **last** so no existing handler is offered a token log first (none
       decodes `Transfer`, but order keeps it explicit).
     - `.add_dynamic_address_source(registry)`.
   - When the factory is `None`, register nothing new.

7. **Wiring — `packages/worker/src/indexer/mod.rs::run_indexer_job`**
   - If `settings.deal_token_factory_address` is `Some(raw)`: parse with the existing
     `parse_address("DEAL_TOKEN_FACTORY_ADDRESS", raw)?`; build
     `Arc<DealTokenRegistry>`; seed it from
     `contract_logs_repo.list_deal_registrations(chain_id).await?`; log
     `tracing::info!(chain_id, deals = n, "deal-token registry seeded")`.
   - Pass factory + registry into `register_evm_handlers`.

8. **Docs** (see Docs to Update).

9. Run `cargo clippy --all -- -D warnings`, `cargo test -p pipeline-worker`,
   `cargo test -p shared`, and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All pure unit tests in new files under `packages/worker/tests/` — no DB, no env-var DB
URL, no network.

1. **`tests/deal_token_parsers.rs`** — build logs with `SolEvent::encode_*` like
   `tests/parsers.rs::make_log`:
   - `DealRegistered` → `event_name`, `params` exactly
     `{loan_id, debt, cargo}` (assert the full key set, checksummed addresses, decimal
     `loan_id` incl. a value > `u64::MAX`).
   - `DebtSynced` / `CargoSynced` → exact key sets (`clawed` vs `burned`), decimal
     strings, and a no-op sync (`minted = clawed = 0`) still parses.
   - `parse_deal_token_transfer`: mint → `from: null`; burn → `to: null`; `token_kind`
     `"debt"`/`"cargo"`; `token` equals the log address; `amount` decimal string.
   - Each parser returns `None` for another event's log (e.g. `DebtSynced` fed to
     `parse_cargo_synced`, a `WireInRecorded` log fed to all).
2. **`tests/deal_token_registry.rs`**:
   - `observe` on a factory `DealRegistered` returns both addresses and `lookup` yields
     the right `loan_id`/kind; a second identical observe returns empty (idempotent).
   - `observe` on a `DealRegistered`-shaped log from a non-factory address returns empty.
   - `seed` inserts valid rows, skips a row with a malformed address, returns the count.
3. **`tests/evm_dynamic_poll.rs`** — fake `LogFetcher` that records every call's address
   list and returns canned logs filtered by address and block range:
   - No sources → exactly one call, static addresses only (unchanged behaviour).
   - Chunk containing `DealRegistered` (block 10, idx 0) and a DEBT mint `Transfer`
     (block 10, idx 3) → two calls; second call's list is exactly `{debt, cargo}`; result
     contains the `Transfer`, sorted after the `DealRegistered`.
   - Already-seeded registry → one call containing static ∪ token addresses; `Transfer`
     returned.
   - Registry present but empty and no discovery → one call; **no call ever has an empty
     address list** (assert across all scenarios).
   - Merged ordering: a `Transfer` (idx 2) and `DebtSynced` (idx 3) from two fetches come
     out in `(block, log_index)` order.
   - End-to-end decode through `register_evm_handlers`-equivalent closures is covered by
     asserting the deal-token handler returns `None` for an sPLUSD-address `Transfer`
     (not in the registry).
4. **`tests/evm_deal_token_factory_config.rs`** — serialised env mutation (the
   `ENV_LOCK` pattern from `tests/indexer_tuning_overrides.rs`): unset → `None`,
   `"  "` → `None`, a valid address → `Some`. Existing required EVM keys set via a local
   helper.
5. Existing suites (`tests/parsers.rs`, `tests/chain_kind_keys.rs`,
   `tests/indexer_tuning_overrides.rs`) must stay green unchanged.

## Docs to Update

- **`.env.example`** (EVM block, after `CHAIN_1_EVM_INDEXER_MINTER_ADDRESS`), one additive
  line:
  `# CHAIN_1_EVM_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS=  # optional — PipelineDealTokenFactory; set at deploy time; deals registered before the factory is indexed are not discovered — rewind the cursor to recover`.
  #1484 will add its own line next to it — keep it a single line.
- **`docs/references/backend.md`**, Event Indexer section: add a short additive
  sub-paragraph "EVM DealTokenFactory (#1485)" with the cross-arm table above, the
  runtime-discovery mechanism (seed from `DealRegistered` rows + same-chunk second
  fetch), the `null` from/to convention, and the documented limitation (no `deal(loanId)` sweep; set the address at deploy time or rewind the cursor).
  Siblings are editing the Stellar table in the same section; do not touch it.
- **`docs/exec-plans/known-bugs.md` BUG-26**: no edit (behaviour unchanged).
- No product-spec change: no user- or agent-facing behaviour changes; rows have no
  consumer yet.
