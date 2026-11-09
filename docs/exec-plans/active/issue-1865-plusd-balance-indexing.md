# Issue #1865: Backend: index PLUSD token movements (EVM Transfer + Stellar SAC) and serve the LP's PLUSD balance history

Source: https://github.com/eq-lab/pipeline/issues/1865

Parent epic: #1247. Split out of #1313 (human decision 2026-11-09). #1313 shipped `splusd_value`,
`wire_out_escrow` and `total_balance` on `GET /v1/positions/history` and reserved `plusd_balance`;
this issue indexes PLUSD and serves that field. The design reuses the "Split out to #1865" section
of `docs/exec-plans/completed/issue-1313-lp-composite-balance.md`. Where this plan differs from
that section, it says so and gives the reason.

## Scope

### What changes

1. **Indexing.** Every PLUSD balance movement becomes one `contract_logs` row with
   `event_name = 'PlusdTransfer'` and
   `params = { kind: "transfer"|"mint"|"burn"|"clawback", from: <addr>|null, to: <addr>|null, amount: "<raw integer>" }`.
   - EVM: the ERC-20 `Transfer` event of the PLUSD proxy.
   - Stellar: the PLUSD SAC's `transfer`, `mint`, `burn` and `clawback` events.
   - Indexing is off until the new per-chain indexer key is set:
     `CHAIN_<id>_EVM_INDEXER_PLUSD_ADDRESS` / `CHAIN_<id>_STELLAR_INDEXER_PLUSD_ADDRESS`.
   - Rows carry no running balance. The balance is folded when it is read, so cursor rewinds and
     replays are harmless.
2. **API.** `GET /v1/positions/history` serves an optional `plusd_balance` per bucket and adds it to
   `total_balance`.
   - It is gated by a new optional key, `CHAIN_<id>_<EVM|STELLAR>_API_PLUSD_ADDRESS`, which must
     equal the indexer key.
   - A negative running balance, an overflow or a malformed amount omits the term for the whole
     response and logs a `warn`.
   - No new route and no new query parameter.
3. **Coverage.**
   - Stellar testnet (99000001) and mainnet (99000002) keep the API key **unset**, so the term is
     off there. Their PLUSD SACs predate both the new indexer key and Soroban RPC retention (about
     7 days).
   - EVM chains turn it on after the shared EVM cursor is rewound to the PLUSD deploy block.
   - A tech-debt entry and a follow-up issue cover the Stellar starting-balance seed (see below).
4. **Migration (additive).** One partial GIN index for the `@>` holder lookup.

### Research findings (what the design rests on)

**Stellar SAC events in the indexer today**
- `JOB_INDEXER_STELLAR_ASSET_ID` (USDC) goes through `dispatch_parser` and is decoded to
  `AssetTransfer` by `parse_transfer_as`.
  - It handles `transfer` only: topics `[transfer, from, to, asset?]`, with the value as a plain
    `i128` or the muxed map `{amount, to_muxed_id}`.
  - The poller then keeps only rows that touch the withdrawal-queue wallet, or rows between two
    custody/ramp addresses.
  - `mint`, `burn` and `clawback` are never decoded for the asset.
- Deal tokens (`DealTokenTransfer`) are fetched in a **separate** `getEvents` call that contains
  only the deal-token ids, and they are routed by contract id (`route_deal_token_events`).
  - `parse_deal_token_movement` already decodes all four SAC topics.
  - It uses the last address topic for `mint`, `burn` and `clawback`. This covers the CAP-67
    layout (`[mint, to, asset]`, `[clawback, from, asset]`) and the legacy layout
    (`[mint, admin, to, asset]`).
- Topic names are generic (`transfer`, `mint`, `burn`), so routing is safe only by contract id.
  - In the main call, `dispatch_parser` commits to the first contract-id match.
  - The config therefore refuses duplicate role ids (`StellarIndexerSettings::from_chain_env`).
  - PLUSD joins that check. It is routed in `poll` before `dispatch_parser`, the same way the
    pocket and security-registry contracts are.
- `sc_address_to_strkey` returns `None` for `ClaimableBalance`, `LiquidityPool` and `MuxedAccount`
  addresses.
  - Under CAP-67 (protocol 23), classic PLUSD operations also emit SAC events, and such an address
    can be the counterparty.
  - If the counterparty is dropped, the LP side goes missing too. So the PLUSD decoder encodes
    those addresses as strkeys: `B…`, `L…`, and the base `G…` for a muxed account. The
    `stellar-strkey` 0.0.13 crate already has `ClaimableBalance` and `LiquidityPool`.

