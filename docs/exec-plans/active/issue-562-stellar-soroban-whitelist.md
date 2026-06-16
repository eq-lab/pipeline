# Issue #562: Stellar/Soroban: relayer whitelist via access_manager.set_authorized

Source: https://github.com/eq-lab/pipeline/issues/562

## Scope

Extend the relayer's Phase 3 (whitelist sync) so it works on Stellar/Soroban chains by invoking `access_manager.execute(set_authorized)` on the PLUSD SAC, mirroring the EVM behaviour where the relayer calls `WhitelistRegistry.allow(address)` on the EVM whitelist contract. Today the relayer is hardcoded EVM-only — `RelayerJobSettings::all_evm_from_env` (`packages/worker/src/relayer/config.rs:64`) silently drops Stellar chains.

### In scope

- **Chain-kind dispatch at the relayer layer.** Mirrors the existing indexer pattern (`IndexerSettings::{Evm, Stellar}` + `run_indexer_job` / `run_stellar_indexer_job`):
  - Rename `RelayerJobSettings` → `EvmRelayerSettings`.
  - Add new `StellarRelayerSettings`.
  - Wrap in `RelayerSettings::{Evm, Stellar}` with `all_from_env()` dispatching on `parse_chain_type`.
  - `worker/main.rs` matches the variant and spawns either `run_relayer_job` (existing, EVM) or a new `run_stellar_relayer_job`.
- **Parallel phase functions, no trait abstraction.** Two functions:
  - `phase_sync_whitelist` (existing, EVM, unchanged signature aside from the renamed `EvmRelayerSettings` consumer).
  - `phase_sync_whitelist_stellar` — new, lives in `worker/src/relayer/stellar/whitelist.rs`. Each function has the right types in its signature and pulls in only the deps it needs. Some loop scaffolding is duplicated; that is preferred over a `dyn Whitelister` / `async_trait` layer for just two impls.
