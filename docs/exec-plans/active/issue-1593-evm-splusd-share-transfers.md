# Issue #1593: Indexer (EVM): sPLUSD peer-to-peer transfers are not indexed as ShareTransfer

Source: https://github.com/eq-lab/pipeline/issues/1593

Parent epic: #2129 (math correctness, 2026-11-19 code review). QA: #2130. No Figma reference,
so there is no visual verification step.

## Scope

The issue body (2026-10-20) still matches `origin/main` (`b75cf30b`). In
`packages/worker/src/indexer/evm_parsers.rs` the `splusd_contracts` handler (L117–130) decodes
only ERC-4626 `Deposit` / `Withdraw`. The stale note in `indexer/mappers.rs` (L105–108) says
`ShareTransfer` is "Stellar only". Everything after the parser is already chain-agnostic and
needs no change:

- `ContractLogMapper::insert` already sends `ShareTransfer` to `compute_transfer_position_fields`
  when position tracking is on, which the sPLUSD handler turns on.
- The `position_events` view (`20260819000001_splusd_share_transfer_positions.sql`) and its two
  partial indexes are keyed on `event_name = 'ShareTransfer'` and `LOWER(...)` addresses, with no
  filter on chain kind.
- `PositionRepo`, `/v1/pnl` and `/v1/positions/history` read the view.

The fix is a parser plus a handler change. It copies the Stellar setup, where
`dispatch_parser` sends the vault's `transfer` to `parse_share_transfer` and stores
`{from, to, amount}` under `ShareTransfer`.

What is wrong today (the issue's example, as the reviewer described it):

1. Alice deposits 400 PLUSD and gets 400 shares at a price of 1.0.
2. Alice transfers all 400 shares to Bob.
3. The share price rises to 1.05. Bob redeems 400 shares for 420 PLUSD.

Today Bob's `StakingWithdrawal` starts from a balance of 0. The shares are clamped and he books
a realized PnL of +420. Alice keeps 400 phantom shares. The correct result is +20 for Bob and
0 shares for Alice.

### In scope

1. **`packages/worker/src/indexer/parsers.rs`**: add
   `pub fn parse_share_transfer(log: &Log, vaults: &[Address]) -> Option<ContractLog>`.
   - It returns `None` unless `log.address()` is in `vaults`. This check is required. The EVM
     poller passes every fetched log to every handler in order, and the first match wins
     (`poller.rs` `poll`). Handler addresses only control which logs are fetched. Deal-token
     `Transfer`s (dynamic handler, registered after the sPLUSD handler), PLUSD `PlusdTransfer`s and
     USDC `AssetTransfer`s use the same `Transfer(address,address,uint256)` signature. Without the
     check, the sPLUSD handler would claim all of them as `ShareTransfer`. On Stellar,
     `dispatch_parser` matches on `raw.contract_id == staked_plusd_id`. This check is the EVM
     version of that.
   - It decodes with the existing `crate::indexer::asset_transfers::Transfer` sol type, as
     `plusd_transfers.rs` does. No fourth `Transfer` declaration is added.
   - It returns `None` when `from == Address::ZERO` or `to == Address::ZERO`. These are mint and
     burn, which are already indexed as `StakingDeposit` / `StakingWithdrawal` (see the
     deviations below).
   - It returns `ContractLog { event_name: "ShareTransfer", block_timestamp: 0, params }` with
     `params = {"from": from.to_checksum(None), "to": to.to_checksum(None), "amount":
     value.to_string()}`. These are the same three keys and the same decimal-string amount as
     the Stellar `parse_transfer_as`. Addresses are in the chain's native form (EIP-55), like
     EVM `StakingDeposit.owner`. The view and `fetch_prev_position` lowercase both sides.
   - A self-transfer (`from == to`, non-zero) and a zero-amount transfer are kept, as on Stellar.
     The mapper already handles both: a self-transfer keeps the prior position and a zero
     amount writes no position fields.
2. **`packages/worker/src/indexer/evm_parsers.rs`** `register_evm_handlers`:
   - Clone `contracts.splusd_contracts` into `splusd_addrs` before it moves into
     `add_event_handler`, as with `minter_addrs` / `cr_addrs`.
   - Put `if !is_emitted_by(log, &splusd_addrs) { return None; }` at the top of the sPLUSD
     closure. This matches the minter and CollateralRegistry handlers and also covers
     `Deposit` / `Withdraw`.
   - Chain `.or_else(|| parse_share_transfer(log, &splusd_addrs))` after
     `parse_staking_withdraw`.
   - The mapper stays `ContractLogMapper::new(..).with_position_tracking()`.
   - No RPC change: the vault is a static, topic-unfiltered address, so its `Transfer` logs are
     already fetched today and then dropped.
3. **`packages/worker/src/indexer/mappers.rs`**: a refactor with no behaviour change, so that the
   mapper side of a transfer can be tested without a database:
   - Split `compute_transfer_position_fields` into pure helpers:
     - `pub fn transfer_sides(params: &Value) -> Option<(String, String, BigDecimal)>` returns
       `from` and `to` lowercased, plus `amount`. It returns `None` for a zero amount or an
       empty side, which is the current early return.
     - `pub fn write_transfer_position(params: &mut Value, next: &TransferPosition)` writes the
       five fields exactly as today: `shares_balance_from`, `avg_buy_share_price_from`,
       `shares_balance_to`, `avg_buy_share_price_to`, and `realized_pnl = "0"`.
   - The async function becomes: `transfer_sides`, then two `fetch_prev_position` calls, then
     `carry_over_transfer`, then `write_transfer_position`. The warn on a clamped sender stays.
   - Delete the stale parenthetical "(Stellar only — the EVM indexer does not decode ERC-20
     transfers on the vault)" in the `is_position_event_name` doc comment. Do not add new
     comments (AGENTS.md comment rule).
