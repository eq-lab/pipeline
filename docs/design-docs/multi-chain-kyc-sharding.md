# Multi-Chain KYC Sharding: `lp_profiles` and `kyc_outbox`

## Context

Pipeline is expanding from a single-EVM-chain deployment to a multi-chain model (Issue #439). KYC/whitelist state was previously stored in globally-keyed tables (`wallet_address` as the primary key). With multiple chains, a single wallet address can exist independently on each chain, and regulators may require chain-scoped enforcement.

## Decision

Shard `lp_profiles` and `kyc_outbox` by chain. Add `chain_id BIGINT NOT NULL` to both tables and change the primary key of `lp_profiles` to `(chain_id, wallet_address)`. See migration `20260606000001_lp_profiles_kyc_outbox_chain_id.sql`.

## Rationale

1. **Defense-in-depth per chain.** A regulator can order the operator to block a wallet on chain A without affecting that wallet's KYC status on chain B.
2. **Per-chain audit isolation.** Compliance reports can be produced per chain without joining across chains.
3. **Future-proof for Stellar.** Stellar and EVM address formats differ. Two chains may independently authenticate different physical persons who happen to share an address string representation — sharding avoids false matches.
4. **Blast-radius containment.** A KYC database compromise or regulatory action on one chain does not cascade to all chains.

## Consequences

### Code changes (Issue #439)

- `kyc_repo::get_lp_profile(chain_id, wallet)` — primary lookup now scoped.
- `kyc_repo::is_on_chain_allowed(chain_id, wallet)` — Q4=A: strict per-chain. A missing `(chain_id, wallet)` row returns `false`.
- `kyc_repo::populate_profiles_from_deposits(chain_id)` — takes a chain filter and upserts the `(chain_id, wallet)` pairs that appear in `contract_logs.DepositRequested` for that chain. The per-chain relayer task calls this with its own `chain_id` every cycle.
- `kyc_repo::insert_outbox(chain_id, wallet, ...)` — outbox rows are chain-scoped.
- All `lp_profiles` and `kyc_outbox` writes/reads in the relayer are chain-scoped (passed down from `RelayerJobSettings.chain_id`).
- KYC API routes (`/v1/kyc/*`) accept an optional `chain_id` query param falling back to `DEFAULT_CHAIN_ID`.

### Sumsub webhook handling

Sumsub webhooks carry only `external_user_id` (wallet address), not a chain identifier. The webhook handler updates lp_profiles rows for **all chains** that have a profile for that wallet. This means a single Sumsub review propagates KYC status across all chains (wallet identity is Sumsub-scoped). The per-chain `on_chain_allowed` flag is set separately by the relayer per chain.

### Operational consequences

- Existing single-chain installs: migration **derives** the backfill `chain_id` from `contract_logs` (uses the single distinct chain ID present there, falling back to `1` only if `contract_logs` is empty). If `contract_logs` already contains more than one distinct `chain_id`, the migration **aborts** with an explicit error — backfill would be ambiguous and a manual shard is required. No data loss.

### Known limitation: second-chain KYC propagation

Sumsub identity is wallet-scoped, but webhook firings are status-change-driven. This creates a gap when a wallet that's already KYC'd on chain A makes its first deposit on chain B:

1. The chain B relayer's `populate_profiles_from_deposits(B)` creates an `(B, wallet)` row with `sumsub_kyc_status = NULL`.
2. `fetch_profiles_to_allow(B, ...)` filters on `sumsub_kyc_status = Green` — the new row is **not** selected, so the relayer does not whitelist the wallet on chain B.
3. The Sumsub webhook would update the chain B row (the atomic `UPDATE ... WHERE wallet_address = $1` touches every chain's row in one statement), but **Sumsub does not re-fire** for an unchanged identity, so the chain B row stays `NULL` indefinitely.

In effect, a wallet is auto-onboarded for whitelisting only on chains that exist at the moment a Sumsub status change fires. Wallets that touch a new chain *after* their last status change are stuck.

**Workarounds today:** (a) the operator manually re-submits the applicant in Sumsub to trigger a webhook; (b) the cross-chain admin-promote path below (deferred).

### Deferred

- **Cross-chain admin promote path** (Q4 option C): allowing an operator to copy `on_chain_allowed = true` (or, more usefully, the Sumsub status fields) from chain A to chain B for a wallet. This is the proper fix for the "second-chain KYC propagation" gap above. File as a separate Issue **before** the second chain is launched in production — without it, new-chain users will need operator intervention.
- **UX migration**: explaining per-chain KYC to users when a second chain is enabled. Out of scope for Issue #439; file separately before second chain is launched.

## Stellar `chain_id` convention

Stellar chains use sentinel values outside the EIP-155 ID space:

| Sentinel | Network |
|---|---|
| `99000001` | Stellar testnet |
| `99000002` | Stellar mainnet (reserved, not yet deployed) |

The `99_000_000+` range was chosen because it is:
1. Well outside the realistic EVM EIP-155 range (which currently extends to ~9-digit integers but is globally unique across all EVM chains).
2. Obvious on sight — any engineer querying `contract_logs WHERE chain_id > 90000000` will immediately recognise these as non-EVM rows.
3. Does **not** collide with BIP-44 coin type 148 (Stellar's registered coin type), which would place the number in the low-hundreds and risk silent collision with future Coinbase-derivative EVM chains.

The `BIGINT` column in `contract_logs` / `log_collector_state` / `lp_profiles` / `kyc_outbox` accommodates these values without DDL changes. `contract_address` on Stellar rows stores the Strkey C… format as-is (uppercase, CRC-16 checksum intact); EVM rows continue to use EIP-55 checksum encoding.

## Stellar Voucher Signing (Issue #555)

The voucher endpoints (`GET /v1/deposits/{id}/voucher`, `GET /v1/withdrawals/{id}/voucher`) dispatch on chain kind. For Stellar chains they produce a Soroban-compatible ed25519 signature instead of an EVM EIP-712 secp256k1 signature.

### On-chain digest scheme

The `request-queue` Soroban contract (`pipeline-stellar-contracts/contracts/request-queue/src/crypto.rs`) computes:

```
domain_separator = sha256( XDR(Domain { contract_separator: <dm_or_wq_address>, network_id: sha256(passphrase) }) )
voucher_hash     = sha256( XDR(Voucher { request_id: u128, sender: Address, amount: i128 }) )
digest           = sha256( domain_separator || voucher_hash )
```

The XDR encoding mirrors `soroban-sdk`'s `#[contracttype]` `to_xdr(e)` output: a `ScVal::Map` of alphabetically-sorted `(ScSymbol, ScVal)` entries (see `packages/shared/src/stellar_voucher.rs`).

### XDR parity

The `stellar-xdr` crate (v25) is used to reproduce the `to_xdr` output without pulling `soroban-sdk` into the API server (which targets `x86_64-unknown-linux-gnu`, not `wasm32-unknown-unknown`). The parity is validated by determinism and collision-resistance unit tests. A live golden-fixture test requiring a deployed testnet Soroban RPC call is documented in the source but requires manual execution (see `stellar_voucher::tests` in `packages/shared/src/stellar_voucher.rs`).

### Wallet normalisation

EVM wallets are lowercased (existing behaviour). Stellar Strkey `G…` addresses are passed verbatim — the CRC-16 checksum embedded in the Strkey makes the address case-sensitive and the indexer stores them uppercase. The `kyc_repo` lookup uses case-sensitive SQL (`params->>'user' = $3`) for Stellar chains via `get_deposit_request_case_sensitive` / `get_withdrawal_request_case_sensitive`.

### Crystal KYT for Stellar

Crystal does not provide KYT for Stellar addresses in the current integration. Stellar voucher requests fall through the `crystal_enabled` gate as "screened-as-clean" (same as EVM with Crystal disabled). A dedicated Issue can wire Crystal Stellar support when Crystal adds Stellar coverage.

### `is_on_chain_allowed` for Stellar

The same SQL runs for Stellar as for EVM — no short-circuit. Stellar voucher requests return HTTP 403 until an `lp_profiles` row exists for the wallet on the Stellar chain. Populating those rows is handled by the Stellar relayer (see "Stellar Relayer Whitelist" below).

## Stellar Relayer Whitelist (Issue #562)

The relayer's Phase 0 (profile population) and Phase 3 (whitelist sync) run for Stellar chains in parallel to the EVM path. `RelayerSettings::all_from_env` dispatches on `CHAIN_<id>_TYPE`; Stellar chains run `run_stellar_relayer_job` instead of `run_relayer_job`. Phases 1 (Sumsub) and 4 (yield-mint) are skipped.

### On-chain mechanism

Where EVM calls `WhitelistRegistry.allow(address)`, Stellar invokes `access_manager.execute(operation, caller)` where `operation = { target: PLUSD_SAC, function: "set_authorized", args: [Address(user), Bool(true)], predecessor: 0x00…, salt: <random 32 bytes> }`. The access-manager's `#[only_role(caller, "executor")]` macro requires the caller (the relayer's `G…` account, which doubles as the tx source) to hold the `executor` role — granted out-of-band via `just grant-executor <G-address>` in `pipeline-stellar-contracts/deployments`.

The `Operation` struct is encoded as `ScVal::Map` with entries alphabetically sorted by field name (`args`, `function`, `predecessor`, `salt`, `target`) — matches `soroban-sdk`'s `to_xdr(e)` for `#[contracttype]` structs, the same convention reused by `shared::stellar_voucher` for the voucher digest. A fresh random salt per submit makes `hash_operation(...)` unique, so the access-manager's dedup never collides across cycles.

### Idempotency

Phase 3 calls the SAC's `authorized(user) -> bool` view via `simulateTransaction` (no signing or submit) before each `set_authorized` call. On `true`, it skips the submit and flips `lp_profiles.on_chain_allowed` to keep the DB in sync. On error (e.g., the SAC view is unavailable), it falls through to submit — the salt-based on-chain dedup means a duplicate submit is just a wasted fee, not a correctness bug.

### Case sensitivity

`KycRepo::populate_profiles_from_deposits_stellar` and `fetch_profiles_to_allow_stellar` preserve the Strkey `G…` case (no `LOWER(...)` wrap). Lowercasing would corrupt the Strkey CRC-16 checksum and break `stellar_strkey::ed25519::PublicKey::from_string`. Mirrors the `get_deposit_request_case_sensitive` pattern from #555.

### Crystal force-disabled

`StellarRelayerSettings::from_chain_env` hard-codes `crystal_enabled = false` regardless of the global `CRYSTAL_ENABLED`. Crystal does not return KYT for Stellar addresses; gating on `crystal_kyt_status = 1` would block every Stellar profile forever. Sumsub remains under the global toggle — Sumsub identity is wallet-scoped, so EVM-side reviews propagate to Stellar `lp_profiles` rows via the existing webhook handler.
