# EVM relayer: the Soroban relayer's chain modules, on EVM

Source: the Soroban relayer in `packages/worker/src/relayer/stellar/`, mirrored module for module onto the EVM contracts deployed as Hoodi v5 (`pipeline-contracts` at `3b74e98`, `deployments/hoodi-v5.json`).

Rule: nothing goes in that the Soroban modules do not do.

## Module map

| Soroban | EVM equivalent | Notes |
|---|---|---|
| `stellar/job.rs` — `run_stellar_relayer_inner` | `evm/job.rs` — `run_evm_relayer_inner` | Same loop shape. KYC phases 0–2 move over verbatim. |
| `stellar/whitelist.rs` — `StellarWhitelister`, `phase_sync_whitelist_stellar` | `evm/whitelist.rs` — `EvmWhitelister`, `phase_sync_whitelist_evm` | `access_manager.execute(set_authorized)` becomes `WhitelistRegistry.allow` (D2). |
| `stellar/wire_in_match.rs` — `phase_match_wire_ins` | the same phase, moved to `relayer/wire_in_match.rs` and called by both jobs | The statements are already chain-agnostic (D3). |
| `StellarRelayerSettings` | `EvmRelayerSettings`, reshaped to match | Step 1. |
| `stellar/yield_mint.rs` | **none** | Hoodi v5 has no yield-minter (D1). |
| `stellar/sim_decode.rs` | **none** | Soroban simulate decoding; alloy does the EVM equivalent itself. |

## Ground truth

- **The whitelist is still required.**
  - `PipelineUSD._update` is `onlyAllowed(from) onlyAllowed(to)`, so an LP cannot receive minted PLUSD until `allow` lands.
  - `WhitelistRegistry` keeps `allow`, `isAllowed` and `disallow`. `allow` reverts `WhitelistAccessAlreadyAllowed()` and is gated by `WHITELIST_MANAGER_ROLE`.
- **There is no yield-minter.**
  - `PipelineYieldMinter` and `LoanRegistry.canYieldBeMinted` are gone; `PipelineMinter.repay` mints interest and fees inside the same call.
  - The current Soroban contracts have no `mint_yield` either. The Soroban yield-mint phase survives only for deployments still running the old `yield_minter` (futurenet, mainnet).
- **The Minter's wire-in events match Soroban's.**
  - It emits `WireInRecorded(uint256 indexed id, address indexed receiver, uint256 amount, uint64 valueDate, bytes32 refHash)` and `WireInAssigned(uint256 indexed id, address indexed receiver)`.
  - `recordWireIn` escrows if and only if `receiver == address(this)` and otherwise stakes for the receiver. That is the same branch as Soroban's `record_wire_in`, so the matching rules hold on EVM unchanged.
- **EVM indexer rows are checksummed.** Contract addresses and address params are written EIP-55 checksummed (`to_checksum(None)`).

## Scope

**In scope:**

- The four module-map rows that have an equivalent.
- Deleting the EVM code that has no Soroban counterpart or no v5 contract behind it:
  - `relayer/yield_mint/` (the BitGo yield-mint phase, Hoodi v4 only);
  - `relayer/custodian.rs` (unused, and it decodes the pre-rework `queueMetadata`);
  - `relayer/whitelist.rs` (replaced by `evm/whitelist.rs`).
- The config, env and docs changes that follow from the above.

**Out of scope:**

- **The indexer**, including writing EVM `WireIn` rows. The EVM wire-in phase ships dark until the indexer writes them, as the Soroban one did before its minter was deployed. The row shape it expects is pinned in D3.
- **KYC phases 0–2** (profiles, Sumsub, Crystal). They move into `evm/job.rs` unchanged.
- **Anything the Soroban relayer does not do:**
  - on-chain `disallow`;
  - role or chain preflights;
  - Minter submissions.
- **Soroban behaviour.** Only the import path of the wire-in phase changes.

## Decisions

