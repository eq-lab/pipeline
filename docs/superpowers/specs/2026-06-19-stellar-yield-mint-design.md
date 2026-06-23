# Stellar/Soroban Yield-Mint Relayer — Design

Date: 2026-06-19
Issue: [#683](https://github.com/eq-lab/pipeline/issues/683)
Related exec plan: `docs/exec-plans/active/issue-683-stellar-yield-mint.md`

## Problem

The worker relayer mints yield only on EVM today (Phase 4,
`packages/worker/src/relayer/yield_mint/`), submitting `mintYield(loanId, repaymentId)`
through BitGo custody. The protocol now also runs on Stellar/Soroban, where a
`yield-minter` contract exposes `mint_yield(caller, loan_id, repayment_id)`. We need
the equivalent automation on Stellar, signing **directly with the relayer ed25519
keypair (no BitGo)**, running **in parallel** with the EVM phase.

## Goals

- A Stellar yield-mint phase that mirrors the EVM discover → submit → confirm cycle.
- Direct keypair signing of the Soroban `mint_yield` invocation; no custody service.
- Runs inside the existing Stellar relayer loop, parallel to EVM (each chain already
  runs in its own `tokio::spawn`ed task).
- No regression to the EVM phase or to existing Stellar deployments that have no
  yield-minter configured.

## Non-Goals

- Changing EVM Phase 4 behavior.
- BitGo (or any custody service) for Stellar.
- Deploying contracts or granting on-chain roles (operational, in
  `pipeline-stellar-contracts`).
- Indexing `PaymentRecorded` — already delivered in Issue #620.

## Key Facts (from research)

- **Guard view exists:** Soroban loan-registry exposes
  `can_yield_be_minted(loan_id: u32, repayment_id: u32) -> bool`
  (`loan-registry/src/lib.rs:377`) — a direct analogue of EVM `canYieldBeMinted`.
- **On-chain idempotency:** `consume_yield` reverts if the repayment was already
  minted (`loan-registry/src/lib.rs:331`). Double-mint is impossible regardless of
  relayer behavior; the guard is an optimization, not the safety mechanism.
- **Signing/RPC plumbing already exists:** `stellar/tx.rs`
  (`build_invoke_envelope`, `sign_envelope`, `envelope_to_base64`, `address_*`,
  `symbol`), `StellarRpc` (`simulate_transaction`, `get_account_sequence`,
  `send_transaction`, `get_transaction`), and `StellarWhitelister` as a working
  template for "simulate → sign → send → poll".
- **Event shape — CORRECTION (2026-06-23):** this section originally claimed the
  Stellar indexer flattens `PaymentRecorded` with top-level `repayment_id` (based on
  the raw parser `indexer/stellar/loan_registry_parsers.rs`). That was wrong. The
  indexer then runs the `LoanEventMapper` enrichment (EVM parity, #620 —
  `indexer/loan_mapper.rs:448-465`), nesting everything but `loan_id` under an `event`
  key. The stored shape is **identical to EVM**: `loan_id` top-level, `repayment_id`
  at `params->'event'->>'repayment_id'`. The discovery SQL body is the EVM
  `discover_pending` verbatim; only `contract_address` differs (a `C…` strkey, no
  EIP-55 checksum). Reading top-level `repayment_id` caused a NOT-NULL violation in
  production (TD-23) and was fixed 2026-06-23.
- **Arg types:** `mint_yield` / `can_yield_be_minted` take `u32` ids;
  `contract_logs.params` stores decimal strings; the outbox stores `NUMERIC(78,0)`.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Confirm model | **Async outbox** (mirror EVM) | Submit stores tx hash + marks `submitted` and returns; a later cycle confirms. Never blocks the batch (vs. the whitelister's synchronous up-to-30s poll, which on 50 rows could stall a cycle ~25 min). |
| On-chain `FAILED` | **Terminal `failed`** (mirror EVM) | The guard absorbs the common already-minted case before submit, so a `FAILED` is unexpected and worth operator review — don't loop. |
| Rollout target | **Futurenet first** | `yield_minter` is already deployed on futurenet (`CAPPCX2…`); testnet has no deployment yet. Code stays env-driven and network-agnostic regardless. |
| Outbox storage | **Reuse `yield_mint_outbox`** | Table already keys on `chain_id` + `yield_minter_address`. Add Stellar-shaped discovery + a tx-hash-at-submit marker; no schema migration. |
| Config presence | **Optional contract ids** | If `YIELD_MINTER_ID`/`LOAN_REGISTRY_ID` are unset, skip the phase (log once). Existing Phase 0/3-only Stellar deployments keep working untouched. |

## Architecture

New module `packages/worker/src/relayer/stellar/yield_mint.rs`, modeled on
`StellarWhitelister`.

```
StellarYieldMinter {
    chain_id,
    rpc: StellarRpc,
    network_passphrase: String,
    signing_key: SigningKey,
    signer_pubkey: Ed25519Pub,
    yield_minter_id: ContractStrkey,
    loan_registry_id: ContractStrkey,
}
```

### Testable seam

Orchestration depends on a trait so it can be unit-tested without RPC (the EVM side
uses two traits — `CanYieldBeMintedView` + `TransactionReceiptView`; here they
collapse to one because all three calls share the same RPC client):

```rust
#[async_trait]
pub trait StellarYieldSubmitter: Send + Sync {
    /// loan_registry.can_yield_be_minted(loan_id, repayment_id) via simulate -> ScVal::Bool
    async fn can_yield_be_minted(&self, loan_id: u32, repayment_id: u32) -> Result<bool>;
    /// simulate -> sign -> send yield_minter.mint_yield(signer, loan_id, repayment_id);
    /// returns the tx hash. Does NOT poll.
    async fn submit_mint_yield(&self, loan_id: u32, repayment_id: u32) -> Result<String>;
    /// getTransaction(tx_hash): Some(true)=SUCCESS, Some(false)=FAILED, None=in-flight
    async fn check_tx(&self, tx_hash: &str) -> Result<Option<bool>>;
}
```

`StellarYieldMinter` is the production impl; tests use a configurable mock.

## Data Flow

`phase_yield_mint_stellar(settings, submitter: &dyn StellarYieldSubmitter, outbox: &YieldMintOutboxRepo)`,
called each loop iteration after `phase_sync_whitelist_stellar`.

**Discover** — `outbox.discover_pending_stellar(chain_id, yield_minter_strkey, loan_registry_strkey)`:
insert a `pending` row per `PaymentRecorded` in `contract_logs` not already tracked.
SQL: `contract_address = <loan-registry C… strkey>`, `(params->>'loan_id')::numeric`
(top-level) and `(params->'event'->>'repayment_id')::numeric` (nested — same paths as
EVM `discover_pending`; see the Event-shape correction above), `ON CONFLICT DO NOTHING`.

**Submit** — `list_pending(batch_size)`, per row:
1. Range-check `loan_id`/`repayment_id` `BigDecimal → u32`; out-of-range → `mark_failed`.
2. `can_yield_be_minted`: `Err` (transient) → `continue`; `false` → `mark_skipped_already_minted`; `true` → proceed.
3. `submit_mint_yield`: `Ok(hash)` → `mark_submitted_stellar(key, &hash)`; `Err` → log, leave `pending` (re-submit safe).

**Confirm** — `list_submitted(batch_size)`, per row read `tx_hash`, `check_tx`:
`Some(true)` → `mark_confirmed(key, tx_hash)`; `Some(false)` → `mark_failed(key, result_xdr)`;
`None` → leave `submitted`.

On-chain call args: `[Address(signer), U32(loan_id), U32(repayment_id)]`, with auth
entries + soroban-data from the simulate response (same pattern as the whitelister's
`execute`).

Phase isolation matches EVM: per-row errors are logged and skipped; only a DB list
failure returns `Err` (aborts that one cycle; loop and other phases unaffected).

## Error Handling & Invariants

- **No double-mint** regardless of relayer behavior — guaranteed by `consume_yield`.
- **At-least-once submit:** submit-time errors never go terminal; safe because of
  on-chain idempotency. Worst case is a wasted/reverted tx, surfaced as terminal
  `failed`.
- **State-guarded transitions:** `mark_*` carry `WHERE status = …`; overlapping
  cycles can't double-transition; 0-rows-affected logs a warning (existing behavior).

| Situation | Action |
|---|---|
| RPC error in guard / submit / check_tx | transient → leave row, retry next cycle |
| `can_yield_be_minted = false` | `skipped_already_minted` |
| `getTransaction = FAILED` | terminal `failed` (+ result XDR) |
| `loan_id`/`repayment_id` > `u32::MAX` | terminal `failed` (data bug, no panic) |
| phase-level DB list error | log + abort this cycle only |

## Persistence

Reuse the `yield_mint_outbox` table. Repo changes
(`packages/shared/src/yield_mint_outbox_repo.rs`):

- `discover_pending_stellar(chain_id, yield_minter_address, loan_registry_contract_id)`
  — Stellar-shaped INSERT (see Data Flow).
- `OutboxStore::mark_submitted_stellar(key, tx_hash)` — sets `status='submitted'`,
  `tx_hash=$1`, `submitted_at=NOW()`, guarded by `status='pending'`; leaves
  `bitgo_tx_request_id` NULL (nullable). Implemented on `YieldMintOutboxRepo` and the
  test `InMemoryOutbox`.
- Reuse `list_pending`, `list_submitted`, `mark_confirmed`, `mark_failed`,
  `mark_skipped_already_minted` unchanged.

## Config

`StellarRelayerSettings` (`relayer/config.rs`):

- `CHAIN_<id>_RELAYER_STELLAR_YIELD_MINTER_ID` — optional `C…` strkey.
- `CHAIN_<id>_RELAYER_STELLAR_LOAN_REGISTRY_ID` — optional `C…` strkey.
- Reuse `JOB_RELAYER_STELLAR_BATCH_SIZE` (default 50).
- Both set → build `StellarYieldMinter` once before the loop and run the phase each
  cycle. Either unset → log once and skip the phase.

Operational dependency (not code here): relayer signer keypair must hold the minter
role on the access-manager; yield-minter must hold the executor role. Wired in
`pipeline-stellar-contracts`.

## Helpers

- Add `u32_val(n: u32) -> ScVal` to `stellar/tx.rs` (or inline `ScVal::U32`).
- Extract the whitelister's `decode_soroban_data` / `decode_auth_entries` to a shared
  spot in `relayer/stellar/` to avoid drift (both the whitelist and yield-mint paths
  need them).

## Testing

New `packages/worker/tests/stellar_yield_mint.rs`, mirroring `tests/yield_mint_phase_4.rs`.
Pure unit tests — no DB, no network, no `DATABASE_URL`/`POSTGRES_URL` gating.

**Orchestration** (mock `StellarYieldSubmitter` + extended in-memory outbox):
- guard `false` → `skipped_already_minted`, no submit
- guard transient `Err` → stays `pending`
- submit `Ok(hash)` → `submitted` with `tx_hash`
- submit `Err` → stays `pending`
- id > `u32::MAX` → `failed`
- confirm `Some(true)` → `confirmed`; `Some(false)` → `failed`; `None` → stays `submitted`

**Pure helpers** (deterministic, `stellar/tx.rs` style):
- `mint_yield` envelope carries the right contract id, `mint_yield` symbol, `[Address, U32, U32]` args
- `can_yield_be_minted` decodes `ScVal::Bool` (incl. malformed → conservative result)
- `check_tx` maps `SUCCESS`/`FAILED`/pending → `Some(true)`/`Some(false)`/`None`

`cargo clippy --all -- -D warnings` must pass.

## Docs to Update

- `docs/references/backend.md` — Stellar yield-mint phase + new env vars.
- `relayer/stellar/job.rs` module doc (currently says "Phase 4 has no Soroban counterpart").
- Any per-chain relayer-phase enumeration under `docs/product-specs/` / `docs/design-docs/`.
