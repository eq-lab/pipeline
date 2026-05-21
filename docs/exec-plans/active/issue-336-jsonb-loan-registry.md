# Issue #336: LoanRegistry: index events to contract_logs (+ JSONB params refactor)

Source: https://github.com/eq-lab/pipeline/issues/336

## Scope

**In scope:**

1. Replace all sparse nullable event-data columns on `contract_logs` with a single `params JSONB NOT NULL DEFAULT '{}'` column.
2. Update the `ContractLog` Rust struct, `insert_log`, all existing parsers, the position-tracking mapper, and all SQL read queries across the codebase to use the new JSONB shape.
3. Add 7 new `parse_loan_*` parser functions for `PipelineLoanRegistry` events.
4. Add `loan_registry_contracts` config field (optional) and register a new event handler block.
5. Update all tests.

**Out of scope:** disbursement preparation, CCR monitoring, loan mirror table, API endpoints for loan data.

## Assumptions and Risks

- **Data migration**: Dropping columns and adding `params` means existing rows lose their typed columns. The migration must backfill `params` from the old columns before dropping them, or we accept data loss for existing rows. Given production data exists, backfill is required.
- **Query performance**: Queries that previously used typed columns (e.g., `WHERE request_id::text = $1`, `WHERE LOWER(sender) = $2`, `WHERE shares_balance IS NOT NULL`) must be rewritten to use JSONB operators (`params->>'sender'`, `(params->>'shares_balance')::numeric`). JSONB field access is slower than direct column access; partial indexes may need adjustment.
- **Crystal screening columns** (`crystal_kyt_status`, `crystal_tx_risk`, `crystal_tx_signals`, `crystal_sender_risk`, `crystal_sender_signals`, `crystal_screened_at`) remain as direct columns -- they are NOT event-data and are populated by background jobs.
- **No LoanRegistryUpgradeable.sol exists in this repo.** Event signatures are taken from the issue body. The sol! macro declarations will be written from those signatures.
- The `env_csv_require` helper does not support optional fields. A new `env_csv_optional` helper (returning `Vec<String>`, empty if unset) is needed for `loan_registry_contracts`.

## Decisions

1. **Migration strategy**: Wipe `contract_logs` (TRUNCATE) and drop/re-add columns. No backfill. Re-indexing from start block will be done manually by the operator after deploy.
2. **JSONB indexing**: Add a GIN index on the whole `params` column: `CREATE INDEX idx_contract_logs_params ON contract_logs USING GIN (params)`.
3. **Enum storage**: Store `LoanStatus` and `ClosureReason` values as string names (e.g., `"Performing"`, `"Default"`, `"ScheduledMaturity"`).

## Implementation Steps

### Step 1: Migration file

Create `packages/shared/migrations/20260521000001_contract_logs_jsonb.sql`:

1. TRUNCATE `contract_logs` and `log_collector_state` (wipe all indexed data; operator re-indexes from start block after deploy).
2. Drop columns: `sender`, `receiver`, `amount`, `request_id`, `cumulative`, `assets`, `shares`, `shares_balance`, `avg_buy_share_price`, `realized_pnl`.
3. Add `params JSONB NOT NULL DEFAULT '{}'` column.
4. Drop old column-based indexes that reference dropped columns (e.g. `idx_contract_logs_kyt_unverified` if it references `sender`).
5. Add GIN index on the whole `params` column: `CREATE INDEX idx_contract_logs_params ON contract_logs USING GIN (params)`.

### Step 2: Update `ContractLog` struct

File: `packages/shared/src/events.rs`

Replace all `Option` data fields with:
```rust
pub params: serde_json::Value,  // replaces sender, receiver, amount, request_id, cumulative, assets, shares, shares_balance, avg_buy_share_price, realized_pnl
```

Add `serde_json` dependency to `packages/shared/Cargo.toml` if not already present.

### Step 3: Update `insert_log`

File: `packages/shared/src/db.rs`

Change the INSERT statement to use only `params` as a JSONB column (bind as `sqlx::types::Json(&event.params)` or directly as `serde_json::Value`). Remove all individual column bindings for the dropped columns.

### Step 4: Update existing parsers

File: `packages/worker/src/indexer/parsers.rs`

Update all 5 existing parser functions (`parse_deposit_requested`, `parse_withdrawal_requested`, `parse_request_claimed`, `parse_staking_deposit`, `parse_staking_withdraw`) to populate `params` as a `serde_json::json!({...})` object with the keys specified in the issue table.

### Step 5: Add 7 loan registry parsers

File: `packages/worker/src/indexer/parsers.rs`

