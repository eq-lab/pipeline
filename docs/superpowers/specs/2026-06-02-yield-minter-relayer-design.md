# Yield-Minter Relayer (Phase 4) — Design Spec

**Date:** 2026-06-02
**Status:** Approved, awaiting implementation plan
**Implements:** `PipelineYieldMinter.mintYield` automation
**Branch:** `fix/442-loan-registry-indexer-events` (built on top of Issue #442 work)

## Context

The Pipeline protocol mints yield (sPlUSD distribution to stakers + treasury portion) per loan repayment via `PipelineYieldMinter.mintYield(loanId, repaymentId)`. The function is `restricted` — it queries the OpenZeppelin AccessManager to confirm the caller has the appropriate role before executing.

Today, after a loan repayment is recorded on-chain (`LoanRegistry.recordPayment` emits `PaymentRecorded`), there is no automated path to call `mintYield`. The yield sits unminted until an operator manually submits a transaction.

This spec defines an automated relayer that:
1. Detects every new `PaymentRecorded` event via the existing indexer's `contract_logs` table.
2. Submits a `mintYield(loanId, repaymentId)` transaction through BitGo (the BitGo wallet holds the AccessManager role for this function).
3. Tracks the lifecycle in a new `yield_mint_outbox` table.

The relayer runs as a new **Phase 4** inside the existing `run_relayer_job` loop (`packages/worker/src/relayer/relayer_job.rs`), alongside the existing whitelist-related Phases 0-3.

## Resolved decisions

| Question | Decision |
|---|---|
| AccessManager call model | **Direct call** — BitGo wallet holds the role granted via `AccessManager.setTargetFunctionRole` + `grantRole`. Phase 4 calls `YieldMinter.mintYield` directly; AccessManager gates via the `restricted` modifier. |
| Job placement | **Phase 4 of the existing relayer** (not a new top-level job). Shares the existing cron loop and chain/RPC settings. |
| Discovery | **`contract_logs.PaymentRecorded` vs. `yield_mint_outbox`** — SQL diff to find unminted repayments. |
| Confirmation | **Poll BitGo `/txrequests/<id>`** — no dependency on the indexer observing `YieldMinted`. |
| Failure handling | **Single attempt, hand-off to operator** — no auto-retry on definitive failures. Transient I/O failures (network, BitGo 5xx) do not consume the row's "attempt" and naturally retry next cycle. |
| BitGo client | **Reuse existing `shared::bitgo::client::BitgoClient`** — extend with a `get_tx_request` method for confirmation polling. No new client module. |

## Architecture

Each tick of the relayer cron (every `JOB_RELAYER_INTERVAL_SECS`, default 60s), Phase 4 runs three steps in sequence:

```
PaymentRecorded events                  yield_mint_outbox table
(written by indexer to                  (one row per repayment)
 contract_logs.params)
        │                                    │
        ▼                                    ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 4 cycle (every JOB_RELAYER_INTERVAL_SECS)             │
│                                                              │
│  Step A — Discover                                           │
│    INSERT pending rows for every PaymentRecorded that's      │
│    not yet in the outbox.                                    │
│                                                              │
│  Step B — Submit                                             │
│    For each `pending` row:                                   │
│      1. eth_call canYieldBeMinted(loanId, repaymentId)       │
│         → false ⇒ status='skipped_already_minted'            │
│      2. encode mintYield(loanId, repaymentId) calldata       │
│      3. POST /api/v2/wallet/<id>/txrequests to BitGo         │
│      4. persist bitgo_tx_request_id, status='submitted'      │
│      Any 4xx / definitive failure ⇒ status='failed'          │
│      Any transient failure ⇒ leave 'pending', retry next     │
│                                                              │
│  Step C — Confirm                                            │
│    For each `submitted` row:                                 │
│      GET /api/v2/wallet/<id>/txrequests/<id>                 │
│      → terminal-success with tx_hash ⇒ status='confirmed'    │
│      → 'rejected'/'failed'/'canceled' ⇒ status='failed'      │
│      → still in-flight ⇒ leave alone, retry next cycle       │
└─────────────────────────────────────────────────────────────┘
```

### State machine per outbox row

```
                     ┌──── failed (terminal — operator triage)
                     │
   discover ──→ pending ──submit──→ submitted ──confirm──→ confirmed (terminal — happy path)
                     │
                     └──canYieldBeMinted=false──→ skipped_already_minted (terminal)
```

### Dependencies

- **Postgres**: outbox table + the indexer's `contract_logs` (read-only access to `params` JSONB).
- **eth_rpc** (alloy `HttpProvider`): `canYieldBeMinted(loanId, repaymentId)` view on `LoanRegistry`. Reuses the existing relayer's `JOB_RELAYER_ETH_RPC_URL` configuration.
- **BitGo HTTP** (`BITGO_BASE_URL` + `BITGO_ACCESS_TOKEN` + `BITGO_WALLET_ID`): submission + confirmation polling.

### Concurrency

Single-instance assumption inherited from the existing relayer. No row-level locking, no leases. Each cycle processes all `pending` and all `submitted` rows in sequence.

## Modules and file layout

```
packages/shared/
├── migrations/
│   └── 20260602000001_yield_mint_outbox.sql      ← NEW
└── src/
    ├── bitgo/
    │   ├── client.rs                              ← MODIFIED: add get_tx_request method + trait extraction for mockability
    │   ├── models.rs                              ← MODIFIED: add TxRequestState enum
    │   ├── config.rs                              ← unchanged
    │   └── mod.rs                                 ← unchanged
    └── yield_mint_outbox_repo.rs                  ← NEW

packages/worker/src/relayer/
├── relayer_job.rs                                 ← MODIFIED: invoke Phase 4
├── relayer_settings.rs                            ← MODIFIED: 2-3 new env vars
└── yield_mint/                                    ← NEW submodule
    ├── mod.rs                                     ← phase_yield_mint orchestration
    ├── calldata.rs                                ← alloy sol! + encoder
    └── on_chain.rs                                ← canYieldBeMinted helper
```

### `packages/shared/migrations/20260602000001_yield_mint_outbox.sql`

```sql
CREATE TABLE yield_mint_outbox (
    chain_id              BIGINT        NOT NULL,
    yield_minter_address  TEXT          NOT NULL,
    loan_id               NUMERIC(78,0) NOT NULL,
    repayment_id          NUMERIC(78,0) NOT NULL,
    status                TEXT          NOT NULL,
    bitgo_tx_request_id   TEXT,
    tx_hash               TEXT,
    submitted_at          TIMESTAMPTZ,
    confirmed_at          TIMESTAMPTZ,
    last_error            TEXT,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, yield_minter_address, loan_id, repayment_id)
);

CREATE INDEX yield_mint_outbox_pending_idx
    ON yield_mint_outbox (chain_id, yield_minter_address)
    WHERE status = 'pending';

CREATE INDEX yield_mint_outbox_submitted_idx
    ON yield_mint_outbox (chain_id, yield_minter_address)
    WHERE status = 'submitted';
```

Status values are constrained to: `pending | submitted | confirmed | failed | skipped_already_minted` (enforced in Rust, not via a CHECK constraint — keeps schema flexible if new states are added).

### `packages/shared/src/yield_mint_outbox_repo.rs`

```rust
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct YieldMintOutboxRow {
    pub chain_id: i64,
    pub yield_minter_address: String,
    pub loan_id: BigDecimal,
    pub repayment_id: BigDecimal,
    pub status: String,
    pub bitgo_tx_request_id: Option<String>,
    pub tx_hash: Option<String>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub struct YieldMintOutboxRepo { pool: PgPool }

impl YieldMintOutboxRepo {
    pub fn new(pool: PgPool) -> Self { … }

    /// Step A: insert pending rows for every PaymentRecorded not yet tracked.
    /// Returns the count inserted.
    pub async fn discover_pending(
        &self,
        chain_id: i64,
        yield_minter_address: &str,
    ) -> Result<usize>;

    pub async fn list_pending(
        &self,
        chain_id: i64,
        yield_minter_address: &str,
    ) -> Result<Vec<YieldMintOutboxRow>>;

    pub async fn list_submitted(
        &self,
        chain_id: i64,
        yield_minter_address: &str,
    ) -> Result<Vec<YieldMintOutboxRow>>;

    pub async fn mark_submitted(&self, key: &OutboxKey, bitgo_tx_request_id: &str) -> Result<()>;
    pub async fn mark_confirmed(&self, key: &OutboxKey, tx_hash: &str) -> Result<()>;
    pub async fn mark_failed(&self, key: &OutboxKey, error: &str) -> Result<()>;
    pub async fn mark_skipped_already_minted(&self, key: &OutboxKey) -> Result<()>;
}

pub struct OutboxKey {
    pub chain_id: i64,
    pub yield_minter_address: String,
    pub loan_id: BigDecimal,
    pub repayment_id: BigDecimal,
}
```

### `packages/shared/src/bitgo/client.rs` (modification)

Add one new method to the existing `BitgoClient`:

```rust
impl BitgoClient {
    pub async fn get_tx_request(&self, tx_request_id: &str) -> Result<TxRequestResponse> {
        let url = format!(
            "{}/api/v2/wallet/{}/txrequests/{}",
            self.settings.base_url, self.settings.wallet_id, tx_request_id,
        );
        let response = self.http.get(&url)
            .bearer_auth(&self.settings.access_token)
            .send().await?;
        // … parse and return …
    }
}
```

### `packages/shared/src/bitgo/models.rs` (modification)

Extend `TxRequestResponse` to carry the BitGo state and the on-chain tx hash:

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct TxRequestResponse {
    pub id: String,
    pub state: TxRequestState,
    #[serde(rename = "txHash")]
    pub tx_hash: Option<String>,
    // … existing fields …
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TxRequestState {
    PendingApproval,
    PendingDelivery,
    Signed,
    Delivered,    // terminal-success — `tx_hash` will be populated
    Rejected,
    Canceled,
    Failed,
    #[serde(other)]
    Unknown,      // catch-all for forward-compat
}
```

Exact state name set will be validated against BitGo's docs during implementation; the enum will be extended/adjusted as needed.

### `packages/worker/src/relayer/yield_mint/mod.rs`

```rust
pub async fn phase_yield_mint(
    settings: &RelayerJobSettings,
    bitgo: &BitgoClient,
    outbox: &YieldMintOutboxRepo,
    provider: &HttpProvider,
) -> Result<()> {
    discover(settings, outbox).await?;
    submit_pending(settings, bitgo, outbox, provider).await?;
    confirm_submitted(settings, bitgo, outbox).await?;
    Ok(())
}

async fn discover(…) { /* calls outbox.discover_pending */ }
async fn submit_pending(…) { /* per-row: guard, encode, POST, persist */ }
async fn confirm_submitted(…) { /* per-row: GET, decode state, persist */ }
```

### `packages/worker/src/relayer/yield_mint/calldata.rs`

```rust
use alloy::sol;
use alloy::sol_types::SolCall;
use alloy::primitives::U256;

sol! {
    function mintYield(uint256 loanId, uint256 repaymentId);
}

/// Produce the `"0x"` + hex-encoded 68-byte calldata for `mintYield(loanId, repaymentId)`.
pub fn encode_mint_yield(loan_id: U256, repayment_id: U256) -> String {
    let bytes = mintYieldCall { loanId: loan_id, repaymentId: repayment_id }.abi_encode();
    format!("0x{}", hex::encode(bytes))
}
```

### `packages/worker/src/relayer/yield_mint/on_chain.rs`

```rust
use alloy::sol;
use alloy::primitives::{Address, U256};

sol! {
    function canYieldBeMinted(uint256 loanId, uint256 repaymentId) external view returns (bool);
}

pub async fn can_yield_be_minted(
    provider: &HttpProvider,
    loan_registry: Address,
    loan_id: U256,
    repayment_id: U256,
) -> Result<bool> { /* eth_call + decode */ }
```

Note: this view lives on `LoanRegistry`, not on `YieldMinter`. The relayer needs the loan-registry address (see env vars below).

### New env vars

```
JOB_RELAYER_YIELD_MINTER_ADDRESS=0x...       # optional — presence ENABLES Phase 4
JOB_RELAYER_LOAN_REGISTRY_ADDRESS=0x...      # required when JOB_RELAYER_YIELD_MINTER_ADDRESS is set
BITGO_NATIVE_SYMBOL=hteth                    # optional, default "hteth"; use "eth" for mainnet
```

**Phase 4 enablement**: presence of `JOB_RELAYER_YIELD_MINTER_ADDRESS` is the feature toggle. When unset, Phase 4 is skipped entirely (Phases 0-3 continue normally). When set, `JOB_RELAYER_LOAN_REGISTRY_ADDRESS` becomes required (relayer settings parse fails at startup if missing). This matches the pattern used by `JOB_RELAYER_SUMSUB_ENABLED` for the Sumsub-gated phases.

`JOB_RELAYER_YIELD_MINTER_ADDRESS` doubles as the `yield_minter_address` value stored in every outbox row, supporting future multi-minter setups without schema change.

## Data flow

### Step A — Discovery query

```sql
INSERT INTO yield_mint_outbox
    (chain_id, yield_minter_address, loan_id, repayment_id, status)
SELECT
    cl.chain_id,
    $1 AS yield_minter_address,
    (cl.params->>'loan_id')::numeric AS loan_id,
    (cl.params->'event'->>'repayment_id')::numeric AS repayment_id,
    'pending'
FROM contract_logs cl
WHERE cl.event_name = 'PaymentRecorded'
  AND cl.chain_id = $2
  AND NOT EXISTS (
      SELECT 1 FROM yield_mint_outbox o
      WHERE o.chain_id = cl.chain_id
        AND o.yield_minter_address = $1
        AND o.loan_id = (cl.params->>'loan_id')::numeric
        AND o.repayment_id = (cl.params->'event'->>'repayment_id')::numeric
  )
ON CONFLICT DO NOTHING;
```

The JSONB paths match what `parse_payment_recorded` writes (`loan_id` at top level, `repayment_id` under the `event` key) per the Issue #442 Pass 4 enrichment.

### Step B — Per `pending` row

1. Build `OutboxKey { chain_id, yield_minter_address, loan_id, repayment_id }`.
2. `can_yield_be_minted(provider, loan_registry_address, loan_id, repayment_id)`.
   - `false` ⇒ `outbox.mark_skipped_already_minted(&key)` and continue.
3. `encode_mint_yield(loan_id, repayment_id)` ⇒ hex-encoded calldata string.
4. `bitgo.send_transaction(to=yield_minter_address, value="0", symbol=bitgo_native_symbol, data=Some(&hex_calldata))`.
   - Network error / BitGo 5xx ⇒ `tracing::warn!`, leave row `pending`, continue to next row.
   - BitGo 4xx with body ⇒ `outbox.mark_failed(&key, body)`, continue.
   - Success ⇒ extract `txRequestId` from response, `outbox.mark_submitted(&key, &tx_request_id)`.

### Step C — Per `submitted` row

1. `bitgo.get_tx_request(&row.bitgo_tx_request_id)`.
   - Network error / BitGo 5xx ⇒ `tracing::warn!`, leave row `submitted`, continue.
2. Match on `response.state`:
   - `Delivered` (or whichever terminal-success state BitGo emits) with `response.tx_hash` populated ⇒ `outbox.mark_confirmed(&key, &tx_hash)`.
   - `Rejected | Canceled | Failed` ⇒ `outbox.mark_failed(&key, state.as_str())`.
   - In-flight states (`PendingApproval | PendingDelivery | Signed`) ⇒ leave row alone; retry next cycle.

### Idempotency / crash risk

Single observable crash window: after `bitgo.send_transaction` returns successfully, before `mark_submitted` lands. If the worker crashes in this gap, BitGo has accepted the request but the DB still shows `pending`. The next cycle re-submits.

**v1 accepts this risk.** Mitigation rationale:
- The duplicate BitGo request is visible (operator can see two `txrequests` for the same payload).
- The second on-chain tx will revert (`canYieldBeMinted` returns `false` after the first mints), so no double-mint occurs.
- The single-attempt failure policy means the second outbox attempt would land as `failed` after the revert, surfacing to the operator.

**v2 follow-up** (out of scope here): add deterministic idempotency keys passed to BitGo so they deduplicate at their end.

## Error handling

| Failure source | Detection | Outbox transition | last_error column |
|---|---|---|---|
| `canYieldBeMinted` returns `false` | view returns false | `pending` → `skipped_already_minted` | _(none)_ |
| Calldata encoding error | `Result::Err` (unlikely with alloy) | `pending` → `failed` | `"calldata encoding: <err>"` |
| `canYieldBeMinted` RPC transient error | alloy `Err` | row stays `pending`; **log + skip cycle** | _(none — transient)_ |
| BitGo `send_transaction` 5xx / network | reqwest `Err` | row stays `pending`; **log + skip cycle** | _(none — transient)_ |
| BitGo `send_transaction` 4xx | HTTP 4xx | `pending` → `failed` | `"bitgo submit 4xx: <body>"` |
| BitGo `get_tx_request` reports rejected/canceled/failed | response state | `submitted` → `failed` | `"bitgo state: <state>"` |
| BitGo `get_tx_request` 5xx / network | reqwest `Err` | row stays `submitted`; **log + skip cycle** | _(none — transient)_ |
| DB error during update | sqlx `Err` | Phase 4 aborts this cycle | _(not persisted — DB is unreachable)_ |

### Transient vs. definitive failures

Transient failures (network, 5xx) do NOT consume the row's "single attempt" — they don't transition the row state, and the next cycle retries naturally. This lets the system self-heal from BitGo outages without operator intervention. The trade-off is that a BitGo bug returning 5xx forever would retry indefinitely; operator monitors logs (`tracing::warn!`) for that case.

Definitive failures (4xx, terminal BitGo states, encoding errors) land in `failed` and stop. Operator handles via direct SQL (no CLI tooling in v1):

```sql
-- Retry a failed row once:
UPDATE yield_mint_outbox
   SET status = 'pending', last_error = NULL
 WHERE chain_id = $1 AND loan_id = $2 AND repayment_id = $3;
```

### Phase isolation

A Phase 4 failure on one row does not abort Phases 0-3 or kill the worker process. A DB error that prevents reading the outbox aborts Phase 4 for the cycle and is logged; the cron loop continues.

### Logging convention

```rust
tracing::info!(loan_id, repayment_id, "yield_mint: pending → submitted");
tracing::warn!(loan_id, repayment_id, error = %e, "yield_mint: transient failure, retrying");
tracing::error!(loan_id, repayment_id, error = %e, "yield_mint: marked failed (operator action required)");
```

Severity matches existing relayer phases.

## Testing

### Unit tests (pure, no I/O)

**`packages/worker/src/relayer/yield_mint/calldata.rs`**
- `encode_mint_yield_produces_expected_selector` — first 4 bytes match `keccak256("mintYield(uint256,uint256)")[..4]`.
- `encode_mint_yield_packs_args_correctly` — known input → known 68-byte hex literal.
- `encode_mint_yield_handles_max_uint256` — boundary value, no panic.

**`packages/shared/src/bitgo/models.rs`**
- `tx_request_state_decodes_all_variants` — every documented BitGo state string round-trips; unknown strings fall through to `TxRequestState::Unknown`.

### Integration tests (sqlx-gated, mock BitGo + mock provider)

New file: `packages/worker/tests/yield_mint_phase_4.rs`

Mocks:
- `MockBitgoClient` — requires introducing a trait around the existing `BitgoClient` methods (small refactor in `shared::bitgo`).
- `MockProvider` for `canYieldBeMinted` — same pattern as existing indexer mocks in `loan_metadata.rs`.

Test cases:
| Test | Asserts |
|---|---|
| `discover_inserts_new_pending_rows` | Seeds `contract_logs` with 3 `PaymentRecorded` rows + 1 unrelated event; runs Step A; asserts 3 outbox rows with parsed loan_id/repayment_id. |
| `discover_is_idempotent` | Run twice → no duplicates. |
| `submit_happy_path_transitions_pending_to_submitted` | Mocks `canYieldBeMinted → true` and `send_transaction → { id: 'abc' }`; asserts row is `submitted` with `bitgo_tx_request_id='abc'` + `submitted_at`. |
| `submit_skips_when_canYieldBeMinted_false` | Mocks view → false; asserts row → `skipped_already_minted`, no BitGo call. |
| `submit_transient_bitgo_5xx_leaves_row_pending` | Mocks 5xx; asserts row stays `pending`, log warns. |
| `submit_bitgo_4xx_marks_failed` | Mocks 4xx with body; asserts row → `failed`, `last_error` contains the body. |
| `confirm_terminal_delivered_marks_confirmed` | Mocks `state: Delivered, tx_hash: '0xabc'`; asserts row → `confirmed`. |
| `confirm_pending_leaves_row_alone` | Mocks `state: PendingApproval`; asserts row stays `submitted`. |
| `confirm_rejected_marks_failed` | Mocks `state: Rejected`; asserts row → `failed`. |
| `submit_then_confirm_chained_in_memory` | Chains Steps B and C against the same in-memory outbox; asserts both rows transition pending → submitted → confirmed. |
| `phase_yield_mint_failure_in_one_row_does_not_block_others` | Two pending rows; mock fails row 1; asserts row 1 → `failed`, row 2 → `submitted`. |

### Manual end-to-end (documented, not automated)

1. Deploy `YieldMinter` on Hoodi; configure AccessManager to grant the BitGo wallet the `mintYield` role.
2. Set: `JOB_RELAYER_ENABLED=true`, `JOB_RELAYER_YIELD_MINTER_ADDRESS`, `JOB_RELAYER_LOAN_REGISTRY_ADDRESS`, `BITGO_NATIVE_SYMBOL=hteth`.
3. Trigger an on-chain `recordPayment` (or rely on a pre-existing `PaymentRecorded` row in `contract_logs`).
4. Wait one relayer cycle (≤ 60s by default). Verify:
   - `SELECT * FROM yield_mint_outbox WHERE status NOT IN ('confirmed', 'skipped_already_minted')` is empty.
   - On-chain `YieldMinted` event present at the recorded `tx_hash`.
   - `canYieldBeMinted(loanId, repaymentId)` now returns `false`.
   - Treasury and stakedPlUSD balances increased by the expected amounts.

### Expected test count delta

Roughly **+11 integration tests + ~4 unit tests** = ~95 tests total (currently 88).

## Out of scope

- Automatic retry budget / exponential backoff (operator triages `failed` rows manually).
- Row-level locking (single-instance worker assumption).
- Idempotency keys to BitGo (v2 follow-up if the crash-window risk materialises).
- CLI tooling for outbox triage (direct SQL is the v1 path).
- Watching `YieldMinted` indexed events for cross-validation (confirmation is BitGo-driven).
- Multi-instance Phase 4 deployment.
- Reorg recovery (consistent with existing relayer; deep reorgs would leave stale `confirmed` rows).
- Skipping zero-yield repayments to save gas (the contract permits zero-mints; relayer treats them uniformly).

## Operator validation

Beyond the manual E2E above, the spec assumes the operator has:
1. Granted the BitGo wallet's address the appropriate role on the deployed `AccessManager`.
2. Set the role for the `mintYield(uint256,uint256)` selector on the `YieldMinter` target via `setTargetFunctionRole`.
3. Confirmed the BitGo wallet has enough native gas (e.g., hteth on Hoodi) for the mintYield txs.

These are operational concerns, validated out-of-band — Phase 4 surfaces a clear `failed` row with the BitGo error body when any of them is misconfigured.

## Implementation order suggestion

For the writing-plans skill that follows:

1. Migration + `YieldMintOutboxRepo` + repo tests (no relayer wiring yet — independently testable).
2. Extend `BitgoClient` with `get_tx_request` + extend `models.rs` with `TxRequestState`.
3. `yield_mint/calldata.rs` + unit tests for the encoder.
4. `yield_mint/on_chain.rs` + (eth_call mock-backed) unit test for the view caller.
5. `yield_mint/mod.rs` orchestration + `phase_yield_mint` integration tests with mocked BitGo + mocked provider.
6. Wire Phase 4 into `relayer_job.rs` behind a feature toggle (presence of `JOB_RELAYER_YIELD_MINTER_ADDRESS`).
7. Settings + `.env.example` update.
8. Docs touch-up (relayer README if any, mention Phase 4).

Each step lands as a small, reviewable change. The final wiring step turns the feature on.
