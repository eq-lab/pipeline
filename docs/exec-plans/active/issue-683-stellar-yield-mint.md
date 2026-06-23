# Issue #683: Stellar/Soroban yield mint relayer (parallel to EVM, keypair-signed, no BitGo)

Source: https://github.com/eq-lab/pipeline/issues/683
Design (brainstorm): `docs/superpowers/specs/2026-06-19-stellar-yield-mint-design.md`

## Scope

Add a Stellar/Soroban **yield-mint phase** to the worker relayer that mirrors the
EVM Phase 4 (`packages/worker/src/relayer/yield_mint/`) but signs and submits the
Soroban `yield_minter.mint_yield(caller, loan_id, repayment_id)` invocation
**directly with the relayer ed25519 keypair — no BitGo**. The phase runs inside
the existing Stellar relayer loop (`relayer/stellar/job.rs`) so it executes in
parallel with the EVM Phase 4 (each chain already runs in its own
`tokio::spawn`ed task — see `RelayerSettings::all_from_env` /
`run_relayer_job`).

The flow reuses the existing `yield_mint_outbox` table and its 3-state machine
(`pending → submitted → confirmed`, plus `failed` / `skipped_already_minted`),
discovering work from the already-indexed Soroban `PaymentRecorded` events in
`contract_logs` (Issue #620).

**In scope**

- New Stellar yield-mint module mirroring the EVM discover → submit → confirm cycle.
- New `OutboxStore` / repo methods needed for the Stellar path (Stellar-shaped
  discovery SQL; recording the Soroban tx hash at submit time).
- New `StellarRelayerSettings` config (`yield_minter_id`, `loan_registry_id`,
  batch size) parsed from `CHAIN_<id>_RELAYER_STELLAR_*` env vars.
- Wiring the phase into `run_stellar_relayer_inner`.
- Unit/integration tests mirroring `tests/yield_mint_phase_4.rs`.

**Out of scope**

- Any change to the EVM Phase 4 behavior (must not regress).
- BitGo for Stellar (explicitly excluded — keypair signing only).
- Deploying/wiring the on-chain contracts or granting on-chain roles (operational;
  tracked as a dependency below).
- Indexing `PaymentRecorded` (already done in #620).

## Assumptions and Risks

- **Indexer prerequisite (done):** the Stellar LoanRegistry indexer (#620) writes
  `PaymentRecorded` rows into `contract_logs` with `event_name = 'PaymentRecorded'`,
  `contract_address` = loan-registry `C…` strkey.
  **CORRECTION (2026-06-23):** an earlier draft of this plan claimed the Stellar
  `params` is flattened with **top-level** `repayment_id` (reading only
  `indexer/stellar/loan_registry_parsers.rs`). That is wrong. The indexer then runs
  the `LoanEventMapper` enrichment (EVM parity, #620 — `indexer/loan_mapper.rs:448-465`)
  which re-wraps lifecycle events into `{loan_id, event:{…}, snapshot:{…}}`. The stored
  shape is therefore **identical to EVM**: `loan_id` top-level, `repayment_id` nested
  under `params->'event'`. The EVM `discover_pending` SQL body applies verbatim; only
  the `contract_address` bind value differs (`C…` strkey vs checksum). Reading
  top-level `repayment_id` caused a NOT-NULL constraint violation at runtime (TD-23).
- **On-chain guard exists:** the Soroban loan-registry exposes
  `can_yield_be_minted(loan_id: u32, repayment_id: u32) -> bool`
  (`loan-registry/src/lib.rs:377`), a direct analogue of the EVM `canYieldBeMinted`
  view. We use it as the pre-submit guard via `simulateTransaction`, exactly like
  `StellarWhitelister::is_already_authorized` decodes a `ScVal::Bool`.
- **Tx-hash retention:** Soroban RPC `getTransaction` only retains results for a
  bounded window. Because the relayer polls every `interval_secs` (default 60s),
  a tx submitted in one cycle is confirmed in the next, well inside retention.
- **Out-of-band role wiring (operational dependency):** the relayer signer keypair
  must hold the minter role on the access-manager for `mint_yield`, and the
  yield-minter must hold the executor role on the access-manager to relay the PLUSD
  mints. These are deployment steps in `pipeline-stellar-contracts` (see its
  `deployments/justfile`), not code in this repo. If unset, simulate will fail and
  rows will stay `pending` (retried) — no silent data loss, but no progress either.
- **Arg types:** `mint_yield`/`can_yield_be_minted` take `u32` loan/repayment ids;
  `contract_logs.params` stores them as decimal strings and the outbox stores
  `NUMERIC(78,0)`. Values must be range-checked into `u32` when building `ScVal::U32`
  (a value > u32::MAX is a data bug → mark `failed`, do not panic).
- **Network target:** `deployments/futurenet.json` lists `yield_minter`;
  `deployments/testnet.json` does not yet. The relayer is configured per-chain via
  env, so this is a config concern, not code — but the target network for the first
  deployment must be confirmed (see Open Questions).

## Open Questions

_Resolved during brainstorming (2026-06-19) — see design doc for rationale:_

- **Submit/confirm coupling:** **async outbox** (mirror EVM). Submit records the tx
  hash and returns; a later cycle confirms. Not the whitelister's synchronous poll.
- **On-chain `FAILED`:** **terminal `failed`** (mirror EVM); the pre-submit guard
  absorbs the common already-minted case.
- **Target network for first rollout:** **futurenet** (yield_minter already deployed
  at `CAPPCX2…`); code stays env-driven / network-agnostic.
- **Outbox storage:** **reuse** `yield_mint_outbox` (no migration).
- **Config presence:** yield-minter / loan-registry contract ids are **optional**;
  phase is skipped when unset so existing Stellar deployments are unaffected.

## Implementation Steps

### 1. Outbox repo: Stellar discovery + submit-marking

In `packages/shared/src/yield_mint_outbox_repo.rs`:

- Add `YieldMintOutboxRepo::discover_pending_stellar(chain_id, yield_minter_address, loan_registry_contract_id)`.
  Filter `contract_address = $3` against the loan-registry **`C…` strkey** (no EIP-55
  checksum). **CORRECTION (2026-06-23):** read `loan_id` top-level
  (`cl.params->>'loan_id'`) and `repayment_id` nested
  (`cl.params->'event'->>'repayment_id'`) — i.e. the **same JSON paths as the EVM
  `discover_pending`**, because the indexer's `LoanEventMapper` enrichment nests it
  under `event`. The earlier "read top-level `repayment_id`" instruction was wrong and
  caused a NOT-NULL violation. `ON CONFLICT DO NOTHING`.
- Add an `OutboxStore` trait method to record a Stellar submit with the tx hash
  available up front:
  `async fn mark_submitted_stellar(&self, key: &OutboxKey, tx_hash: &str) -> Result<()>`
  — sets `status = 'submitted'`, `tx_hash = $1`, `submitted_at = NOW()`, guarded by
  `status = 'pending'` (leaves `bitgo_tx_request_id` NULL, which is nullable).
  Implement it on `YieldMintOutboxRepo` and on the test `InMemoryOutbox`.
- `mark_confirmed`, `mark_failed`, `mark_skipped_already_minted`, `list_pending`,
  `list_submitted` are reused as-is (they key on `chain_id` + `yield_minter_address`,
  already chain-agnostic).

### 2. ScVal helper for `u32`

In `packages/worker/src/stellar/tx.rs` (alongside `address_account`/`symbol`), add:

```rust
pub fn u32_val(n: u32) -> ScVal { ScVal::U32(n) }
```

(Or inline `ScVal::U32(..)` at call sites — a tiny helper keeps it consistent with
the existing `symbol`/`address_*` helpers.)

### 3. Stellar yield-minter submitter

New file `packages/worker/src/relayer/stellar/yield_mint.rs` (registered in
`relayer/stellar/mod.rs`). Model it on `StellarWhitelister`:

- Struct `StellarYieldMinter { chain_id, rpc: StellarRpc, network_passphrase,
  yield_minter_id: ContractStrkey, loan_registry_id: ContractStrkey,
  signing_key: SigningKey, signer_pubkey: Ed25519Pub }`.
- `async fn can_yield_be_minted(&self, loan_id: u32, repayment_id: u32) -> Result<bool>`:
  build a view envelope invoking `loan_registry.can_yield_be_minted(loan_id, repayment_id)`
  (args `[u32_val, u32_val]`), `simulate_transaction`, decode `ScVal::Bool` — mirror
  `is_already_authorized` (return `Err` on transient RPC failure so the caller retries;
  decode failure → treat conservatively, see submit logic).
- `async fn submit_mint_yield(&self, loan_id: u32, repayment_id: u32) -> Result<String>`:
  simulate → fetch sequence → build real envelope invoking
  `yield_minter.mint_yield(caller = signer, loan_id, repayment_id)` with the auth
  entries + soroban data from simulate → `sign_envelope` → `send_transaction`;
  accept `PENDING`/`DUPLICATE`; return the tx **hash** (do NOT poll here). Reuse the
  `decode_soroban_data` / `decode_auth_entries` helpers (extract them to a shared
  spot in `relayer/stellar/` or duplicate — prefer extracting to avoid drift).
- `async fn check_tx(&self, tx_hash: &str) -> Result<Option<bool>>`: one
  `get_transaction` call → `Some(true)` on `SUCCESS`, `Some(false)` on `FAILED`,
  `None` while not yet terminal (mirror `TransactionReceiptView::get_receipt_status`).

To keep the orchestration unit-testable without RPC, define a trait the phase
depends on (mirroring the EVM `CanYieldBeMintedView` / `TransactionReceiptView`
split), e.g.:

```rust
#[async_trait]
pub trait StellarYieldSubmitter: Send + Sync {
    async fn can_yield_be_minted(&self, loan_id: u32, repayment_id: u32) -> Result<bool>;
    async fn submit_mint_yield(&self, loan_id: u32, repayment_id: u32) -> Result<String>;
    async fn check_tx(&self, tx_hash: &str) -> Result<Option<bool>>;
}
```

with `StellarYieldMinter` as the production impl and a mock in tests.

### 4. Phase orchestration

In the same module, add
`phase_yield_mint_stellar(settings, submitter: &dyn StellarYieldSubmitter, outbox: &YieldMintOutboxRepo)`:

- **Discover:** `outbox.discover_pending_stellar(chain_id, yield_minter_strkey, loan_registry_strkey)`.
- **Submit:** `list_pending` → for each row: range-check `loan_id`/`repayment_id`
  into `u32` (out-of-range → `mark_failed`); call `can_yield_be_minted` (transient
  err → `continue`/retry; `false` → `mark_skipped_already_minted`); else
  `submit_mint_yield` → on `Ok(hash)` `mark_submitted_stellar(key, &hash)`; on `Err`
  log + retry next cycle (no terminal failure on submit-time RPC errors, since
  `consume_yield` is idempotent on-chain so re-submission is safe).
- **Confirm:** `list_submitted` → for each row read `tx_hash`; `check_tx` →
  `Some(true)` `mark_confirmed`; `Some(false)` `mark_failed`; `None` leave for next
  cycle.
- Phase isolation: per-row errors are logged and skipped; only a DB list error
  aborts the cycle (`Err`) — same contract as EVM `phase_yield_mint`.

Settings struct `StellarPhase4Settings { chain_id, yield_minter_id: ContractStrkey,
loan_registry_id: ContractStrkey, batch_size }` (the contract-id strings used for
`discover_pending_stellar` come from these via `to_string()`).

### 5. Config

In `packages/worker/src/relayer/config.rs`, extend `StellarRelayerSettings`:

- `pub yield_minter_id: Contract` from `CHAIN_<id>_RELAYER_STELLAR_YIELD_MINTER_ID`
  (validated via `validate_contract_id` + `Contract::from_string`, like
  `access_manager_id`).
- `pub loan_registry_id: Contract` from `CHAIN_<id>_RELAYER_STELLAR_LOAN_REGISTRY_ID`.
- Reuse `JOB_RELAYER_STELLAR_BATCH_SIZE` for the yield-mint batch size (or add
  `JOB_RELAYER_YIELD_MINTER_BATCH_SIZE` if a separate knob is preferred; reuse keeps
  config surface small).

To preserve incremental rollout, make the two new contract ids **optional**: if
either is unset, log once and skip the yield-mint phase (Phase 0 + Phase 3 continue).
This avoids breaking existing Stellar deployments that have no yield-minter yet.

### 6. Wire into the Stellar loop

In `packages/worker/src/relayer/stellar/job.rs::run_stellar_relayer_inner`:
construct the `StellarYieldMinter` + `YieldMintOutboxRepo` (from `kyc_repo.pool`)
once before the loop (guarded on the optional config from step 5), and call
`phase_yield_mint_stellar(...)` after `phase_sync_whitelist_stellar(...)` each
iteration, wrapping errors in a `tracing::error!` like the EVM Phase 4 (cycle abort
must not kill the loop or the other phases).

### 7. Lint

`cargo clippy --all -- -D warnings` must pass (per AGENTS.md).

## Test Strategy

Add `packages/worker/tests/stellar_yield_mint.rs` mirroring `tests/yield_mint_phase_4.rs`:

- **Mock `StellarYieldSubmitter`** (configurable canned results + call counters) and
  reuse the existing `InMemoryOutbox` (extended with `mark_submitted_stellar`) — no
  DB, no RPC, per the project's "pure unit tests" rule (no `DATABASE_URL`/
  `POSTGRES_URL` gating).
- Orchestration cases:
  - submit: `can_yield_be_minted=false` → row `skipped_already_minted`, no submit.
  - submit: guard transient error → row stays `pending`, retried.
  - submit: `Ok(hash)` → row `submitted` with `tx_hash` set.
  - submit: submit error → row stays `pending` (no terminal failure).
  - submit: `loan_id`/`repayment_id` out of `u32` range → row `failed`.
  - confirm: `check_tx = Some(true)` → `confirmed`; `Some(false)` → `failed`;
    `None` → stays `submitted`.
- **Pure helper tests** for `StellarYieldMinter` building/decoding: envelope built
  for `mint_yield` carries the right contract id, function symbol, and
  `[Address, U32, U32]` args; `can_yield_be_minted` decodes `ScVal::Bool` correctly;
  `check_tx` maps `SUCCESS`/`FAILED`/pending to `Some(true)`/`Some(false)`/`None`.
  These follow the existing `stellar/tx.rs` deterministic-helper test style.
- Per the repo convention, all tests live in `packages/worker/tests/`, not inline
  `#[cfg(test)]` modules in `src/`.

DB-backed `discover_pending_stellar` is verified by the orchestration tests'
in-memory store; if a DB smoke test is desired it must be skipped gracefully when
`DATABASE_URL` is unset (matching the existing `discover_*` tests) — but the
canonical coverage is the pure unit tests above.

## Docs to Update

- `docs/references/backend.md` — document the Stellar yield-mint relayer phase and
  the new `CHAIN_<id>_RELAYER_STELLAR_YIELD_MINTER_ID` /
  `..._LOAN_REGISTRY_ID` env vars alongside the existing EVM Phase 4 description.
- The Stellar relayer module doc comment in `relayer/stellar/job.rs` (currently
  states "Phase 4 (yield-mint) has no Soroban counterpart") must be updated.
- If a product/relayer spec under `docs/product-specs/` or `docs/design-docs/`
  enumerates relayer phases per chain, add the Stellar yield-mint phase there.