**D1. No EVM yield-mint.**
Soroban mints yield with a separate `yield_minter.mint_yield` call after `PaymentRecorded`. EVM v5 mints inside `Minter.repay`, so there is nothing left for a relayer to submit. The existing BitGo phase only works against Hoodi v4's `PipelineYieldMinter`, which no longer matters, so it is deleted along with its test.

**D2. `evm/whitelist.rs` mirrors `StellarWhitelister`.** The pieces map as follows.

| Soroban | EVM |
|---|---|
| `is_already_authorized(user)`: PLUSD SAC `authorized` view | `is_already_allowed(user)`: `isAllowed` view. The phase treats an `Err` as "proceed with submit", as the Soroban phase does. |
| `submit_set_authorized(user)`: simulate, sign, send, then poll `getTransaction` until SUCCESS / FAILED (30 × 1 s) | `submit_allow(user)`: `allow(user).send()`, then `get_receipt()` under `with_timeout(Some(CONFIRM_TIMEOUT))`. Bail when `status()` is false or the timeout hits. `CONFIRM_TIMEOUT` is 120 s, about 10 Hoodi blocks against Soroban's roughly 6 ledgers. |
| Sign with the configured `network_passphrase` | Sign with the configured chain id. Build the provider with `ProviderBuilder::with_chain_id(chain_id)` plus the gas and nonce fillers, instead of `with_recommended_fillers()`, whose `ChainIdFiller` trusts the RPC. |
| `take(batch_size)` from `JOB_RELAYER_STELLAR_BATCH_SIZE` | `take(batch_size)` from `JOB_RELAYER_EVM_BATCH_SIZE`, default 50. |
| DB-only disallow pass (`fetch_profiles_to_disallow` / `set_disallowed`) with the KYT flag `elliptic_enabled` | The same DB-only pass with the KYT flag `crystal_enabled`. No on-chain `disallow`, because Soroban has no on-chain deauthorize (TD-31 now covers both chains). |

`submit_allow` replaces today's `watch()` call. `watch()` returns once the transaction is included, ignores a revert and never times out, so it is not equivalent to Soroban's terminal-status poll.

The EVM phase runs the disallow pass even when there are no allow candidates. The Soroban phase returns early and skips that pass. That is a bug: it is logged in `known-bugs.md` and not fixed here.

**D3. Wire-in matching is shared, not duplicated.**
The three statements in `LpBankDepositRepo`'s `WireInMatcher` key on:

- `chain_id` and `contract_address`;
- the event names `WireIn` and `WireInAssigned`;
- the params `id`, `receiver` and `ref_hash`.

None of that is Soroban-specific. The EVM phase calls them unchanged, which pins the row shape the EVM indexer work must write:

- `event_name` is `WireIn` for `WireInRecorded` (the cross-chain name, as with `DepositRequested`), and `WireInAssigned` as is.
- `contract_address` and `params.receiver` are EIP-55 checksummed, like every EVM row today. The relayer passes the minter as `to_checksum(None)`, so Rule A's `receiver <> minter` and the `contract_address` filter compare like with like.
- `params.ref_hash` is bare lowercase hex with no `0x`. `decode(…, 'hex')` rejects the prefix, and the whole statement errors.
- `params.id` is a decimal JSON number.

**D4. The wire-in gate reads the indexer's key, as Soroban does.**
The key is `CHAIN_<id>_YIELD_MINTER_CONTRACTS`. The reasoning is the same as #1416's:

- the minter replaced the yield-minter;
- the phase interprets rows the indexer wrote, so a separate relayer key could disagree.

Handling of the key:

- The EVM key is a list, so the phase runs once per listed address. An address that never emitted `WireIn` matches nothing.
- If the key is unset, the phase is disabled.
- Each entry is parsed as an `Address` at startup, so a malformed entry fails startup. That matches the Soroban key's checksum check.

## Open Questions

_None._

## Implementation Steps