4. Tests and docs, below.

### Out of scope

- Contracts, deploy scripts and upgrades (frozen on both chains).
- A schema migration. The view and partial indexes already cover EVM rows.
- API or frontend changes. `/v1/pnl` and `/v1/positions/history` pick up EVM transfers through
  `position_events`.
- Showing `ShareTransfer` in the LP transaction history (`kyc_repo.rs` lists only
  Stake/Unstake). Stellar doesn't show it either, so the two chains stay the same.
- #1591 (stale open position after a full exit in `/v1/pnl`). It has its own owner.
- Old Hoodi vaults (`hoodi-v1..v4`). Since #1613, readers use only the chain's single `vaults`
  row.

### Deviations from the Stellar approach, and why

| Area | Stellar | EVM (this plan) | Why |
|---|---|---|---|
| Token mint/burn | Not emitted. `Base::update` emits nothing, so there is nothing to skip | `Transfer(0, x)` / `Transfer(x, 0)` are skipped in the parser | OZ ERC-20 emits `Transfer` on every mint and burn. In the deployed `StakedPipelineUSD` (`pipeline-contracts@f92d719`, Hoodi v5 proxy `0x87CD…40Cd`), every mint or burn path also emits `Deposit` or `Withdraw`. `deposit`/`mint`/`withdraw`/`redeem` call the OZ `super`. `burnShares` calls `_burn` and then emits `Withdraw(minter, minter, owner, …)`. Treasury fee shares come from the Minter's `stakedPlUsd.deposit(amount, treasury)`. Indexing the zero-address side would count the same change twice. The result is the same set of rows Stellar produces. Checked: HEAD (`150631a`) adds no new share mint or burn path. |
| Contract match | `dispatch_parser` matches `contract_id` | `is_emitted_by` in the handler plus an address check inside the parser | The EVM poller has no per-handler address dispatch (see In scope 1). |
| Address format | `G…` / `C…` strkey | EIP-55 checksum | Each chain's native form, the same as the chain's staking rows. Holders are lowercased in the view. |
| Amount decoding | plain i128 or a muxed `Map { amount }` | `uint256` → decimal string | There is no muxed variant on EVM. The stored shape is the same. |

Nothing changes in the mapper, the view or the API, so EVM and Stellar run the same position
math (carry-over basis, `realized_pnl = 0` on transfers).

### Backfill / cursor rewind

**Stage (Hoodi, chain 560048): no backfill is needed. Re-check this at deploy time.**
On 2026-11-19 the planner checked with `eth_getLogs` on `https://ethereum-hoodi-rpc.publicnode.com`
for vault `0x87CD1002bdB9401423cb50A860314FC8f11440Cd`, topic0 `Transfer`
(`0xddf252ad…b3ef`), blocks 3 300 000 – 4 047 559 in 50k chunks. There were 3 logs in total,
the first at block 3 802 192: 2 mints and 1 burn. There were 0 peer-to-peer transfers, so no
stored running balance is wrong yet.