**EVM ERC-20 handling today**
- `asset_transfers.rs` registers USDC with `add_filtered_event_handler`, using address +
  `Transfer` topic0 (+ topic1/topic2) filters. It never issues an address-only `eth_getLogs`.
  - Its decoder checks `log.address() == asset`.
  - Handlers are "first match wins", so every decoder must check the emitting address.
- Deal tokens use a dynamic address source (`DealTokenRegistry`). `deal_token_parsers::side()`
  already maps `0x0` to JSON `null` and writes other addresses as EIP-55.
- EVM `contract_logs.contract_address` is EIP-55 (`insert_log`), and transfer params are EIP-55
  too. PLUSD rows follow the same convention.
- `PipelineUSD.sol` is an OpenZeppelin `ERC20PausableUpgradeable`, so every mint, burn and
  transfer emits `Transfer`.

**How PLUSD reaches or leaves an LP wallet** (frozen contracts `pipeline-stellar-contracts@e9881ac`
and `pipeline-contracts`)

| Flow | On-chain PLUSD movement | Effect on the LP's `plusd_balance` |
|---|---|---|
| Minter `record_wire_in` to an LP | `mint` to the minter, then `transfer` minter → vault (`stake_for`) | none (it shows up as sPLUSD shares) |
| Minter `assign_wire_in` | `transfer` minter → vault | none |
| DepositManager `claim_request` | AccessManager relays `mint` to `request.user`; the PLUSD SAC emits it | **+amount** |
| sPLUSD stake (`deposit` / `mint`) | `transfer` LP → vault | **−amount** |
| sPLUSD unstake (`withdraw` / `redeem`) | `transfer` vault → receiver | **+amount** |
| WithdrawalQueue `request_withdrawal` | `transfer` LP → WQ; a later claim burns the WQ's own PLUSD | **−amount** (Q3: queue PLUSD is not in the total) |
| Minter `request_wire_out` / `cancel_wire_out` / `settle_wire_out` | `transfer` LP → minter / minter → LP / `burn` from the minter | −amount / +amount / none. `wire_out_escrow` moves the opposite way, so `total_balance` stays continuous |
| Pocket `claim` | `transfer` pocket → holder | **+paid** |
| Peer-to-peer or classic payments (CAP-67) | `transfer` / `mint` / `burn` / `clawback` | ± |

AccessManager is not indexed (human decision), and it does not need to be: the PLUSD SAC itself
emits the event for the mint the AccessManager relays. Record NFTs are not indexed.