1. **`relayer/config.rs` — `EvmRelayerSettings`, mirroring `StellarRelayerSettings`.**
   - Keep:
     - `chain_id`, `interval_secs`, `signer_key`, `registry_address`, `sumsub_enabled`, `crystal_enabled`;
     - `eth_rpc_url`, with its `CHAIN_<id>_ETH_RPC_URL` fallback.
   - Add:
     - `minter_addresses: Vec<Address>`, from `CHAIN_<id>_YIELD_MINTER_CONTRACTS`; unset gives an empty list (D4);
     - `batch_size`, from `JOB_RELAYER_EVM_BATCH_SIZE`, default 50;
     - `minter_ids() -> Vec<String>`, returning the checksummed strings Phase 5 binds.
   - Drop: `yield_minter_address`, `loan_registry_address`, `bitgo_native_symbol`, `yield_minter_batch_size` and `env_parse_string`.

2. **`relayer/evm/mod.rs`** — `pub mod job; pub mod whitelist;` plus re-exports, shaped like `stellar/mod.rs`.

3. **`relayer/evm/whitelist.rs`** — per D2, with the same log lines as the Soroban phase under an `evm:` prefix.
   - `sol!`: `WhitelistRegistry { allow; isAllowed }`.
   - `EvmWhitelister` holds `chain_id`, the registry instance and the signer address, and provides `is_already_allowed` and `submit_allow`.
   - `phase_sync_whitelist_evm(whitelister, kyc_repo, chain_id, sumsub_enabled, crystal_enabled, batch_size)`:
     - an allow pass over `fetch_profiles_to_allow`, limited to `batch_size`;
     - then the DB-only disallow pass, which always runs.

4. **`relayer/evm/job.rs`** — `run_evm_relayer_inner`, moved out of `relayer_job.rs`.
   - Build the provider per D2 and `EvmWhitelister`.
   - Phases 0–2: verbatim.
   - Phase 3: `phase_sync_whitelist_evm`.
   - Phase 5: when `minter_ids()` is non-empty, call `phase_match_wire_ins(&LpBankDepositRepo, chain_id, id)` for each id. Log each error and continue, as Soroban does.
   - Startup logs mirror Soroban's:
     - one "running" line with the signer, registry, minters and flags;
     - one line saying the wire-in phase is enabled or disabled.

5. **Move `relayer/stellar/wire_in_match.rs` to `relayer/wire_in_match.rs`.**
   - Update imports in `stellar/mod.rs`, `stellar/job.rs` and the test (step 8).
   - Its header cites both escrow branches: Soroban `contracts/minter/src/lib.rs` and Solidity `MinterUpgradeable.recordWireIn`.

6. **`relayer/relayer_job.rs`** — only the dispatcher remains: `Evm(s) => evm::job::run_evm_relayer_inner(*s, kyc_repo)`.

7. **Delete dead code.**
   - Delete `relayer/whitelist.rs`, `relayer/yield_mint/`, `relayer/custodian.rs` and `tests/yield_mint_phase_4.rs`.
   - In `relayer/mod.rs`, add `pub mod evm; pub mod wire_in_match;` and drop the deleted modules.
   - Drop any `packages/worker/Cargo.toml` dependency left without a user.

8. **Tests.**
   - Rename `tests/stellar_wire_in_match.rs` to `tests/wire_in_match.rs`.
   - Add `tests/evm_relayer_config.rs`. Both are described under Test Strategy.

9. **`.env.example`**
   - Remove:
     - `CHAIN_1_RELAYER_YIELD_MINTER_ADDRESS` and `CHAIN_1_RELAYER_LOAN_REGISTRY_ADDRESS`;
     - `JOB_RELAYER_YIELD_MINTER_BATCH_SIZE`;
     - the `BITGO_*` block (nothing reads it after step 7).
   - Add `JOB_RELAYER_EVM_BATCH_SIZE`.
   - Note on `CHAIN_1_RELAYER_SIGNER_KEY` that the key needs `WHITELIST_MANAGER_ROLE`.
   - Note on `CHAIN_1_YIELD_MINTER_CONTRACTS` that it also gates the relayer's wire-in phase, mirroring the Soroban note on `CHAIN_<id>_STELLAR_YIELD_MINTER_ID`.

