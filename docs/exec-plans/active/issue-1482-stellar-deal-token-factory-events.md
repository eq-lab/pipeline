# Issue #1482: Stellar indexer: index deal-token-factory events and DEBT/CARGO token movements

Source: https://github.com/eq-lab/pipeline/issues/1482

Parent epic: #1478. Siblings planned in parallel: #1480 (Stellar minter cash), #1481
(Stellar collateral-registry), #1483 / #1484 / #1485 (EVM arms). **#1485 is the direct EVM
counterpart** and must mirror the `contract_logs` shapes fixed in
[Cross-arm contract](#cross-arm-contract-binding-for-1485) below.

No Figma reference — backend only, no visual verification step.

## Scope

### Contract facts (verified against `pipeline-stellar-contracts@b4d4a57`)

`contracts/deal-token-factory/src/event.rs` + `src/lib.rs` (soroban-sdk 25):

| Event (topic[0]) | topics | data (`ScMap`, keys sorted) |
|---|---|---|
| `deal_registered` | `loan_id: u32` | `cargo: Address`, `debt: Address` |
| `debt_synced` | `loan_id: u32` | `clawed`, `minted`, `previous`, `target`: `i128` |
| `cargo_synced` | `loan_id: u32` | `burned`, `minted`, `previous`, `target`: `i128` |

- `register_deal` (owner-only) emits `deal_registered` with the SAC ids it **stored** — the
  only trustworthy source (`debt_address`/`cargo_address` recompute from the *current*
  issuer, `set_issuers` changes it for future deals). `deal(loan_id)` returns the same
  stored `Deal { cargo, debt }` and panics `Error(Contract, #4)` (`NotRegistered`) otherwise.
- `sync_debt` / `sync_cargo` are permissionless and always emit, even when
  `minted == clawed == 0` / `minted == burned == 0`.
- DEBT/CARGO are classic-asset SACs (`DEBT<nnnn>` / `CARGO<nnnn>`). Supply moves via SAC
  `mint` + `clawback` (DEBT, to/from the loan NFT owner, wrapped in two `set_authorized`
  calls) and `mint` + `burn` (CARGO, factory-held). SAC event shapes (CAP-67, protocol ≥ 23):
  - `mint`: `[mint, to, sep0011_asset]`, data `i128` (or `Map{amount, to_muxed_id}`)
  - `clawback`: `[clawback, from, sep0011_asset]`, data `i128`
  - `burn`: `[burn, from, sep0011_asset]`, data `i128`
  - `transfer`: `[transfer, from, to, sep0011_asset]`, data `i128` (or `Map{amount, ...}`)
  - Pre-CAP-67 `mint`/`clawback` carried an extra leading `admin` topic. The decoder takes the
    **last `Address` topic** for the single-sided events, so it is correct under both layouts.
- Deployed: testnet `CAIBACM665EPLGJTVC4IXWTDV7PTJH7NSLY5TGRDAMHQZX7TCQ74OSIP`, mainnet
  `CBAZFRNDEFOYERDMNLKH3VXVGJHYHBHQSL55WAIUPFVTLZRIVXKMV3UH`
  (`deployments/networks/*/addresses.json`).

### In scope

1. New optional config `CHAIN_<id>_STELLAR_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS` →
   `StellarIndexerSettings.deal_token_factory_id: Option<String>`. `None` ships dark (no
   factory polling, no DB seed query, no token polling, zero extra RPC calls).
2. New parser module `packages/worker/src/indexer/stellar/deal_token_factory_parsers.rs`
   decoding `deal_registered` / `debt_synced` / `cargo_synced` and the DEBT/CARGO SAC
   `mint` / `clawback` / `burn` / `transfer` events.
3. Runtime-discovered token set in `StellarEventPoller`:
   - **Seeded once at startup from the DB only**: every `DealRegistered` row already in
     `contract_logs` for the chain (any emitting factory address), via
     `ContractLogsRepo::list_deal_registrations(chain_id)` — the same query/row shape #1485 adds.
     No on-chain `deal(id)` sweep.
   - **Extended live** from every decoded `DealRegistered` in the current poll range,
     *before* token events for that same range are fetched (two-phase poll).
4. `StellarRpc::get_events` lifted past the 25-contract-id-per-request ceiling
   (5 filters × 5 ids) by splitting into multiple requests — the token set grows by 2 per loan.
5. `ContractLogsRepo::list_deal_registrations` in `packages/shared/src/contract_logs_repo.rs`
   (added here only if #1485 has not merged it first).
6. Docs: `.env.example` line; additive section in `docs/references/backend.md`; tech-debt entry.

### Out of scope

- Any derived table / API / balance projection for deals or token supply. Rows land in
  `contract_logs` only (via `StellarLogMapper`), like `WireIn`.
- Discovering deals the indexer never saw a `DealRegistered` for (registered before the
  start ledger, or outside RPC retention). Their tokens are not tracked — accepted, documented
  limitation; operator remedy: rewind the cursor to before the registration (within RPC
  retention) so the `DealRegistered` is re-indexed.
- Backfilling any history older than Soroban RPC retention — accepted, no backfill. Current
  supply is recoverable from the next `DebtSynced`/`CargoSynced` (`target` is absolute).
- Deduplicating no-op `DebtSynced`/`CargoSynced` — stored as emitted; consumers filter on
  `minted/clawed/burned == "0"` if they want only changes.
- `registries_set`, `issuers_set`, `set_authorized`, `set_admin`, `approve` and other SAC
  admin events (config/role events are out of scope per the epic).
- Amount normalisation: values are stored raw (DEBT at the 7-decimal SAC scale, CARGO in
  raw cargo units), per the `contract_logs` "store raw" rule.
- `packages/shared/src/chains.rs`: no change needed — `validate_chain_kind_keys` is
  prefix-based (`CHAIN_<id>_EVM_…` vs `_STELLAR_…`), so the new key is covered automatically.
  (The Issue lists the file as a possibly-affected area; verified it is not.)

### Cross-arm contract (binding for #1485)

`contract_logs.event_name` / `params` must be identical on both arms. Amounts and ids are
**decimal strings**. Addresses in each arm's native canonical form (Strkey on Stellar; the
EVM arm's existing address format).

| event_name | contract_address | params |
|---|---|---|
| `DealRegistered` | factory | `{ "loan_id", "debt", "cargo" }` |
| `DebtSynced` | factory | `{ "loan_id", "target", "previous", "minted", "clawed" }` |
| `CargoSynced` | factory | `{ "loan_id", "target", "previous", "minted", "burned" }` |
| `DealTokenTransfer` | the DEBT or CARGO token | `{ "loan_id", "token_kind", "token", "from", "to", "amount" }` |

`DealTokenTransfer` semantics (one row per token movement; shape identical to #1485):

- `token_kind`: `"debt"` or `"cargo"`.
- `token`: the token contract id (Strkey `C…` on Stellar) — same value as `contract_address`.
- `loan_id`: from the discovered token set (the token's `DealRegistered`), decimal string.
- `amount`: decimal string at the token's raw scale — **7 decimals on Stellar (SAC)**, 6 on EVM.
- `from` / `to`: **the absent side is JSON `null`** — never a zero address, never omitted:
  - Stellar `mint(to)` → `from: null`; `clawback(from)` / `burn(from)` → `to: null`;
    `transfer(from, to)` → both set.
  - EVM `Transfer(0x0, to, v)` → `from: null`; `Transfer(from, 0x0, v)` → `to: null`.
- Name rationale: a bare `Transfer` would collide in meaning with other token transfers
  already stored under remapped names (`AssetTransfer`, `ShareTransfer`) and would be
  indistinguishable by `event_name` alone — the same reason `ShareTransfer` was not folded
  into `AssetTransfer`. `DealTokenTransfer` keeps the `*Transfer` convention.

## Assumptions and Risks

- **Sibling merge conflicts.** #1480 and #1481 also edit `config.rs`
  (`StellarIndexerSettings`, distinctness `roles`), `stellar/parsers.rs` (`dispatch_parser`
  signature + ladder), `stellar/poller.rs` (`contract_ids`, constructor), `stellar/mod.rs`,
  `.env.example` and `docs/references/backend.md`. Changes here are kept additive (one new
  `Option` param / field / branch each) so rebases are mechanical. Whoever merges second
  re-threads the extra `dispatch_parser` argument through `tests/stellar_parsers.rs`.
- **RPC load scales with deals.** Phase 2 issues `ceil(2·N / 25)` paginated `getEvents`
  requests per poll for N registered deals. When caught up, `index_once` polls only when a
  new ledger closes (~5 s), so 100 deals ≈ 8 small requests per ledger — acceptable now.
  Logged as tech debt with the cheaper alternatives (topic filters on the factory address for
  CARGO; pruning tokens of closed loans whose DEBT synced to 0).
- **Shared repo method with #1485.** Both arms need
  `ContractLogsRepo::list_deal_registrations(chain_id)` + `DealRegistrationRow { loan_id,
  debt, cargo }` (all `String`). Whichever PR merges first adds it in
  `packages/shared/src/contract_logs_repo.rs`; the other rebases and reuses it verbatim (the
  SQL is chain-agnostic: `params->>'loan_id' / 'debt' / 'cargo'` of all `DealRegistered`
  rows for the chain, `ORDER BY block_number, log_index`). It does **not** filter by factory
  address — tokens of a superseded factory deployment stay tracked, by decision.
- **Deals the indexer never saw** (registered before the start ledger or outside RPC
  retention) have untracked tokens — accepted limitation; remedy is a cursor rewind.
- **Startup DB failure.** The seed query runs once in `run_stellar_indexer_job`; an `Err`
  aborts the Stellar indexer task (same as the cursor-seed path), so it never runs with a
  silently empty token set.
- **History older than RPC retention** (≈ 7 days on public nodes) is not indexed — accepted.
- `synthesise_log_index` caps at 100 events per op; `sync_debt` emits 4
  (`set_authorized`, `mint|clawback`, `set_authorized`, `debt_synced`) — fine.
- The two-phase poll is correct only because a token cannot move before its
  `register_deal` sets the factory as SAC admin and records it; a classic issuer payment
  before registration would be missed — irrelevant (the factory owns the asset lifecycle).

## Resolved decisions (human, 2026-10-14)

1. Token-movement row = the #1485 shape exactly: `event_name = "DealTokenTransfer"`,
   `contract_address` = token, params `{loan_id, token_kind: "debt"|"cargo", token: <token
   contract id>, from: null|addr, to: null|addr, amount}` (`amount` decimal string, raw SAC
   scale = 7 decimals; EVM is 6). Mint → `from: null`; clawback/burn → `to: null`; transfer →
   both set.
2. Seeding: no on-chain `deal(id)` sweep and no factory/registry reader. Known tokens come only
   from `DealRegistered` rows already in the DB (all rows on the chain, any factory address),
   via `ContractLogsRepo::list_deal_registrations(chain_id)` shared with #1485, plus runtime
   growth from newly indexed `DealRegistered`. Deals registered before the indexer saw them are
   an accepted, documented limitation (operator remedy: rewind the cursor).
3. History older than Soroban RPC retention: accepted, no backfill.
4. No-op `debt_synced` / `cargo_synced` are stored as emitted.

## Open Questions

_None_

## Implementation Steps

1. **Config** — `packages/worker/src/indexer/config.rs`
   - Add `pub deal_token_factory_id: Option<String>` to `StellarIndexerSettings` (after
     `yield_minter_id`).
   - In `from_chain_env`, read `{ip}DEAL_TOKEN_FACTORY_ADDRESS`; blank/unset → `None`;
     otherwise `validate_contract_id` **and** `stellar_strkey::Contract::from_string` (same
     strict pattern as `MINTER_ADDRESS`, lines 117–130), error message naming the key.
   - Push `("DEAL_TOKEN_FACTORY_ADDRESS", id)` into the distinctness `roles` list.
   - Set the field in the `Ok(Self { … })` literal.

2. **RPC: requests beyond 25 ids** — `packages/worker/src/indexer/stellar/rpc.rs`
   - Add `pub const MAX_CONTRACT_IDS_PER_REQUEST: usize = 25;` and a pure
     `pub fn chunk_contract_ids_per_request(ids: &[String]) -> Vec<Vec<String>>` (chunks of
     ≤ 25; empty input → empty output).
   - Refactor `get_events`: move the existing paginated loop into a private
     `get_events_single(start, end, ids: &[String])`; `get_events` iterates the chunks,
     concatenates events, returns `max` of each chunk's `latestLedger` (or `end_ledger` when
     there are no chunks — an empty id list must issue **no** request).
   - Existing callers are unaffected (≤ 25 ids → exactly one request, same as today).

3. **Seed query (shared with #1485)** — `packages/shared/src/contract_logs_repo.rs`
   - If #1485 has not merged yet, add exactly what its plan specifies:
     `pub struct DealRegistrationRow { pub loan_id: String, pub debt: String, pub cargo: String }`
     and `pub async fn list_deal_registrations(&self, chain_id: i64) ->
     anyhow::Result<Vec<DealRegistrationRow>>` running
     `SELECT params->>'loan_id', params->>'debt', params->>'cargo' FROM contract_logs
      WHERE chain_id = $1 AND event_name = 'DealRegistered' ORDER BY block_number, log_index`
     (no `contract_address` filter — all factories on the chain). If #1485 merged first, reuse
     it unchanged. No new reader, no on-chain sweep.

4. **Parsers** — new `packages/worker/src/indexer/stellar/deal_token_factory_parsers.rs`
   (one 2–3-line spec-pointer header, no other comments, per AGENTS.md).
   - Types:
     ```rust
     #[derive(Clone, Copy, Debug, PartialEq, Eq)]
     pub enum DealTokenKind { Debt, Cargo }          // as_str(): "debt" / "cargo"
     #[derive(Clone, Debug, PartialEq, Eq)]
     pub struct DealTokenRef { pub loan_id: String, pub kind: DealTokenKind }
     #[derive(Default)]
     pub struct DealTokenSet { /* HashMap<String, DealTokenRef> */ }
     ```
     `loan_id` is the decimal string as stored, matching `DealRegistrationRow` and #1485's
     `DealTokenInfo`.
     `DealTokenSet::{insert_deal(loan_id, debt, cargo) -> usize (newly added),
     seed(&[DealRegistrationRow]) -> usize, get(&str) -> Option<DealTokenRef>,
     contract_ids() -> Vec<String> (sorted, deterministic), len(), is_empty(),
     absorb_deal_registered(&StellarLog) -> bool}`. `seed` skips (with `tracing::warn!`) rows
     whose `debt`/`cargo` is not a valid `C…` Strkey (e.g. an EVM-shaped row on a mis-typed
     chain) and returns the count inserted. `absorb_deal_registered` reads
     `params.loan_id/debt/cargo` of a `DealRegistered` log and inserts; `false` for any other
     log or malformed params.
   - `parse_deal_registered(raw)`: `event_name == "deal_registered"`, `topics.len() >= 2`,
     `loan_id = extract_u32(topics[1])`, `debt`/`cargo` via `extract_address_from_map` →
     `StellarLog { event_name: "DealRegistered", params: {loan_id: "<n>", debt, cargo} }`.
   - `parse_debt_synced(raw)` → `"DebtSynced"`, params `loan_id`, `target`, `previous`,
     `minted`, `clawed` (all `extract_i128_from_map(...).to_string()`).
   - `parse_cargo_synced(raw)` → `"CargoSynced"`, params `loan_id`, `target`, `previous`,
     `minted`, `burned`.
   - `parse_deal_token_movement(raw, token: &DealTokenRef) -> Option<StellarLog>`:
     - `"mint"`: `to` = last `Address` topic in `topics[1..]`; `from = null`.
     - `"clawback"` | `"burn"`: `from` = last `Address` topic in `topics[1..]`; `to = null`.
     - `"transfer"`: `topics.len() >= 3`, `from = topics[1]`, `to = topics[2]`.
     - anything else (`set_authorized`, `set_admin`, `approve`, …) → `None`.
     - `amount = extract_i128(value).or_else(|| extract_i128_from_map(value, "amount"))`.
     - `StellarLog { contract_address: raw.contract_id, event_name: "DealTokenTransfer",
       params: {loan_id: "<n>", token_kind: "debt"|"cargo", token: raw.contract_id, from, to,
       amount: "<i128>"} }` with `serde_json::Value::Null` for the absent side. `amount` is raw
       (7-decimal SAC scale), not normalised.
   - `pub fn route_deal_token_events(raws: &[RawEvent], set: &DealTokenSet) -> Vec<StellarLog>`
     — the pure phase-2 routing (unknown contract id → `warn!` + skip; non-movement → skip).
   - Constant `pub const DEAL_TOKEN_FACTORY_EVENT_TOPICS: [&str; 3] = ["deal_registered",
     "debt_synced", "cargo_synced"]` for the warn guard below.
   - Register in `stellar/mod.rs` (`pub mod deal_token_factory_parsers;`) and update the
     module doc list.

5. **Dispatch** — `packages/worker/src/indexer/stellar/parsers.rs`
   - Add trailing param `deal_token_factory_id: Option<&str>` to `dispatch_parser`.
   - New branch before the `asset_id` branch: when `deal_token_factory_id ==
     Some(raw.contract_id)`, try `parse_deal_registered` → `parse_debt_synced` →
     `parse_cargo_synced`; if `None` **and** `raw.event_name` is one of the three topics,
     `tracing::warn!` with the same "recognised by name but not decodable" message pattern as
     the minter branch. Admin events (`registries_set`, `issuers_set`, ownable/upgrade) fall
     through as `None` silently.
   - Token events are **not** routed through `dispatch_parser` (they come from a separate
     request, see step 6), so the `else` "unexpected contract" warning stays meaningful.

6. **Poller** — `packages/worker/src/indexer/stellar/poller.rs`
   - New fields: `deal_token_factory_id: Option<String>`,
     `deal_tokens: std::sync::Mutex<DealTokenSet>` (never hold the lock across `.await`).
   - `poll(from, to)`:
     1. Phase 1 (unchanged list + factory id): `get_events`, `dispatch_parser(…,
        self.deal_token_factory_id.as_deref())`. For each decoded log with
        `event_name == "DealRegistered"`, call `absorb_deal_registered(&log)` before pushing
        its `StellarLogMapper` (factory rows go down the existing `else` →
        `StellarLogMapper::new` branch).
     2. Phase 2 (only if the factory is configured and the set is non-empty): snapshot
        `contract_ids()` under the lock, release it, `get_events(from, to, &EventFilter {
        contract_ids })` (batched by 25 in step 2), then `route_deal_token_events` under the
        lock → `StellarLogMapper::new` for each.
     - A failed poll after phase 1 leaves the newly absorbed tokens in the set; the retry of
       the same range is idempotent (`is_duplicate`), so this is harmless.
   - `run_stellar_indexer_job`: when `settings.deal_token_factory_id` is `Some`, build a
     `ContractLogsRepo` (reuse the one built for the loan mapper if present), call
     `list_deal_registrations(chain_id).await?`, `DealTokenSet::seed(&rows)`, log
     `info!(chain_id, deals = n, "Stellar deal-token set seeded from contract_logs")`, and
     pass the factory id + set into `StellarEventPoller::new`. When `None`, no query runs and
     the set stays empty.

7. **Env example** — `.env.example`: one line after the `MINTER_ADDRESS` line (line 128):
   `# CHAIN_99000001_STELLAR_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS=CAIBACM665EPLGJTVC4IXWTDV7PTJH7NSLY5TGRDAMHQZX7TCQ74OSIP   # optional — DealRegistered/DebtSynced/CargoSynced + per-deal DEBT/CARGO movements`

8. **Lint** — `cargo clippy --all -- -D warnings`; `cargo fmt --all`;
   `npx tsx scripts/lint-docs.ts` (docs touched).

## Test Strategy

Pure unit tests only, in external files under `packages/worker/tests/` (no inline
`#[cfg(test)]`, no DB, no env-var DB URLs, no live RPC). ScVal fixtures built with the same
local encode helpers style as `tests/stellar_parsers.rs`.

1. **`tests/stellar_deal_token_parsers.rs`** (new)
   - `deal_registered` decodes to `DealRegistered` with `loan_id` as `"42"` and the two
     Strkeys; wrong topic name / missing topic / missing map key → `None`.
   - `debt_synced` / `cargo_synced` decode all four amounts as decimal strings, including a
     no-op sync (`minted = clawed = 0`) and a value > `u64::MAX` to prove i128 handling.
   - `parse_deal_token_movement`:
     - CAP-67 `mint` `[mint, to, "DEBT0042:G…"]` → `from: null`, `to`, `amount`,
       `token_kind: "debt"`, `token` = the emitting contract id.
     - legacy `mint` `[mint, admin, to, asset]` → `to` is the *last* address, not `admin`.
     - `clawback` (both layouts) → `to: null`; CARGO `burn` → `to: null`, `token_kind: "cargo"`.
     - `transfer` → both sides; `Map { amount }` value variant decodes.
     - `set_authorized` / `set_admin` → `None`.
     - Assert the exact `params` key set `{loan_id, token_kind, token, from, to, amount}`
       (cross-arm guard with #1485) and that `amount` > `u64::MAX` round-trips as a string.
   - `DealTokenSet`: `absorb_deal_registered` inserts both ids with the right kind; ignores
     non-`DealRegistered` logs; `contract_ids()` is sorted and deduplicated; re-insert is
     idempotent; `seed` from hand-built `DealRegistrationRow`s (rows from two different
     factories both load; a `0x…` EVM address row is skipped and not counted).
   - `route_deal_token_events`: known ids decoded, unknown ids skipped, non-movement events
     skipped.
   - `dispatch_parser` with the factory id routes the three events; an undecodable
     `debt_synced` returns `None`; with `deal_token_factory_id = None` the factory contract
     falls to the unexpected-contract branch (`None`).
2. `list_deal_registrations` is a SQL query and is **not** unit-tested (no DB in tests, per
   the project rule); its row shape is exercised through `DealTokenSet::seed`.
3. **`tests/stellar_rpc.rs`** — `chunk_contract_ids_per_request`: 0 → none, 25 → one chunk,
   26 → `[25, 1]`, 60 → `[25, 25, 10]`; each chunk still yields ≤ 5 filters of ≤ 5 ids
   through `build_contract_filters`.
4. **`tests/stellar_config.rs`** — `DEAL_TOKEN_FACTORY_ADDRESS` unset/blank → `None`; valid →
   `Some`; bad Strkey CRC → error naming the key; duplicate of another role → distinctness
   error. Follow that file's existing env-isolation pattern.
5. **`tests/stellar_parsers.rs`** — update existing `dispatch_parser` call sites for the new
   argument (pass `None`); no behaviour change expected.
6. Full suite via the `test-fast` skill (`cargo test -p pipeline-worker`, clippy, docs lint).

## Docs to Update

- `docs/references/backend.md` — **additive** new paragraph + table right after the minter
  paragraph ending "…admin setters — are not collected yet." (do not edit the minter table,
  which #1480 owns): the three factory events, `DealTokenTransfer` with the null-side rule,
  the enabling key `CHAIN_<id>_STELLAR_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS`, seeding of the
  token set from existing `DealRegistered` rows only, the two-phase poll, no-op syncs stored
  as emitted, `amount` at raw 7-decimal SAC scale, and the limitations: deals registered
  before the indexer saw them are not tracked (remedy: rewind the cursor), no history beyond
  RPC retention.
- `.env.example` — step 7.
- `docs/exec-plans/tech-debt-tracker.md` — one entry: per-deal `getEvents` fan-out grows
  linearly with registered deals; alternatives (topic filter on factory address for CARGO,
  pruning closed-loan tokens).
- No product-spec change: indexer-internal, no user- or agent-facing behaviour.