1. Add `sol!` declarations for all 7 `PipelineLoanRegistry` events (with enum types for `LoanStatus` and `ClosureReason`).
2. Add 7 `parse_loan_*` functions following the existing parser pattern, populating `params` per the issue table:
   - `parse_loan_minted`
   - `parse_loan_status_updated`
   - `parse_loan_ccr_updated`
   - `parse_loan_location_updated`
   - `parse_loan_defaulted`
   - `parse_loan_closed`
   - `parse_loan_repayment`

### Step 6: Update position tracking mapper

File: `packages/worker/src/indexer/mappers.rs`

1. Update `clone_contract_log` to clone the new struct shape (just `params`).
2. Update `compute_position_fields`:
   - Read `assets` and `shares` from `event.params["assets"]` and `event.params["shares"]` (parsing from string to BigDecimal).
   - Read `sender` (owner) from `event.params["sender"]`.
   - Change the SQL query in `compute_position_fields` to read from `params->>'shares_balance'` and `params->>'avg_buy_share_price'` instead of direct columns.
   - Write computed `shares_balance`, `avg_buy_share_price`, `realized_pnl` back into `event.params` as string values.

### Step 7: Update read queries in `kyc_repo.rs`

File: `packages/shared/src/kyc_repo.rs`

1. `UnverifiedTransfer` struct: change fields to match JSONB extraction (or extract from `params` in the SQL query using aliases to keep the struct unchanged).
2. `RequestInfo`: update SQL in `get_deposit_request` and `get_withdrawal_request` to use `params->>'request_id'`, `params->>'sender'`, `(params->>'amount')::numeric`.
3. `RequestEventRow`: update SQL in `get_all_requests` to use JSONB extraction for `request_id`, `amount`, `assets`, `shares`, `sender`.
4. `is_request_claimed`: update SQL to use `params->>'request_id'`.
5. Crystal screening queries that reference `LOWER(sender)`: update to `LOWER(params->>'sender')`.

### Step 8: Update read queries in `position_repo.rs`

File: `packages/shared/src/position_repo.rs`

1. `get_first_stake_timestamp`: change `LOWER(sender)` to `LOWER(params->>'sender')`.
2. `get_position_summaries`: rewrite to use `(params->>'shares_balance')::numeric`, `(params->>'avg_buy_share_price')::numeric`, `(params->>'realized_pnl')::numeric`, and `LOWER(params->>'sender')`.

### Step 9: Add config for loan registry contracts

File: `packages/worker/src/indexer/config.rs`

1. Add `fn env_csv_optional(key: &str) -> Vec<String>` that returns empty vec if env var is unset.
2. Add `loan_registry_contracts: Vec<String>` to `IndexerJobSettings`, reading from `JOB_INDEXER_LOAN_REGISTRY_CONTRACTS`.

### Step 10: Register loan registry event handler

File: `packages/worker/src/indexer/mod.rs`

1. Import all 7 `parse_loan_*` functions.
2. Parse `loan_registry_contracts` addresses.
3. If non-empty, add a new `.add_event_handler(...)` block chaining all 7 parsers with `.or_else(...)`, creating `ContractLogMapper` without position tracking.

### Step 11: Update tests

1. **`packages/worker/tests/parsers.rs`**: Update assertions to check `params` JSON object instead of individual fields. Add tests for at least 2-3 loan registry parsers.
2. **`packages/worker/tests/mappers.rs`**: Update `dummy_event()` to use new struct shape with `params`.
3. **`packages/worker/tests/indexer_integration.rs`**: Update `make_deposit_requested`, `make_withdrawal_requested` helpers and assertions. Update SQL in `count_logs` if needed.

## Test Strategy

1. **Unit tests (parsers)**: Each of the 12 parser functions (5 existing + 7 new) must have at least one test verifying correct decoding into the `params` JSON shape. Existing tests in `packages/worker/tests/parsers.rs` must be updated and new tests added for loan parsers.
2. **Unit tests (mappers)**: Update existing tests to work with the new `ContractLog` struct. Verify `compute_position_fields` correctly reads/writes JSONB params.
3. **Integration tests**: Update `packages/worker/tests/indexer_integration.rs` to work with JSONB. Verify insert + dedup + cursor still work.
4. **Migration test**: Run `sqlx migrate run` against a test database with existing data to verify the backfill + drop sequence works without errors.
5. **Clippy**: Run `cargo clippy --all -- -D warnings` after all changes.
6. **Manual verification**: Query `contract_logs` after re-indexing to verify `params` contains expected keys for each event type.

## Docs to Update

- No product spec changes needed (this is a backend structural refactor + new indexer capability).
- No user-facing behavior changes.