10. **Bug and debt trackers.**
    - `docs/exec-plans/known-bugs.md`: `phase_sync_whitelist_stellar` returns before its disallow pass whenever there are no allow candidates, so KYT-failed profiles keep `on_chain_allowed = TRUE` until some allow candidate appears.
    - `docs/exec-plans/tech-debt-tracker.md`:
      - Widen TD-31 to EVM: the disallow pass is DB-only on both chains, although the EVM registry exposes `disallow`.
      - Add TD-126: `shared::bitgo` and the EVM-only outbox methods (`discover_pending`, `mark_submitted`) have no caller, and EVM rows left in `yield_mint_outbox` are inert.
      - Add TD-127: EVM `allow` has no fee bumping. alloy's default nonce manager reads the `pending` nonce, so one stuck transaction queues every later one.
      - Bump "Next free number".

## Test Strategy

**`tests/evm_relayer_config.rs`** (mirrors `stellar_relayer_config.rs`, using `ENV_LOCK` and a unique chain id):

- Boots with only the signer key, registry address and an RPC URL. This is today's v5 blocker.
- Errors without the signer key, and without the registry address.
- The RPC URL falls back to `CHAIN_<id>_ETH_RPC_URL`.
- The minter list:
  - unset gives an empty list, so the phase is off;
  - a CSV gives every entry;
  - a malformed entry fails;
  - lowercase input comes out of `minter_ids()` EIP-55 checksummed (the D3 invariant).
- `JOB_RELAYER_EVM_BATCH_SIZE`: the default and an override both work.

**`tests/wire_in_match.rs`** (the moved test):

- The existing cases still pass.
- Add one case driving the phase with a checksummed EVM minter id through the in-memory matcher.

**The whitelist phase** has no unit tests, matching Soroban, and is verified manually.

**Manual, on Hoodi v5 (chain 560048):**

1. Configure:
   - `JOB_RELAYER_ENABLED=true`;
   - `CHAIN_560048_RELAYER_REGISTRY_ADDRESS=0x156522dD43cda74D0489F8B601a5622D4bbBB9A0`;
   - a signer holding `WHITELIST_MANAGER_ROLE`;
   - the indexer listing DepositManager `0x7A8B7628Cd2DdE7E065F1BB441A0A8AcA993c1a9`.
2. With a KYC-cleared depositor, check that:
   - exactly one `allow` is confirmed;
   - `cast call … isAllowed` returns true;
   - the `lp_profiles` row is marked.
3. With a signer lacking the role: each candidate logs a failed submit, and the database is untouched.

**Gates:** `cargo fmt --all`, `cargo clippy --all -- -D warnings`, `cargo test --all`, `npx tsx scripts/lint-docs.ts`.

## Docs to Update

Update the spec first (docs-first rule), then the rest.

- **`docs/product-specs/relayer-service.md`**
  - §3 and §4: on EVM v5 the relayer mints no yield; `PipelineMinter.repay` mints in the same call.
  - §5 and Role Assignments:
    - the EVM relayer holds `WHITELIST_MANAGER_ROLE` and calls `allow` only;
    - revocation is DB-only on both chains.
- **`docs/references/backend.md`**
  - Add an "EVM relayer" section next to the Soroban one, covering the phases, env vars and role prerequisite.
  - Make the Phase 5 paragraph chain-neutral: add the EVM gate key and the D3 row shape.
  - Reword "parallel to EVM Phase 4" in the Stellar yield-mint section.
- **`ARCHITECTURE.md`:** the per-chain task paragraph names `relayer/evm/` alongside the Stellar relayer.
- **`docs/superpowers/specs/2026-06-02-yield-minter-relayer-design.md`:** mark the status as superseded by the `pipeline-contracts` rework (#41–#50).