**API today**
- `routes/pnl.rs::get_position_history` and `total_balance.rs` (#1313) contain:
  - `fold_escrow(steps, interval)`: a per-event `checked_add` fold that returns `None` when the
    running value goes negative. It is generic, and the PLUSD fold reuses it.
  - `escrow_outcome`;
  - `composite_window_start(first_position, first_escrow)`;
  - the `Carry` / `walk_grid` grid walk;
  - `fmt6` rounding.
- The vault row carries `asset_decimals`, which are the PLUSD decimals (7 on Stellar, 6 on EVM).
- `LP_WIRE_OUT_EVENTS_SQL` matches the wallet with `params @> jsonb_build_object('lp', $3::text)`,
  served by the `idx_contract_logs_params` GIN index (`jsonb_ops`).

### Departures from the #1313 split-out section

- **No `LOWER(params->>'from'|'to')` btree indexes.**
  - The holder lookup uses `@>`, as the rule requires. The API builds the exact stored form of the
    wallet (EIP-55 on EVM, uppercase strkey on Stellar), so no `LOWER()` is needed.
  - The additive migration adds a **partial GIN** index instead:
    `USING GIN (params jsonb_path_ops) WHERE event_name = 'PlusdTransfer'`. It serves exactly
    that `@>` lookup, and it stays smaller than the all-events GIN index, whose posting lists for
    a wallet value include every event of that wallet.
- **Per-event steps instead of per-bucket SQL sums.**
  - The read returns one signed row per PLUSD movement, and Rust folds them with the existing
    `fold_escrow`. An intra-bucket dip below zero (missed history) is therefore caught as well,
    not only a negative bucket close.
  - The SQL is a `pub const`, and its amount guard `'^[0-9]{1,39}$'` is still applied.
  - An LP has few PLUSD movements (claims, stakes, wire-outs), so the row count is small.

### Out of scope

- The Stellar starting-balance seed: a follow-up issue (see "Follow-up: PLUSD balance seed").
- A `plusd_balance` `SeriesStat` on the response. The chart Y-axis binds `total_balance`, so no
  new stat is added.
- Frontend binding: #1282 and #1629.
- Queue and deposit PLUSD (Q3), and `pending_bank_deposits` (#1285).
- AccessManager and record-NFT indexing.
- Any contract change.

## Assumptions and Risks

- **Coverage is the whole correctness story.**
  - A missed movement turns into a confident wrong line. The negative guard catches only missed
    *credits* before debits. A missed debit, or a missed early credit when no debit follows,
    passes silently.
  - Hence the operational rule: set the API key only after the indexer has covered the PLUSD
    contract from its deploy block or ledger. The user-stories acceptance check verifies this
    against on-chain `balance` / `balanceOf`.
- **The EVM rewind re-reads every handler.**
  - The EVM cursor is shared per chain (`log_collector_state`). Rewinding it to the PLUSD deploy
    block re-fetches all of that chain's logs.
  - Already-stored rows are skipped by `is_duplicate` and the `UNIQUE (chain_id, contract_address,
    block_number, log_index)` constraint.
  - This is the existing documented cursor rule. It is an ops step, not code.
- **Stellar testnet and mainnet stay off.**
  - The testnet PLUSD SAC (`CDGHLVGY…`) and the mainnet PLUSD SAC (`CD5CFMJ4…`, deployment #37)
    both predate the new key and RPC retention, so the term is off on both chains.
  - The indexer key may still be set there. Rows then accumulate from the cursor onward, ready for
    the seed follow-up.
- **CAP-67 classic events depend on the RPC.**
  - Classic PLUSD payments are visible to `getEvents` only if the Soroban RPC provider emits
    unified classic events (protocol 23+, with core's classic-event emission on).
  - Contract-driven flows (DM mint, stake, wire-out, pocket claim) are Soroban events and are
    always visible.
  - The coder confirms classic-payment visibility on testnet (Test Strategy, manual step 3). If
    they are not visible, record it in the tech-debt entry, because the acceptance check would
    then fail for a wallet that moved PLUSD classically.
- **Deal-token set overlap.** If a `DealRegistered` ever named the PLUSD id, PLUSD events would be
  fetched twice. The poller drops the PLUSD id from the deal-token `getEvents` list as a one-line
  guard. The second copy would also be skipped by `is_duplicate` within the same transaction.
- **Stellar `log_index` synthesis.**
  - `record_wire_in` emits `mint` and `transfer` in one operation. They are distinct by
    `event_index_in_op`, so the unique key holds.
  - The existing synthesis caveat (more than 100 events per op) applies unchanged.
- **The read-path wallet form must match the stored form.**
  - EVM: `normalise_wallet` lowercases, so the API re-derives EIP-55 with
    `alloy::primitives::Address`. A wallet that does not parse omits the term.
  - Stellar: an uppercase `G…` strkey.
- **Query cost.** One extra concurrent read per request, served by the partial GIN index. It runs
  on full history, with no `since` filter, by design.
- **Dependency.** #1313 has merged (`04bd500b`). Nothing else is open that blocks this.

## Open Questions

_None_

### Resolved (human, 2026-11-09)

- Plan approved as written. The per-holder Stellar seed is follow-up #1878 (TD-176); the term stays off on 99000001 / 99000002 until it lands.

## Implementation Steps

All new code is comment-less, with at most one `// spec:` header per new file pointing at
`docs/product-specs/lp-total-balance.md` (API) or `docs/references/backend.md#plusd-transfer-indexing`
(worker and shared). Numbers are served as plain strings. SQL is defined as `pub const`.

1. **Spec and reference docs first** (see Docs to Update). Write the behavior before the code.

2. **Shared helper for SAC movements** (`packages/worker/src/indexer/stellar/parsers.rs`).
   - Add `pub fn sac_holder_strkey(addr: &ScAddress) -> Option<String>`:
     - `Account` → `G…`;
     - `Contract` → `C…`;
     - `MuxedAccount` → the base `G…`;
     - `ClaimableBalance` → `B…`;
     - `LiquidityPool` → `L…`.
     It uses `stellar_strkey::Strkey` types. Also add an `extract_sac_holder(b64)` wrapper.
   - Add `pub fn decode_sac_movement(raw: &RawEvent) -> Option<(&'static str, Option<String>, Option<String>, i128)>`,
     which returns `(kind, from, to, amount)`:
     - `transfer`: `topics[1]`, `topics[2]`;
     - `mint`: the last holder topic as `to`;
     - `burn` / `clawback`: the last holder topic as `from`;
     - amount: `extract_i128`, or else `extract_i128_from_map(.., "amount")`;
     - reject `amount < 0`.
   - Move the logic of `parse_deal_token_movement` onto this decoder. Deal tokens then accept the
     wider address set too. That set is a strict superset of today's, so the existing
     `stellar_deal_token_parsers.rs` tests stay green. Drop the private `last_address_topic` in
     `deal_token_factory_parsers.rs`.

3. **Stellar PLUSD parser** (new `packages/worker/src/indexer/stellar/plusd_parsers.rs`, and
   `pub mod` in `stellar/mod.rs`).
   - `pub const PLUSD_EVENT_TOPICS: [&str; 4] = ["transfer", "mint", "burn", "clawback"];`
   - `pub fn parse_plusd_event(raw: &RawEvent) -> Option<StellarLog>`:
     - `decode_sac_movement`, then a `StellarLog` with `event_name = "PlusdTransfer"`,
       `contract_address = raw.contract_id`, the synthesised `log_index`, and params
       `{kind, from, to, amount: amount.to_string()}`.
   - `pub fn dispatch_plusd(raw: &RawEvent) -> Option<StellarLog>`:
     - calls `parse_plusd_event`;
     - when that returns `None` and `raw.event_name` is in `PLUSD_EVENT_TOPICS`, logs a `warn`
       ("recognised by name but not decodable");
     - other SAC topics (`approve`, `set_authorized`, `set_admin`) return `None` silently.

4. **Stellar config** (`packages/worker/src/indexer/config.rs`).
   - `StellarIndexerSettings` gains `pub plusd_id: Option<String>`, read from
     `CHAIN_<id>_STELLAR_INDEXER_PLUSD_ADDRESS`. It uses the same `validate_contract_id` and
     `stellar_strkey::Contract::from_string` pattern as `POCKET_ADDRESS`.
   - Push `("PLUSD_ADDRESS", id)` into the distinct-roles check. It must differ from `ASSET_ID`,
     `STAKED_PLUSD_ADDRESS` and every other role.

5. **Stellar poller** (`packages/worker/src/indexer/stellar/poller.rs`).
   - Add a `plusd_id: Option<String>` field and constructor argument.
   - Push the id into `contract_ids`.
   - In the routing ladder, add `else if self.plusd_id.as_deref() == Some(raw.contract_id.as_str()) { dispatch_plusd(&raw) }`
     before `dispatch_parser`.
   - The `PlusdTransfer` log goes to the plain `StellarLogMapper::new` branch. It needs no new
     branch, since the name is not `AssetTransfer` and not a loan event.
   - Filter `plusd_id` out of `token_ids` before the deal-token `getEvents`.
   - Add an info log "Stellar PLUSD transfer indexing enabled" in `run_stellar_indexer_job`.

6. **EVM PLUSD transfers** (new `packages/worker/src/indexer/plusd_transfers.rs`, with `pub mod`
   in `indexer/mod.rs`).
   - `pub fn plusd_transfer_filter(plusd: Address) -> Filter`: `.address(plusd).event_signature(Transfer::SIGNATURE_HASH)`.
     Reuse the `Transfer` `sol!` from `asset_transfers.rs` by making it `pub`.
   - `pub fn parse_plusd_transfer(log: &Log, plusd: Address) -> Option<ContractLog>`:
     - check the address, then `Transfer::decode_log`;
     - `kind` is `mint` when `from == 0x0`, `burn` when `to == 0x0`, otherwise `transfer`;
     - `from` / `to` go through `deal_token_parsers::side` (make it `pub(crate)`), which gives
       `null` or EIP-55;
     - `amount` is `value.to_string()`;
     - `event_name` is `"PlusdTransfer"`.
   - `pub fn reject_plusd_collision(chain_id, plusd, roles: &[(&str, Address)]) -> Result<()>`
     bails with `CHAIN_<id>_EVM_INDEXER_PLUSD_ADDRESS must not equal …`.
   - `pub fn register_plusd_transfer_handler(builder, chain_id, plusd, repo)` uses
     `add_filtered_event_handler(vec![filter], …)` with `ContractLogMapper::new`.
   - Config: `IndexerJobSettings` gains `pub plusd_address: Option<Address>`, from
     `CHAIN_<id>_EVM_INDEXER_PLUSD_ADDRESS` via `env_nonblank` + `parse_evm_address`.
   - `run_indexer_job`:
     - when it is set, call `reject_plusd_collision` against `core_roles` (which already includes
       `DEAL_TOKEN_FACTORY_ADDRESS` when set) plus `("ASSET_ADDRESS", tracking.asset)` when asset
       tracking is on;
     - log an info line;
     - register the handler after the asset handler.

7. **Migration** (new `packages/shared/migrations/20261109000001_plusd_transfer_params_index.sql`).
   - Header comments: purpose, a spec pointer, and the rollback `DROP INDEX IF EXISTS …`.
   - Body:
     `CREATE INDEX IF NOT EXISTS idx_contract_logs_plusd_transfer_params ON contract_logs USING GIN (params jsonb_path_ops) WHERE event_name = 'PlusdTransfer';`
   - Before naming the file, check that no other in-flight branch uses the same timestamp prefix.

8. **Holder steps read** (`packages/shared/src/contract_logs_repo.rs`).
   - Add `pub const PLUSD_HOLDER_STEPS_SQL: &str`:
     ```sql
     SELECT block_timestamp,
            CASE WHEN params->>'amount' ~ '^[0-9]{1,39}$' THEN params->>'amount' END AS amount,
            params @> jsonb_build_object('to', $3::text) AS incoming,
            params @> jsonb_build_object('from', $3::text) AS outgoing
       FROM contract_logs
      WHERE chain_id = $1
        AND contract_address = $2
        AND event_name = 'PlusdTransfer'
        AND (params @> jsonb_build_object('to', $3::text)
             OR params @> jsonb_build_object('from', $3::text))
      ORDER BY block_number, log_index
     ```
   - Add `#[derive(sqlx::FromRow)] pub struct PlusdStepRow { block_timestamp: i64, amount: Option<String>, incoming: bool, outgoing: bool }`
     and `ContractLogsRepo::list_plusd_holder_steps(chain_id, plusd, holder)`.

9. **API config** (`packages/api/src/config.rs`, `lib.rs`, `main.rs`).
   - Add `load_plusd_address(chain_id, kind, &mut plusd_addresses)`. It reads
     `CHAIN_<id>_EVM_API_PLUSD_ADDRESS` or `CHAIN_<id>_STELLAR_API_PLUSD_ADDRESS`, which are
     optional (blank or unset = none).
   - Normalise exactly as `load_loan_registry_address` does: EIP-55, or a `C…` strkey. An invalid
     value is a startup error.
   - Add `ChainsConfig.plusd_addresses` and `AppState.plusd_addresses: HashMap<i64, String>`.
   - Add `plusd_addresses: HashMap::new()` to every `AppState { … }` literal in `packages/api/tests`
     (grep `minter_addresses:`).

10. **Pure compute** (`packages/api/src/total_balance.rs`).
    - Rename `fold_escrow` to `fold_steps`, keeping the behaviour, and update the call site and the
      tests. The function now serves both escrow and PLUSD.
    - `pub fn plusd_holder_key(kind: ChainKind, wallet: &str) -> Option<String>`:
      - EVM: `wallet.parse::<Address>().ok()?.to_checksum(None)`;
      - Stellar: `wallet.to_uppercase()`.
    - `pub fn plusd_steps(rows: &[PlusdStepRow]) -> Option<Vec<(i64, i128)>>`:
      - `None` if any `amount` is `None`, or does not parse as `i128`;
      - otherwise the delta is `(+a if incoming) − (a if outgoing)`, so a self-transfer nets to 0.
    - Generalise `composite_window_start` to take `&[Option<i64>]`, the minimum of the values
      present. The callers pass position, escrow and PLUSD.
    - Generalise `escrow_outcome` into `term_outcome(has_other_data, result, field: &str)`. It
      gives the same rule for both terms: on a read failure, warn and omit when the wallet has
      other data, and return a 500 otherwise.
    - `CompositeInputs` gains `plusd: Option<&[(DateTime<Utc>, i128)]>` (raw units) and
      `asset_decimals: u32`.
    - `build_composite_history`:
      - the empty rule becomes "positions, escrow and PLUSD all empty";
      - `plusd_now` is carried like the escrow, converted as
        `BigDecimal::new(raw, asset_decimals)` rounded down to 6 dp, and `None` when
        `asset_decimals > 18`;
      - `total = splusd + escrow? + plusd?`, summed from the rounded terms;
      - `item.plusd_balance = plusd_now.map(fmt6)`;
      - the `total_balance` stat follows from the total automatically.
    - `PositionHistoryItem` (`routes/pnl.rs`) gains
      `#[serde(skip_serializing_if = "Option::is_none")] pub plusd_balance: Option<String>`.
      Set it in `history_item` as `None` by default.

11. **Handler** (`routes/pnl.rs::get_position_history`).
    - `let plusd = state.plusd_addresses.get(&chain_id)` and
      `let holder = plusd_holder_key(chain.kind, &wallet)`.
    - Add `plusd_series()`:
      - when both are `Some`, call `list_plusd_holder_steps`, then `plusd_steps`, then
        `fold_steps(steps, interval)`;
      - on a `None` from `plusd_steps` or `fold_steps`, log
        `warn!(chain_id, "PLUSD balance fold failed; omitting plusd_balance")` and return
        `Ok(None)`;
      - keep the first raw timestamp for the window start.
    - Run it in the same `tokio::join!` as the vault, first-position and wire-out reads (on the
      `days` path, in the second join beside `fetch`).
    - Apply `term_outcome`.
    - Pass `plusd` and `asset_decimals` from the vault row (`u32::try_from(...).unwrap_or(u32::MAX)`)
      into `CompositeInputs`.
    - `empty_series` passes `plusd: None`.

12. **Env and checks.**
    - Add commented examples of the four keys to `.env.example`: indexer and API, for an EVM chain
      and for 99000001/99000002. Note on the Stellar ones: "leave unset until the PLUSD seed
      (TD-176) lands".
    - Run:
      - `scripts/check-chain-env-names.sh`
      - `cargo clippy --all -- -D warnings`
      - `cargo test -p pipeline-worker -p pipeline-api -p shared`
      - `/Users/aabliazimov/Documents/work/pipeline/node_modules/.bin/tsx scripts/lint-docs.ts`

13. **Follow-up and tech debt.**
    - Add **TD-176** to `docs/exec-plans/tech-debt-tracker.md`, using the next free number (TD-175
      is the last today): "Stellar PLUSD history predates indexing; `plusd_balance` off on
      99000001/99000002".
    - File the follow-up issue described below. The manager does this together with the PR, since
      the planner and the coder do not create issues.

### Follow-up: PLUSD balance seed (separate issue, not this one)

**Recommended mechanism: a one-off per-holder balance read, stored as a seed.**
- The read is a Soroban `simulateTransaction` of the PLUSD SAC's `balance(holder)`. The
  simulation's `latestLedger` is the seed's `as_of_ledger`.
- This is the #1789 `pocket_seeds` pattern (`simulate_view` + a supervised loop with backoff),
  in `stellar/plusd_seed.rs`.
- It writes a table `plusd_balance_seeds (chain_id, token_address, holder, as_of_ledger, balance NUMERIC, created_at, PRIMARY KEY (chain_id, token_address, holder))`.
- The candidate holders are the chain's whitelisted LP wallets (`lp_profiles`), because PLUSD is
  `AUTH_REQUIRED`, so only whitelisted wallets can hold it.
- At read time the balance is the seed plus the deltas with `block_number > as_of_ledger`.

**Why this one.**
- It is exact against `balance(wallet)` at a known ledger.
- It needs no history.
- It reuses proven code.
- Rejected alternative: Horizon effects/operations backfill. It needs a second data source, gives
  no contract-account coverage, and Horizon is being deprecated.

**Why a follow-up, not this issue.**
- The human decision (#1313, Q2) puts it there.
- It also has its own design points:
  - buckets before the seed: back-compute `seed − Σ(deltas in (t, as_of])` only down to the
    indexer's PLUSD coverage start, or omit them;
  - what a missing trustline returns from SAC `balance` (zero or a trap);
  - candidate refresh for newly whitelisted wallets.
- This issue's fold already takes an arbitrary first step, so the seed becomes one leading step,
  `(seed_ts, +balance)`, with no change to the compute.

## Test Strategy

The tests are pure unit tests: no Postgres, and no `DATABASE_URL`, `POSTGRES_URL` or other DB env
vars. They live in `packages/<pkg>/tests/<topic>.rs`. Config tests may set chain env keys under a
mutex, following the existing `*_config.rs` pattern.

**Worker**

- `tests/stellar_plusd_parsers.rs` (new). Build the XDR with the helpers from
  `stellar_deal_token_parsers.rs`.
  - `transfer` with a plain `i128`, and with the muxed map `{amount, to_muxed_id}`.
  - `mint` in the CAP-67 layout `[mint, to, asset]` and the legacy layout
    `[mint, admin, to, asset]`: `from` is null, `to` is the holder.
  - `burn`, and `clawback` in both layouts: `to` is null.
  - A `ClaimableBalance` or `LiquidityPool` counterparty is encoded as `B…` / `L…`, and the LP side
    is kept.
  - `approve` / `set_authorized` return `None`.
  - A recognised topic that is not decodable returns `None`.
  - A negative amount returns `None`.
  - The output is `event_name = "PlusdTransfer"`, `contract_address` is unchanged, and the params
    keys are exactly `{kind, from, to, amount}` with `amount` as a decimal string.
- `tests/stellar_deal_token_parsers.rs`: unchanged and green after the decoder refactor.
- `tests/stellar_plusd_config.rs` (new):
  - unset or blank key → `plusd_id = None`;
  - a valid id is stored;
  - a bad CRC → error;
  - an id equal to `JOB_INDEXER_STELLAR_ASSET_ID` or to the `STAKED_PLUSD_ADDRESS` key → the
    duplicate-role error.
- `tests/evm_plusd_transfers.rs` (new):
  - the filter has exactly the PLUSD address and the `Transfer` topic0, with no address-only form;
  - mint (`from = 0x0`) gives `kind "mint"`, `from: null`;
  - burn gives `to: null`;
  - a transfer gives EIP-55 sides;
  - another address gives `None`;
  - a `uint256` above `i128` is still stored as its decimal string;
  - `reject_plusd_collision` names the clashing role;
  - the config key parses, and a malformed key is a startup error.

**Shared**

- `tests/contract_logs_plusd_sql.rs` (new), needle tests on the normalised
  `PLUSD_HOLDER_STEPS_SQL`:
  - `event_name = 'PlusdTransfer'`;
  - `contract_address = $2`;
  - both `jsonb_build_object('to', $3::text)` and `jsonb_build_object('from', $3::text)`;
  - `'^[0-9]{1,39}$'`;
  - `ORDER BY block_number, log_index`;
  - no `LOWER(`, no `block_timestamp >=` (full history), and no `SUM(`.
- `tests/migration_plusd_transfer_index.rs` (new):
  - `CREATE INDEX IF NOT EXISTS idx_contract_logs_plusd_transfer_params`;
  - `USING GIN (params jsonb_path_ops)`;
  - `WHERE event_name = 'PlusdTransfer'`;
  - the additive-only guard from `migration_pocket_seeds.rs`.

**API**

- `tests/positions_history_plusd.rs` (new):
  - `plusd_steps`:
    - in, out, a self-transfer (net 0), and a mint with a null side;
    - a `None` amount gives `None`;
    - a 39-digit amount above `i128::MAX` gives `None`.
  - `fold_steps`: a negative running value or an overflow gives `None`; the debit-before-credit
    case within one bucket gives `None`.
  - `plusd_holder_key`: an EVM lowercase input gives EIP-55; garbage gives `None`; Stellar is
    uppercased.
  - The flow scenario from the research table, with 7 decimals:
    - DM claim +1000;
    - stake −600;
    - wire-out request −100;
    - cancel +100;
    - WQ request −50;
    - pocket claim +25;
    - unstake +200.
    Amounts are whole PLUSD (raw × 10^7). Every bucket's `plusd_balance` matches the hand fold,
    and the final value is `"575.000000"`. A raw remainder below 10^-6 PLUSD is rounded down.
    `total_balance` equals `splusd_value + wire_out_escrow + plusd_balance` in every bucket.
  - With `asset_decimals` of 6 and of 7, the result is rounded down to 6 dp. `asset_decimals = 19`
    omits the field.
  - The window start is the minimum of position, escrow and PLUSD. A wallet with only PLUSD gets
    a dense series from its first movement, with `splusd_value "0.000000"`.
  - `plusd: None` means the field is absent and the total equals #1313's value.
  - The `total_balance` stat includes PLUSD.
  - No output contains `e` or `E`.
  - `term_outcome`: a read error with other data → `Ok(None)`; without other data → `Err`.
- `tests/positions_history_composite.rs`: update it for the `fold_steps` rename and the slice
  argument of `composite_window_start`. Expectations are unchanged.
- `tests/analytics_pnl_positions_chain.rs`: the OpenAPI `PositionHistoryItem` now **has**
  `plusd_balance`, and it is not required.
- `tests/chains_config.rs`: `CHAIN_<id>_<KIND>_API_PLUSD_ADDRESS` is optional and normalised to
  EIP-55 or a strkey; an invalid value fails startup.

**Manual verification** (recorded in the user-stories doc; the coder runs steps 1–3 where an
environment is available)

1. **EVM acceptance.**
   - Set the indexer key, rewind the cursor to the PLUSD deploy block, wait for catch-up, then set
     the API key.
   - For wallet `W` and indexed tip `N = last_indexed_block − 1`:
     `cast call $PLUSD "balanceOf(address)(uint256)" $W --block $N` must equal the raw DB fold of
     `W`'s `PlusdTransfer` rows with `block_number <= N`, exactly.
   - The last `plusd_balance` must equal that value rounded down to 6 dp, provided `W` has no
     movement after `N`.
   - Completeness: the sum of all holders' folds equals `totalSupply()` at `N`.
2. **Stellar parser acceptance** (testnet, local API only).
   - Use a **fresh** testnet wallet whose first PLUSD movement happens after the indexer key is set.
   - Run DM claim → stake → wire-out request → cancel.
   - After each step, simulate `balance(W)`. The result carries `latestLedger L`. Wait until the
     cursor is past `L`; the DB fold over `block_number <= L` must equal the balance exactly.
   - The shared testnet API key stays unset.
3. **Classic events.** Send PLUSD between two whitelisted testnet G-accounts with a classic payment,
   and confirm that a `PlusdTransfer` row appears. If it does not, record that in TD-176.

## Docs to Update

- **`docs/product-specs/lp-total-balance.md`.** Keep the file under 150 lines.
  - Add the `plusd_balance` row to the terms table, gated by `CHAIN_<id>_<KIND>_API_PLUSD_ADDRESS`.
  - `total_balance = splusd_value + wire_out_escrow? + plusd_balance?`.
  - Replace the "reserved / not served" paragraph.
  - Add the coverage rule: the API key is set only once indexing covers PLUSD from its deployment.
    The term is off on Stellar 99000001/99000002 until TD-176.
  - Add the PLUSD fold: per-movement, the negative, overflow and malformed guard, rounding down
    with the vault `asset_decimals`.
  - The window and empty rules now include the first PLUSD movement.
  - Data Model: one migration (the partial GIN index), the new keys, and `PlusdTransfer` rows.
  - API Contract: `PositionHistoryItem` gains optional `plusd_balance`.
- **`docs/references/backend.md`:**
  - a new `#### PLUSD transfer indexing` subsection under Event Indexer:
    - the row shape;
    - the per-chain keys;
    - the EVM filter (address + topic0);
    - Stellar routing before `dispatch_parser`;
    - CAP-67 layouts and the `B…`/`L…` holders;
    - the flow table;
    - the coverage and rewind rule;
  - the `GET /v1/positions/history` composite paragraph: `plusd_balance`, `PLUSD_HOLDER_STEPS_SQL`
    (`@>`), the fold guard, and the window change; remove "reserved; #1865 adds it";
  - the Stellar ids table: the `plusd` row gains indexer `…_STELLAR_INDEXER_PLUSD_ADDRESS`
    (optional) and API `…_STELLAR_API_PLUSD_ADDRESS` (optional, must equal the indexer key; leave
    unset on 99000001/99000002).
- **`ARCHITECTURE.md`:** one clause in the per-chain indexer paragraph. Both pollers can index PLUSD
  movements as `PlusdTransfer` rows behind `CHAIN_<id>_<TYPE>_INDEXER_PLUSD_ADDRESS`, and EVM
  fetches them by address + topic filter.
- **`.env.example`:** the four keys (step 12).
- **`docs/exec-plans/tech-debt-tracker.md`:** TD-176 (step 13).
- **`docs/user-stories/epic-1247/1865-plusd-balance.md`** (new). API-level stories:
  - `plusd_balance` per bucket and in the total;
  - the term is absent without the API key;
  - the negative guard omits it;
  - a wallet with only PLUSD gets a history;
  - the acceptance check (manual steps 1–2);
  - pointers to the automated tests.
- **Frontend docs:** no change. #1282 binds `total_balance`, and the spec sentence "the card must
  not label the total as including PLUSD" becomes "includes PLUSD when `plusd_balance` is
  present".
