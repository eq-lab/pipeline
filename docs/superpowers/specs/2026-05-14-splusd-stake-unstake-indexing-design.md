# sPLUSD Stake/Unstake Indexing & API

**Issue:** #177 — Index sPLUSD stake/unstake events and expose in /requests API

## Summary

Extend the event indexer to track ERC-4626 `Deposit` and `Withdraw` events from the StakedPipelineUSD (sPLUSD) vault contract. Restructure the `/v1/requests` API response to present a unified activity feed covering deposits, withdrawals, stakes, and unstakes.

## 1. Database Migration

Add two nullable columns to `contract_logs`:

```sql
ALTER TABLE contract_logs ADD COLUMN assets NUMERIC;
ALTER TABLE contract_logs ADD COLUMN shares NUMERIC;
```

- Both nullable — existing events won't populate them.
- Staking events populate both `assets` and `shares`.
- No index changes needed — `idx_contract_logs_event` on `event_name` covers new event types.

## 2. Indexer

### Event Parsers

New Solidity event declarations for ABI decoding:

```
event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)
event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)
```

Two new parser functions in `packages/worker/src/indexer/parsers.rs`:

- `parse_staking_deposit(log)` — produces `ContractLog` with:
  - `event_name = "StakingDeposit"`
  - `sender = owner` (share recipient, the economic beneficiary)
  - `amount = assets`, `assets = assets`, `shares = shares`

- `parse_staking_withdraw(log)` — produces `ContractLog` with:
  - `event_name = "StakingWithdrawal"`
  - `sender = owner` (share burner), `receiver = receiver` (asset recipient)
  - `amount = assets`, `assets = assets`, `shares = shares`

Rationale for `sender = owner`: the owner is the economic beneficiary. The `caller` may be a router or delegated contract. The `/v1/requests` query filters by `sender`, so this ensures events show up under the correct wallet.

Note: `withdraw()` and `redeem()` both emit the same `Withdraw` event — one parser handles both.

### ContractLog Struct

Add to `packages/shared/src/events.rs`:

```rust
pub assets: Option<U256>,
pub shares: Option<U256>,
```

### EventRepo

Extend `insert_log` in the event repository to include `assets` and `shares` columns in the INSERT statement.

### Config

Add to `IndexerJobSettings` in `packages/worker/src/indexer/config.rs`:

```rust
pub splusd_contracts: Vec<String>,
```

New env var: `JOB_INDEXER_SPLUSD_CONTRACTS` (comma-separated addresses).

### Handler Registration

In `packages/worker/src/indexer/mod.rs`, add a new handler:

```rust
.add_event_handler(splusd_contracts, move |log| {
    parse_staking_deposit(log)
        .or_else(|| parse_staking_withdraw(log))
        .map(|ev| Box::new(ContractLogMapper::new(ev, chain_id, splusd_repo.clone())) as Box<dyn LogMapper>)
})
```

## 3. API — Analytics Module

### Module Extraction

Move the `/v1/requests` handler from `packages/api/src/routes/vouchers.rs` to a new `packages/api/src/routes/analytics.rs` module. Update route registration accordingly. The route path stays `/v1/requests`.

### Query

Extend the query to include staking event types:

```sql
SELECT event_name, request_id, amount, crystal_kyt_status, block_timestamp,
       EXISTS (
           SELECT 1 FROM contract_logs c2
           WHERE c2.event_name = 'RequestClaimed'
             AND c2.request_id = r.request_id
       ) AS is_claimed
FROM contract_logs r
WHERE LOWER(r.sender) = $1
  AND r.event_name IN ('DepositRequested', 'WithdrawalRequested', 'StakingDeposit', 'StakingWithdrawal')
```

### Response Shape

```json
{
  "requests": [
    {
      "type": "Deposit",
      "request_id": "42",
      "created_at": "2026-05-14T12:00:00Z",
      "status": "PendingVerification",
      "amount": "1000000"
    },
    {
      "type": "Stake",
      "created_at": "2026-05-14T12:05:00Z",
      "status": "Completed",
      "amount": "1000000"
    }
  ]
}
```

`request_id` is optional — present for Deposit/Withdraw (needed for voucher claiming), omitted for Stake/Unstake.

### Type Mapping

| `event_name` in DB | `type` in response |
|---|---|
| `DepositRequested` | `Deposit` |
| `WithdrawalRequested` | `Withdraw` |
| `StakingDeposit` | `Stake` |
| `StakingWithdrawal` | `Unstake` |

### Status Mapping

**Deposit / Withdraw:**
- `crystal_kyt_status = NULL` → `PendingVerification`
- `crystal_kyt_status = 1` + not claimed → `PendingClaim`
- `crystal_kyt_status = 1` + claimed → `Completed`
- `crystal_kyt_status = 2` → `VerificationFailed`

**Stake / Unstake:**
- Always `Completed` (instant, no request/claim lifecycle)

### Query Parameters

Unchanged: `wallet` (required), `status` (optional filter).

## 4. Environment Config

Add to `.env`:

```
JOB_INDEXER_SPLUSD_CONTRACTS=0x4C414d0948D8392b1E78e25cb54b4074616Af2B6
```

(hoodi-v2 sPLUSD proxy address)

## Areas Affected

- `packages/worker/src/indexer/parsers.rs` — new event parsers
- `packages/worker/src/indexer/mod.rs` — handler registration
- `packages/worker/src/indexer/config.rs` — sPLUSD contract config
- `packages/shared/src/events.rs` — ContractLog struct extension
- `packages/shared/src/repo/` — EventRepo insert extension
- `packages/api/src/routes/analytics.rs` — new module with `/v1/requests` handler
- `packages/api/src/routes/vouchers.rs` — remove old handler
- `packages/api/src/routes/mod.rs` — route registration update
- SQL migration — add `assets`, `shares` columns
- `.env` — new `JOB_INDEXER_SPLUSD_CONTRACTS` var