**Why a rewind alone cannot repair history.** If a peer-to-peer transfer happened before the
new image is live, rewinding the cursor would insert the missing `ShareTransfer` row. But the
holders' later `StakingDeposit` / `StakingWithdrawal` rows are already stored. They are skipped
as duplicates (`is_duplicate` on `(chain_id, contract_address, block_number, log_index)`) and
keep their old running balances. `fetch_prev_position` reads the latest row, so the error
continues. This is the "running fields computed from newer state" risk already noted in
backend.md for the Hoodi SR rollout.

The repair, used only when the check finds peer-to-peer transfers:

1. Stop the worker.
2. First run the existing per-address `eth_getLogs`-vs-`contract_logs` count check from the
   Hoodi SR runbook. This makes sure no other late-enabled handler would backfill rows with
   running fields.
3. In one transaction:
   `DELETE FROM contract_logs WHERE chain_id = <id> AND LOWER(contract_address) = LOWER('<vault>')
   AND event_name IN ('StakingDeposit','StakingWithdrawal','ShareTransfer');`
   `UPDATE log_collector_state SET last_indexed_block = <first vault log block> WHERE chain_id = <id>;`
4. Start the worker.

There are no foreign keys into these rows. `ramp_reviews` references only ramp rows. EVM RPC
keeps full log history, unlike Soroban's ~7-day retention, so deleting these rows does not lose
data. While the worker catches up, `/v1/pnl`, `/v1/positions/history` and the LP Stake/Unstake
history for that chain are incomplete.

## Assumptions and Risks

- **Assumption: stage Hoodi (560048) is the only deployed EVM chain the worker indexes.** Other
  `CHAIN_<id>_EVM` ids in the repo appear only in tests or examples. If another environment
  indexes an EVM vault, run the same check there (Open Questions).
- **Deploy-window risk.** A peer-to-peer transfer between now and the new image going live would
  be read by the old image and dropped. Mitigation: repeat the check after deploy (Test Strategy
  step 4) and use the repair only if needed.
- **Handler-order risk.** Without the address check, ERC-20 `Transfer`s from other contracts
  would be stored as `ShareTransfer` on the vault's position chain, and their own handlers would
  never see them. The check plus the "another address gives None" test cover this. Add no
  further sPLUSD-handler parsers without the same check.
- **Upgrade risk.** If a future vault upgrade adds a mint or burn path without
  `Deposit`/`Withdraw`, skipping zero-address transfers would miss it. Contracts are frozen, so
  this is noted in docs only. It matches the Stellar caveat about `Base::mint`.
- **Same-transaction ordering.** Rows are inserted in `(block_number, log_index)` order inside
  one DB transaction, and `fetch_prev_position` sees uncommitted rows. So
  "deposit to a router, then the router transfers to the user" in one transaction moves the
  router's basis to the user.
- No dependency on other open issues. The #1786 Phase 2 and #1739 branches touch different
  files.

## Open Questions

- Is any deployed environment other than stage Hoodi (chain 560048) running the EVM indexer
  against an sPLUSD vault, for example a mainnet or a private devnet? If so, the peer-to-peer
  `Transfer` check (and, if it finds transfers, the delete-and-rewind repair) must also run
  there. The planner could check only Hoodi, which has 0 peer-to-peer transfers.

## Implementation Steps

1. `packages/worker/src/indexer/parsers.rs`: add `parse_share_transfer(log, vaults)` as in
   In scope 1, next to `parse_staking_withdraw`. Import `super::asset_transfers::Transfer`.
2. `packages/worker/src/indexer/evm_parsers.rs`: import `parse_share_transfer` and add the
   `splusd_addrs` clone, the `is_emitted_by` check and the `.or_else(..)` as in In scope 2.
3. `packages/worker/src/indexer/mappers.rs`: extract `transfer_sides` and
   `write_transfer_position`, rewire `compute_transfer_position_fields` to use them, and fix the
   `is_position_event_name` doc comment (In scope 3).
4. Tests (Test Strategy).
5. Docs (Docs to Update).
6. `cargo fmt --all`, `cargo clippy --all -- -D warnings`, `cargo test -p pipeline-worker`, and
   `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests go in `packages/worker/tests/`: pure unit tests, no inline `#[cfg(test)]` blocks, and
no Postgres. Nothing reads `DATABASE_URL`, `POSTGRES_URL` or any other env var.