- **Address case-sensitivity for Stellar in `KycRepo` (closes TD-16).**
  - Add `populate_profiles_from_deposits_stellar(chain_id) -> Result<u64>` — same SQL minus the `LOWER(params->>'user')` wrap. Mirrors the `_case_sensitive` variants added in #555 (`get_deposit_request_case_sensitive`).
  - Add `fetch_profiles_to_allow_stellar(chain_id, sumsub_enabled) -> Result<Vec<WhitelistCandidate>>` — drops `LOWER` on both sides of the EXISTS join, and drops the `crystal_kyt_status = 1` gate entirely (Crystal does not support Stellar today; per #555 the column stays NULL).
  - The EVM methods are untouched. EVM behaviour is bit-for-bit identical to today.
- **`StellarWhitelister` (struct + plain methods, no trait).** Lives in `packages/worker/src/relayer/stellar/whitelist.rs`. Owns:
  - `rpc: StellarRpc` (the shared client, extended — see below).
  - `network_passphrase: String`.
  - `access_manager_id: stellar_strkey::Contract`.
  - `plusd_sac_id: stellar_strkey::Contract`.
  - `signing_key: ed25519_dalek::SigningKey` (constructed directly from a `stellar_strkey::ed25519::PrivateKey` parsed at startup — no `shared::stellar_signer` wrapper; the voucher signer in `shared::stellar_voucher` stays unchanged).
  - Methods: `is_already_authorized(addr_strkey: &str) -> Result<bool>` and `submit_set_authorized(addr_strkey: &str) -> Result<()>`.
- **Soroban tx submission, hand-rolled.** Extend `packages/worker/src/indexer/stellar/rpc.rs::StellarRpc` (single shared client — no parallel module) with:
  - `simulate_transaction(envelope_xdr_base64) -> Result<SimulateResponse>` — returns resource fees, auth entries, the latest ledger seq, and either a `result: ScVal` (for view calls) or an error.
  - `send_transaction(envelope_xdr_base64) -> Result<SendResponse>` — returns `{status, hash}`.
  - `get_transaction(hash) -> Result<TxStatusResponse>` — polled to terminal.
  - Deserialisers stay lean (only fields actually consumed by the whitelister).
  - New `packages/worker/src/relayer/stellar/tx.rs` builds the `Operation` ScVal (alphabetically-sorted contracttype map: `args`, `function`, `predecessor`, `salt`, `target`), wraps in `InvokeContractArgs { contract_address: access_manager_id, function_name: "execute", args: [Operation, Address(signer_pubkey)] }`, assembles the `TransactionEnvelope::Tx(...)` with one `InvokeHostFunction` op + `SorobanTransactionData` from simulate + auth entries, hashes via `TransactionSignaturePayload { network_id: sha256(passphrase), tagged_transaction: Tx(...) }`, signs with ed25519, base64-encodes, submits.
- **Idempotency: try `is_authorized` first; fall back to DB-only on absence.**
  - The first impl step is to verify the PLUSD SAC exposes `is_authorized(id: Address) -> bool` against a deployed testnet SAC. If yes, `is_already_authorized` calls it via `simulate_transaction` with no signing/submit and parses the return `ScVal::Bool` — mirrors the EVM `isAllowed` short-circuit.
  - If the view is unexpectedly absent, document in code comments and rely solely on `lp_profiles.on_chain_allowed = false` as the gate. The access-manager's `hash_operation(...)` dedup means a duplicate submit just wastes a fee — not a correctness bug.
- **Stellar relayer config (new env vars under `CHAIN_<id>_RELAYER_STELLAR_*`):**
  - `RPC_URL` — Soroban RPC endpoint. Fallback: `CHAIN_<id>_STELLAR_RPC_URL` (indexer's URL).
  - `NETWORK_PASSPHRASE` — fallback: `CHAIN_<id>_STELLAR_NETWORK_PASSPHRASE`.
  - `ACCESS_MANAGER_ID` — `C…` Strkey of the access-manager contract.
  - `PLUSD_SAC_ID` — `C…` Strkey of the PLUSD SAC.
  - `SIGNER_SECRET` — Strkey `S…` ed25519 seed. The corresponding `G…` address must hold the `executor` role on the access-manager (granted out-of-band via `just grant-executor` in `pipeline-stellar-contracts/deployments/justfile`).
- **Crystal force-disabled on Stellar.** At config-build time, `StellarRelayerSettings.crystal_enabled` is hard-coded to `false` regardless of the global `CRYSTAL_ENABLED`. Reason: Crystal does not support Stellar today (#555 plan §"Crystal KYT for Stellar"); leaving it enabled would gate every Stellar profile on `crystal_kyt_status = 1` (never set) forever and Phase 3 would do nothing. Sumsub remains enabled per the global toggle — Sumsub identity is wallet-scoped (`multi-chain-kyc-sharding.md`).
- **Phase 4 (yield-mint) on Stellar: skipped at dispatch.** `run_stellar_relayer_job` only runs Phase 0 (Stellar-aware populate) and Phase 3 (Stellar-aware whitelist sync). No stub, no warning log — mirrors how `run_stellar_indexer_job` only runs the indexer phases relevant to Stellar.
- **`.env.example`** updated with the new Stellar relayer block.

### Out of scope (explicit)

- Off-chain assignment of the `executor` role to the relayer signer — one-time deploy step via `just grant-executor` in `pipeline-stellar-contracts`. Failure mode if not granted (`#[only_role(caller, "executor")]` rejects the tx) is documented in code comments and surfaced in tracing.
- `set_authorized(false)` / revocation — matches EVM Phase 3, which only adds. Admin flow handles revoke.
- Frontend changes.
- Phase 4 (yield-mint) Stellar support — no Soroban YieldMinter exists.
- KMS/BitGo-backed signer for the Stellar relayer key — the plaintext `S…` seed mirrors today's `STELLAR_VERIFIER_SECRET` (TD-14). A new TD entry will be opened for the relayer signer KMS gap.
- Crystal-Stellar wiring — same deferral as #555.
- Touching the EVM `populate_profiles_from_deposits` / `fetch_profiles_to_allow` SQL — EVM behaviour is preserved bit-for-bit.
- A shared `Ed25519Signer` abstraction in `shared/`. The voucher signer (`shared::stellar_voucher::StellarVoucherSigner`) stays as-is; the relayer constructs its `SigningKey` inline. Different roles, different keys, different signing payloads — a shared wrapper buys little.

## Assumptions and Risks

- **`Operation` XDR layout parity.** The `stellar_governance::timelock::storage::Operation` struct is `#[contracttype]`, which `soroban-sdk` serialises as an `ScVal::Map` of alphabetically-sorted `(ScSymbol, ScVal)` entries (the convention reproduced in `shared::stellar_voucher::domain_xdr`). Alphabetical field order: `args`, `function`, `predecessor`, `salt`, `target`. **Risk:** if our `stellar-xdr` reproduction drifts from `soroban-sdk`'s `to_xdr`, the access-manager's `hash_operation(e, &operation)` computes a different ID and the salt-based dedup is wrong. **Mitigation:** golden-fixture test against a deployed testnet access-manager — feed a fixed `(target, address, salt)` into our XDR encoder, ask the live contract for `hash_operation(...)` via `simulateTransaction`, assert equality. Same pattern as `shared::stellar_voucher::tests::golden_digest_fixture`.
- **`is_authorized` SAC view exists.** The Stellar Asset Contract standard interface exposes `is_authorized(id: Address) -> bool`. The PLUSD SAC is a deployed SAC (`deploy-asset` recipe), so this should be available. The implementer **verifies first** via `stellar contract invoke --send=no -- is_authorized --id <addr>` against the testnet SAC. **Fallback:** if absent, document and rely on `lp_profiles.on_chain_allowed` for idempotency (the access-manager salt scheme dedups at the contract layer; a duplicate submit is just a wasted fee, not a correctness bug).
- **Salt freshness.** Generate a fresh 32-byte salt per submit via `getrandom` (already in the workspace dep tree via ed25519-dalek). Two submits in the same cycle for the same address would otherwise collide on `hash_operation`.
- **Stellar chain rows in `lp_profiles` are empty today (TD-16).** This Issue extends `populate_profiles_from_deposits` for Stellar so Phase 3 has data to iterate. The Stellar `params->>'user'` is uppercase `G…` Strkey (`worker/src/indexer/stellar/parsers.rs` writes verbatim) — the inserted `wallet_address` must preserve case; any `LOWER(...)` rewrite breaks Strkey checksums.
- **No Crystal for Stellar.** `crystal_enabled` is force-disabled on Stellar configs. Sumsub stays under the global toggle; if Sumsub is enabled and a Stellar wallet hasn't been reviewed, the profile sits with `sumsub_kyc_status = NULL` and is not selected by `fetch_profiles_to_allow_stellar`. Matches EVM behaviour.
- **Single executor account per chain.** Submitting auth-required Soroban txs from one account is sequential by sequence number. Per-cycle this is fine (small fanout); the in-loop submit stays sequential.
- **Soroban RPC simulate→submit→poll lifecycle.** Each submit takes 3 RPC calls: `simulateTransaction` (returns `SorobanTransactionData`, auth entries, resource fees), `sendTransaction` (returns `PENDING|DUPLICATE|TRY_AGAIN_LATER|ERROR` + hash), `getTransaction(hash)` polled until `SUCCESS`/`FAILED`. Tx finality on Stellar is ~5s per ledger; poll every 1s up to ~30s.
- **Dependency layout.** `stellar-xdr` and `stellar-strkey` are already workspace deps used by `shared` and `worker::indexer::stellar`. `ed25519-dalek` is in `shared`; the worker already depends on `shared`. The worker depends on `shared`'s re-exported `ed25519-dalek` (or adds it as a direct dep if cleaner — preference is to thread through `shared` to keep the version pin single-sourced). No new top-level crates.

## Open Questions

_None_ — resolved via brainstorming (see also `Resolved Decisions` below).

## Resolved Decisions

These are recorded so future readers see what was considered and rejected:

1. **TD-16 inline vs. separate Issue.** **Inline.** Without seeded Stellar `lp_profiles`, Phase 3 has nothing to iterate — the whitelist code would be dead in prod until a follow-up shipped.
2. **`Whitelister` trait abstraction vs. parallel phase functions.** **Parallel functions.** Mirrors the indexer's `run_indexer_job` / `run_stellar_indexer_job` pattern. Two impls don't justify `async_trait` + `dyn` friction.
3. **ed25519 signer location.** **Inline in the worker via `ed25519_dalek::SigningKey`.** No shared abstraction. Voucher signer in `shared::stellar_voucher` stays untouched.
4. **Settings naming.** **Rename `RelayerJobSettings` → `EvmRelayerSettings`, add `StellarRelayerSettings`, wrap in `RelayerSettings::{Evm, Stellar}` enum.** Symmetric and unambiguous at every call site.
5. **Phase 4 on Stellar.** **Skip at dispatch.** No stub, no warning log.
6. **Soroban tx submission strategy.** **Hand-roll with `stellar-xdr` + `reqwest`.** Matches the existing indexer pattern; zero new SDK deps; we own all the XDR semantics.
7. **Idempotency strategy.** **Try `is_authorized` first; fall back to DB-only on absence.** Implementer verifies SAC support against testnet as the first impl step.

## Implementation Steps

<!-- Progress: code complete 2026-06-15; step 1 deferred to local manual verification (the implementation falls back gracefully). -->

### 1. Verify `is_authorized` on the PLUSD SAC (testnet probe) [DEFERRED]

Deferred to local testing. The whitelister implementation tries `authorized(user)` on the PLUSD SAC via `simulateTransaction`; if the simulate errors (e.g., the view is named differently), it logs at debug and falls through to submit, where the access-manager's salt-based dedup keeps the call correct (just costs a fee on the duplicate). The user will probe this against a real testnet SAC during local validation.

- Use the deployed testnet SAC from `.env.example` or the sibling repo's `deployments/testnet.json`.
- `stellar contract invoke --id <PLUSD SAC> --source-account <any G…> --network testnet --send=no -- is_authorized --id <some G…>`. Confirm it returns a `bool`.
- If absent, record in this exec plan and switch to DB-only idempotency before continuing.

### 2. Chain-kind dispatch at the relayer config layer [DONE]

- File: `packages/worker/src/relayer/config.rs`
- Rename `RelayerJobSettings` → `EvmRelayerSettings`. Update all references in `relayer_job.rs`, `worker/main.rs`, and any tests.
- Add `StellarRelayerSettings` with fields: `chain_id`, `interval_secs`, `rpc_url`, `network_passphrase`, `access_manager_id: stellar_strkey::Contract`, `plusd_sac_id: stellar_strkey::Contract`, `signing_key: ed25519_dalek::SigningKey`, `sumsub_enabled`, `crystal_enabled: bool` (forced to `false` at construction), `batch_size: usize` (default 50).
  - `from_chain_env(chain_id)` reads `CHAIN_<id>_RELAYER_STELLAR_RPC_URL` (fallback `CHAIN_<id>_STELLAR_RPC_URL`), `..._NETWORK_PASSPHRASE` (fallback `CHAIN_<id>_STELLAR_NETWORK_PASSPHRASE`), `..._ACCESS_MANAGER_ID`, `..._PLUSD_SAC_ID`, `..._SIGNER_SECRET` (parse via `stellar_strkey::ed25519::PrivateKey::from_string` → `SigningKey::from_bytes`).
  - Promote `indexer::config::validate_contract_id` to `shared::chains` (so `Strkey` validation has one definition for both configs).
- Add the dispatcher:
  ```rust
  pub enum RelayerSettings {
      Evm(EvmRelayerSettings),
      Stellar(StellarRelayerSettings),
  }
  impl RelayerSettings {
      pub fn all_from_env() -> Result<Vec<Self>> { /* dispatches on parse_chain_type */ }
      pub fn chain_id(&self) -> i64 { … }
  }
  ```
- Delete `RelayerJobSettings::all_evm_from_env` and the `#[deprecated] all_from_env`.

### 3. Spawn per-chain relayer tasks in `worker/main.rs` [DONE]

- File: `packages/worker/src/main.rs`
- Iterate `RelayerSettings::all_from_env()`. For each entry, dispatch by variant: `Evm` → `run_relayer_job(settings, kyc_repo)`; `Stellar` → `run_stellar_relayer_job(settings, kyc_repo)`.

### 4. Extend `KycRepo` for case-sensitive Stellar populate + fetch [DONE]

- File: `packages/shared/src/kyc_repo.rs`
- Add `populate_profiles_from_deposits_stellar(chain_id) -> Result<u64>` — same as the existing method without the `LOWER(...)` wrap.
- Add `fetch_profiles_to_allow_stellar(chain_id, sumsub_enabled) -> Result<Vec<WhitelistCandidate>>` — no `LOWER`, no `crystal_kyt_status` filter. Two branches only (sumsub enabled/disabled).
- EVM methods stay untouched.

### 5. New `packages/worker/src/relayer/stellar/` module [DONE]

- File: `packages/worker/src/relayer/mod.rs` — add `pub mod stellar;`.
- File: `packages/worker/src/relayer/stellar/mod.rs` — exports `run_stellar_relayer_job`, `StellarWhitelister`.
- File: `packages/worker/src/relayer/stellar/whitelist.rs`:
  - `StellarWhitelister` struct (fields per "In scope" above).
  - `pub async fn is_already_authorized(&self, addr_strkey: &str) -> Result<bool>` — builds an `InvokeContract(plusd_sac, "is_authorized", [ScAddress::Account(addr)])` envelope and calls `simulate_transaction`. Parses the return `ScVal::Bool`. If the simulate returns an "unsupported function" / similar error, falls through to `Ok(false)` (the caller will then submit, and at worst we waste a fee).
  - `pub async fn submit_set_authorized(&self, addr_strkey: &str) -> Result<()>` — builds the `Operation` ScVal, wraps in `InvokeContractArgs(access_manager_id, "execute", [Operation, Address(signer_pubkey)])`, simulates → signs → submits → polls. Returns `Ok(())` on `SUCCESS`, `Err` with diagnostic XDR on `FAILED`.
  - `pub async fn phase_sync_whitelist_stellar(...)` — the parallel of `phase_sync_whitelist`. Reads candidates via `KycRepo::fetch_profiles_to_allow_stellar`, for each one calls `is_already_authorized` → on `true` flips DB and continues; otherwise `submit_set_authorized` → on `Ok` flips DB.
- File: `packages/worker/src/relayer/stellar/tx.rs` — pure helpers (no I/O):
  - `pub fn build_operation_scval(target: &Contract, addr: &PublicKey, salt: [u8;32]) -> ScVal` — the alphabetically-sorted contracttype map for `Operation`.
  - `pub fn build_invoke_envelope(...)` — assembles `Transaction` with one `OperationBody::InvokeHostFunction { HostFunction::InvokeContract { … } }`, attaches `SorobanTransactionData` from the simulate response.
  - `pub fn sign_envelope(envelope: &mut TransactionEnvelope, signing_key: &SigningKey, network_passphrase: &str)` — computes the `TransactionSignaturePayload`, sha256-hashes, signs, wraps in `DecoratedSignature { hint: last_4_bytes_of_pubkey, signature }`.
  - All unit-testable without RPC.
- File: `packages/worker/src/relayer/stellar/job.rs` — `pub async fn run_stellar_relayer_job(settings: StellarRelayerSettings, kyc_repo: Arc<KycRepo>) -> Result<()>`:
  - Constructs the `StellarRpc` + `StellarWhitelister`.
  - Loop: Phase 0 (`populate_profiles_from_deposits_stellar`) → Phase 3 (`phase_sync_whitelist_stellar`) → `sleep(interval_secs)`.

### 6. Extend `StellarRpc` with the submit/poll surface [DONE]

- File: `packages/worker/src/indexer/stellar/rpc.rs` (shared client — extend in place).
- Add `simulate_transaction`, `send_transaction`, `get_transaction` methods + their minimal response structs. Keep deserialisers lean (only fields actually consumed: `latestLedger`, `transactionData` base64, `events`/`results`, `cost`, `auth` for simulate; `status`, `hash` for send; `status`, `returnValue`, `resultXdr` for get).

### 7. `.env.example` update [DONE]

- Append a Stellar relayer block under the existing `CHAIN_99000001_*` section:
  ```env
  # Stellar relayer (Phase 0 + Phase 3 — whitelist sync via access-manager.execute(set_authorized))
  CHAIN_99000001_RELAYER_STELLAR_ACCESS_MANAGER_ID=C…
  CHAIN_99000001_RELAYER_STELLAR_PLUSD_SAC_ID=C…
  CHAIN_99000001_RELAYER_STELLAR_SIGNER_SECRET=S…
  # Optional — fall back to the indexer's URL / passphrase when unset
  # CHAIN_99000001_RELAYER_STELLAR_RPC_URL=…
  # CHAIN_99000001_RELAYER_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
  ```
- Comment block notes:
  - The `S…` SIGNER_SECRET's `G…` address must already hold the `executor` role on the access-manager (one-time grant via `just grant-executor <address>` in `pipeline-stellar-contracts/deployments/justfile`).
  - Crystal is force-disabled on Stellar.

### 8. Close TD-16 and open a new TD entry [DONE]

- File: `docs/exec-plans/tech-debt-tracker.md`
- Mark TD-16 resolved with a pointer to #562.
- Add a new TD: "Stellar relayer signer is a plaintext `S…` seed — replace with KMS/BitGo provisioning." Mirrors TD-14 for the API voucher key.

### 9. Update specs / design docs [DONE]

- `docs/design-docs/multi-chain-kyc-sharding.md` — append a "Stellar Relayer Whitelist" section parallel to "Stellar Voucher Signing", describing the access-manager → set_authorized path, the executor-role precondition, and the `crystal_enabled = false` forcing.
- `docs/design-docs/whitelist-enforcement-model.md` — one-paragraph Stellar addendum: same allowlist semantics; the enforcement primitive is the SAC's `is_authorized` flag, gated by the access-manager's timelock-aware `execute(set_authorized)` entrypoint.
- `docs/product-specs/relayer-service.md` — one-line note under §"On-chain actions" that the on-chain mechanism is chain-specific (`WhitelistRegistry.allow` on EVM, `access_manager.execute(set_authorized)` on Stellar).

## Test Strategy

### Unit tests

- `relayer/stellar/tx.rs`:
  - `operation_scval_alphabetical_order` — assert the produced `ScVal::Map` entries are in alphabetical key order (`args` < `function` < `predecessor` < `salt` < `target`), matching `soroban-sdk` `to_xdr`.
  - `operation_scval_deterministic` — same inputs produce byte-identical XDR across two encodes.
  - `random_salt_changes_op_hash` — verify two consecutive calls produce different `hash_operation` outputs (smoke-check the salt is actually random).
  - `golden_operation_hash_against_testnet` — `#[ignore]`d live test: simulate `access_manager.hash_operation(...)` against the deployed testnet contract, assert our local `sha256(xdr(Operation))` matches. Mirrors `shared::stellar_voucher::tests::golden_digest_fixture` — instructions for re-deriving the golden value live in the test comment.
  - `signature_payload_round_trip` — feed a fixed envelope + network passphrase, assert the signature verifies under the signer's `VerifyingKey`.
- `relayer/stellar/whitelist.rs`:
  - `is_already_authorized_short_circuit` — given a mock RPC client whose `simulate_transaction` returns `ScVal::Bool(true)`, `submit_set_authorized` is never called.
  - `submit_set_authorized_happy_path` — mock RPC: simulate returns a stub `SorobanTransactionData`, send returns `PENDING`, get returns `SUCCESS`. Assert `Ok(())`.
  - `submit_set_authorized_failed_tx` — mock get returns `FAILED` with a diagnostic XDR. Assert `Err` containing the diagnostic.
- `KycRepo`:
  - `populate_profiles_from_deposits_stellar_preserves_case` — insert a Stellar `contract_logs` row with uppercase `G…`, assert `lp_profiles.wallet_address` equals the original.
  - `fetch_profiles_to_allow_stellar_skips_crystal_gate` — set sumsub=Green, crystal=NULL; assert the profile is selected.
  - EVM regression: existing `fetch_profiles_to_allow` and `populate_profiles_from_deposits` tests must still pass unchanged.
- `config::RelayerSettings`:
  - `dispatches_evm_and_stellar` — set `CHAINS=1,99000001`, `CHAIN_99000001_TYPE=stellar`; assert one `Evm` + one `Stellar` variant.
  - `stellar_force_crystal_disabled` — even with `CRYSTAL_ENABLED=true`, `StellarRelayerSettings.crystal_enabled` is `false`.
  - `stellar_signer_invalid_strkey` — bad `SIGNER_SECRET` returns a clear error.

### Integration / e2e

- A live Stellar testnet end-to-end run is **not** a CI gate (no testnet credentials in CI). Runbook:
  1. Deploy a fresh access-manager + PLUSD SAC via the sibling repo's justfile.
  2. Grant the relayer's `G…` address the `executor` role (`just grant-executor`).
  3. Seed a `lp_profiles` row (or trigger a Stellar `DepositRequested` via the request-queue contract to let Phase 0 do it).
  4. Run the worker with `CHAINS=99000001`, `CHAIN_99000001_TYPE=stellar`, the new env vars set.
  5. Verify `is_authorized(<addr>) = true` on the SAC via `stellar contract invoke ... --send=no -- is_authorized`.
  6. Append the observed tx hashes + outcome to this exec plan as a manual-test record before closing the Issue.

### Regression

- `cargo clippy --all -- -D warnings`.
- `cargo test -p pipeline-worker -p shared`.
- `npx tsx scripts/lint-docs.ts` on the doc changes.
- `grep -rn 'RelayerJobSettings' packages/` should return zero hits after the rename.

## Docs to Update

- `docs/design-docs/multi-chain-kyc-sharding.md` — append "Stellar Relayer Whitelist" section.
- `docs/design-docs/whitelist-enforcement-model.md` — Stellar addendum.
- `docs/product-specs/relayer-service.md` — one-line chain-mechanism note.
- `docs/exec-plans/tech-debt-tracker.md` — close TD-16; open new TD for the relayer signer KMS gap.
- `.env.example` — Stellar relayer block.