1. **New `packages/worker/tests/evm_share_transfers.rs`.** Reuse `mod deal_token_support;` and
   its `transfer(token, from, to, value, block, idx)` / `make_log` helpers. Use constants `VAULT`,
   `ALICE`, `BOB`, and `OTHER` (an unrelated token address).
   - A peer-to-peer transfer from `VAULT` decodes to `event_name == "ShareTransfer"`, with
     `contract_address == VAULT`, block and log index carried through, and `block_timestamp == 0`.
     `params.from` and `params.to` are EIP-55 checksummed, `params.amount` is the decimal string,
     and the sorted keys are exactly `["amount", "from", "to"]`. These are the same keys the
     Stellar `parse_share_transfer` test checks in `tests/stellar_parsers.rs`.
   - Mint (`from = 0`) gives `None`. Burn (`to = 0`) gives `None`.
   - The same `Transfer` emitted by `OTHER` gives `None`, and an empty `vaults` slice gives `None`.
     This is the handler-order guard.
   - A non-`Transfer` log from the vault, such as an ERC-4626 `Deposit` built with a local
     `sol!`, gives `None`.
   - A self-transfer (`from == to`) decodes, with both sides equal.
   - An amount above `u128::MAX` (build the `Transfer` with a `U256` directly) is stored as its
     full decimal string.
2. **Extend `packages/worker/tests/share_transfer_positions.rs`**. This is a pure end-to-end
   replay of the issue example. A small in-test ledger, `HashMap<holder, (shares, avg_price)>`,
   stands in for "latest `position_events` row per holder":
   - Alice: `apply_position_delta(true, 0, 0, 400, 400)`, giving 400 shares at 1.0.
   - Build the EVM transfer log with `parse_share_transfer`. Run its `params` through
     `transfer_sides`, and assert both sides are lowercased and match the checksummed input
     lowercased. Then run `carry_over_transfer` on the ledger and `write_transfer_position`.
     Assert that the five written fields are present: Alice `shares_balance_from == 0`, Bob
     `shares_balance_to == 400`, `avg_buy_share_price_to == 1.0`, and `realized_pnl == "0"`.
   - Bob: `apply_position_delta(false, 400, 1.0, 400, 420)` gives realized `20` and 0 shares.
   - Regression contrast: without the transfer, `apply_position_delta(false, 0, 0, 400, 420)`
     gives realized `420`, which is the bug.
   - A partial transfer (Alice sends 100 of 400) leaves Alice with 300 at 1.0 and Bob with 100
     at 1.0, and total cost is conserved.
   - `transfer_sides` returns `None` for a zero amount and for a missing `from` or `to`.
3. The existing `tests/parsers.rs` staking tests, `tests/stellar_parsers.rs` share-transfer tests
   and `tests/share_transfer_positions.rs` must pass unchanged. This shows the mapper refactor
   changes no behaviour.
4. **Rollout check (manual, run by whoever deploys; recorded in the PR body).**
   - After the new worker image is live on stage, repeat the Hoodi `eth_getLogs` peer-to-peer
     count from block 3 802 192 to the current cursor.
   - If it is 0, nothing more is needed. Any future transfer shows up as a `ShareTransfer` row
     (`SELECT count(*) FROM contract_logs WHERE chain_id = 560048 AND event_name =
     'ShareTransfer'`).
   - If it is greater than 0 for a transfer below the deploy block, apply the repair from the
     Backfill section.

## Docs to Update

- **`docs/references/backend.md`**, section "sPLUSD share-transfer tracking (`ShareTransfer`)"
  (L548–572). Make it cover both chains:
  - Add an EVM paragraph and table. The OZ ERC-4626 vault's `Deposit` → `StakingDeposit`,
    `Withdraw` (including `burnShares`) → `StakingWithdrawal`, and ERC-20 `Transfer` with both
    sides non-zero → `ShareTransfer` (same `{from, to, amount}` params, EIP-55). Zero-address
    `Transfer`s are skipped because every mint and burn path in `pipeline-contracts@f92d719`
    also emits `Deposit` / `Withdraw`. Explain why the handler checks the vault address (the
    poller passes every log to every handler), and that no config or extra RPC call is needed.
  - Keep the existing Stellar text as the Stellar paragraph.
  - Replace "Any holder who sent or received shares before this shipped needs an indexer resync
    over the vault" with the concrete rule from the Backfill section: why a rewind alone is not
    enough, the delete-plus-rewind repair (with the late-handler pre-check), and the Hoodi status
    as of 2026-11-19 (0 peer-to-peer transfers, no backfill).
- **`docs/product-specs/yield-apy-semantics.md`** needs no change. It already defines positions
  through `position_events` on every chain.
- No new tech-debt or known-bug entries are expected. If the Open Question finds another EVM
  environment with peer-to-peer history that cannot be repaired right away, log it in
  `docs/exec-plans/tech-debt-tracker.md`.
