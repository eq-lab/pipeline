# Issue #442 — Update loan registry indexer to match current LoanRegistryUpgradeable events

> **Status: IMPLEMENTATION COMPLETE** — 2026-05-28. Updated 2026-06-01 (Pass 6). Event-sourced `loan_history` design implemented. All mappers rewritten. Tests green. Pass 6 added TRUNCATE to migration + extracted pure composer functions + added 10 new unit tests for composer paths. Awaiting manager PR/commit phase.

Source: https://github.com/eq-lab/pipeline/issues/442
PR: https://github.com/eq-lab/pipeline/pull/443
Branch: `fix/442-loan-registry-indexer-events`

## Data-model change (supersedes earlier `loan_details` design)

Previous design: one row per loan in `loan_details`, UPSERTed at draw, mutated by 6 lifecycle handlers.

**New design (event-sourced):** one row per loan **per loan-related event** in a new `loan_history` table. The row captures the canonical on-chain state of the loan at `event.block_number`. The table is **append-only** — no UPDATEs after insert.

Field-source split for each `loan_history` row:

- **IPFS-sourced fields** (`originator, borrower_id, commodity, corridor, governing_law, metadata_uri`): set at `LoanDrawn`; **carry-forward** from the most recent prior row on every subsequent event. No re-fetch.
- **Immutable on-chain fields** (`original_senior_tranche, original_equity_tranche, original_offtaker_price, senior_interest_rate_bps, origination_date, original_maturity_date, facility`): set at `LoanDrawn`; **carry-forward** from the most recent prior row on every subsequent event. The on-chain struct is immutable by construction (`_drawLoan` writes once; no setter), so carry-forward is equivalent to a fresh read.
- **Mutable on-chain fields** (`status, closure_reason, current_maturity_date, ccr_bps, location, repayment_*` × 7): read fresh on **every** event via **block-pinned** `mutableLoanData(loanId)` at `event.block_number`. This guarantees the row reflects the canonical state at that block even if the indexer is processing old blocks.
- **Event identity columns**: `event_name`, `block_number`, `log_index`, `block_timestamp`.

Primary key: `(chain_id, loan_id, block_number, log_index)` — the natural uniqueness from on-chain event ordering.

## Migration shape

A single new migration replaces the in-progress `20260528000001_loan_details_onchain_columns.sql`:

```sql
-- Issue #442: replace loan_details (mutable current-state) with loan_history (event-sourced append-only).
DROP TABLE IF EXISTS loan_details CASCADE;

CREATE TABLE loan_history (
  chain_id        BIGINT        NOT NULL,
  loan_id         NUMERIC(78,0) NOT NULL,
  block_number    BIGINT        NOT NULL,
  log_index       BIGINT        NOT NULL,
  event_name      TEXT          NOT NULL,
  block_timestamp BIGINT        NOT NULL,

  -- IPFS-sourced (carry-forward from previous row)
  originator      TEXT NOT NULL,
  borrower_id     TEXT NOT NULL,
  commodity       TEXT NOT NULL,
  corridor        TEXT NOT NULL,
  governing_law   TEXT NOT NULL,
  metadata_uri    TEXT,

  -- Immutable on-chain (carry-forward from previous row)
  original_senior_tranche  NUMERIC(78,0) NOT NULL,
  original_equity_tranche  NUMERIC(78,0) NOT NULL,
  original_offtaker_price  NUMERIC(78,0) NOT NULL,
  senior_interest_rate_bps INTEGER       NOT NULL,
  origination_date         BIGINT        NOT NULL,
  original_maturity_date   BIGINT        NOT NULL,
  facility                 TEXT,

  -- Mutable on-chain (block-pinned read at event.block_number)
  status                            TEXT          NOT NULL,
  closure_reason                    TEXT          NOT NULL,
  current_maturity_date             BIGINT        NOT NULL,
  ccr_bps                           INTEGER       NOT NULL,
  location                          TEXT          NOT NULL,
  repayment_offtaker_amount         NUMERIC(78,0) NOT NULL,
  repayment_equity_distributed      NUMERIC(78,0) NOT NULL,
  repayment_senior_principal_repaid NUMERIC(78,0) NOT NULL,
  repayment_senior_interest         NUMERIC(78,0) NOT NULL,
  repayment_mgmt_fee                NUMERIC(78,0) NOT NULL,
  repayment_perf_fee                NUMERIC(78,0) NOT NULL,
  repayment_oet_alloc               NUMERIC(78,0) NOT NULL,

  PRIMARY KEY (chain_id, loan_id, block_number, log_index)
);

CREATE INDEX loan_history_latest_idx
  ON loan_history (chain_id, loan_id, block_number DESC, log_index DESC);

-- One-off rename for historical contract_logs rows (preserved from earlier draft).
UPDATE contract_logs SET event_name = 'LoanDrawn' WHERE event_name = 'LoanMinted';
```

Notes:
- `loan_details` is dropped outright. Production has no live data; dev DBs are seeded by re-running the indexer from `start_block`.
- All columns NOT NULL except `metadata_uri` (legitimately optional) and `facility` (Solidity field may be empty string — but stored as `''` not NULL; revisit if a real null semantic shows up).
- The index supports the "current state" query pattern: `SELECT DISTINCT ON (chain_id, loan_id) * FROM loan_history WHERE chain_id = $1 AND loan_id = ANY($2) ORDER BY chain_id, loan_id, block_number DESC, log_index DESC`.

## Rust-side shape

- Rename `loan_details_repo.rs` → `loan_history_repo.rs`. `LoanDetailsRow` → `LoanHistoryRow` (adds `block_number`, `log_index`, `event_name`, `block_timestamp`; mutable + immutable columns are all NOT NULL).
- Replace `upsert_loan_details` with `insert_loan_history` — plain INSERT, no ON CONFLICT.
- Delete the 6 narrow mutators (`update_status`, `update_closure`, `update_ccr_bps`, `update_location`, `update_default`, `update_repayment_snapshot`). They are no longer needed — lifecycle handlers do **insert**, not update.
- Add a new helper `get_latest_loan_history(conn, chain_id, loan_id) -> Result<Option<LoanHistoryRow>>` for carry-forward of IPFS + immutable fields.
- `LoanRegistryReader::mutable_loan_data` gains a `block: BlockId` parameter so callers can pin to `event.block_number`. The `immutable_loan_data` reader stays at `latest` (immutable struct, equal at every block; only called on `LoanDrawn`).
- `MutableDataResolver` trait method signature extends with `block: BlockId`.

## Per-mapper flow

- **`LoanDrawnMapper`**:
  1. eth_call `metadata_uri(loan_id)` (block: latest is fine — URI is set at draw and immutable).
  2. eth_call `immutable_loan_data(loan_id)` (block: latest).
  3. eth_call `mutable_loan_data(loan_id, block=event.block_number)`.
  4. Fetch IPFS JSON.
  5. Build `LoanHistoryRow` from all four sources.
  6. `insert_loan_history`.
- **All 6 lifecycle mappers** (`LoanStatusUpdatedMapper`, `LoanCcrUpdatedMapper`, `LoanLocationUpdatedMapper`, `LoanDefaultedMapper`, `LoanClosedMapper`, `LoanRepaymentMapper`):
  1. `get_latest_loan_history(conn, chain_id, loan_id)` → previous row (must exist; if missing, that's an indexer bug — the `LoanDrawn` was missed).
  2. eth_call `mutable_loan_data(loan_id, block=event.block_number)`.
  3. Build new `LoanHistoryRow`: carry-forward IPFS + immutable fields from the previous row; fresh mutable fields from the eth_call; event identity columns from the log itself.
  4. `insert_loan_history`.

All mappers retain the all-or-nothing transactional model: any RPC / DB / parse failure rolls back the indexer's outer transaction.

## Downstream consumers

`packages/api/src/routes/portfolio.rs` and `packages/shared/src/contract_logs_repo.rs` currently derive loan lifecycle state from `contract_logs` event rows. They do **not** read `loan_details` for status/closure today. Out of scope to switch them now — they continue working off `contract_logs`. Any code that did read `loan_details` (the existing `LoanDetailsRepo::get_loan_details`, `list_loans_for_window`) must be updated to read `loan_history` with a "latest row per loan" filter, or removed if dead.

## Verification

Same gates: `cargo clippy --all -- -D warnings`, `npx tsx scripts/lint-docs.ts`, full `cargo test --all`. Test additions:
- `loan_drawn_mapper_inserts_first_history_row` — asserts a row with all 24 data columns + 4 identity columns is written.
- `loan_status_updated_mapper_carries_forward_immutable_and_ipfs` — pre-seed one `LoanDrawn` row, then run the status-updated mapper; assert the new row shares IPFS + immutable columns with the prior row and has fresh mutable columns from the mocked block-pinned read.
- `loan_repayment_mapper_appends_with_block_pinned_snapshot` — two consecutive `Repayment` events; assert two new rows, each with the cumulative repayment values from the mocked block-pinned read.
- Carry-forward regression: assert that if `LoanLocationUpdated` runs without a prior `LoanDrawn` in `loan_history`, the mapper errors and rolls back (indexer-bug guard).

## Context

The Rust worker indexer in `packages/worker/src/indexer/` was written against an older
revision of `LoanRegistryUpgradeable.sol`. Two event signatures (`LoanMinted` and
`Repayment`) no longer match the deployed contract in
`../pipeline-contracts/src/loanRegistry/LoanRegistryUpgradeable.sol`, so their topic0
hashes diverge and the indexer currently decodes **zero** real on-chain events for them.

A second, larger scope shift came in the Issue's clarifying comment: the data model
splits across **three** sources from now on.

- **On-chain `immutableLoanData(loanId)` view** is authoritative for tranche sizes,
  prices, rate, dates, and the new `facility` field.
- **On-chain `mutableLoanData(loanId)` view** is authoritative for current `status`,
  `closureReason`, `currentMaturityDate`, `ccrBps`, `location`, and the cumulative
  `repaymentData` struct.
- **Off-chain IPFS JSON via `tokenURI(loanId)`** carries only six fields:
  `originator, borrowerId, commodity, corridor, governingLaw, metadataURI`.

The `loan_details` table must materialise the union of all three so the Portfolio API
can answer "what's the current state of loan X" from one row, while `contract_logs`
remains the immutable audit trail.

## Decisions (resolved Open Questions)

| Question | Decision |
|---|---|
| New `facility` DB column name | `facility` (verbatim from Solidity) |
| `contract_logs.event_name` for the drawn event | **Rename to `LoanDrawn`** — touches all downstream consumers |
| `loan_details.original_facility_size` | **Drop the column** (DROP COLUMN migration) |
| `Repayment` storage strategy | **Plan A** — snapshot via `eth_call mutableLoanData(loanId)` |
| Portfolio API switch to `loan_details.status` | Out of scope (keep deriving from `contract_logs` for now) |

## Scope

**In scope:**

1. Resync `parsers.rs` event bindings: `LoanMinted` → `LoanDrawn`; `Repayment` → struct
   form with 7 fields.
2. Extend `LoanRegistryReader` with `immutableLoanData(uint256)` and
   `mutableLoanData(uint256)` view bindings. Define new resolver traits so mappers can
   be mocked without an RPC.
3. Shrink the IPFS JSON DTO to 6 fields. Rename it to disambiguate from the
   on-chain `ImmutableLoanData` struct.
4. Schema migration: ADD the 13 new columns (`facility`, `status`, `closure_reason`,
   `current_maturity_date`, `ccr_bps`, `location`, plus 7 repayment columns), DROP
   `original_facility_size`, and UPDATE existing `contract_logs.event_name = 'LoanMinted'`
   rows to `'LoanDrawn'` (data backfill for the rename).
5. Rename `LoanMintedMapper` → `LoanDrawnMapper`. Update its `populate_details` to do
   three reads (URI, immutable, mutable) and the IPFS fetch before the row is written.
6. Replace each lifecycle event's plain `ContractLogMapper` with a repo-aware mapper
   that updates `loan_details` in the same DB transaction as the `contract_logs` insert.
7. Sweep downstream consumers of `event_name = 'LoanMinted'` and update to `'LoanDrawn'`
   (`packages/shared/src/contract_logs_repo.rs`, `packages/api/src/routes/portfolio.rs`,
   any tests).
8. Update parser unit tests and add mapper integration tests.
9. Refresh `docs/product-specs/loans-data.md` to match reality.

**Out of scope:**

- Portfolio API rewrite to read from `loan_details.status` (deferred).
- Backfill of pre-existing `loan_details` rows (operator runbook: re-run indexer from
  `start_block`; `upsert_loan_details` is idempotent).
- Async/queue backfill (TD-8 still applies).
- Frontend changes.

## Assumptions and Risks

- The sibling worktree at `../pipeline-contracts/src/loanRegistry/LoanRegistryUpgradeable.sol`
  matches the deployed contract. Re-verify before merging if production is feature-flagged
  or on a staged release.
- After the rename, historical `contract_logs.event_name = 'LoanMinted'` rows are
  rewritten to `'LoanDrawn'` in the same migration that adds the new columns. No
  downstream code keeps the old name.
- The indexer transaction now includes up to **three extra `eth_call`s** per `LoanDrawn`
  and one `eth_call` per `LocationUpdated` / `Repayment` event. RPC outages now stall the
  indexer at a finer-grained level. TD-8 (async backfill) becomes more attractive but
  remains deferred.
- `Repayment` event payload is a delta on-chain; storage is cumulative. Plan A reads
  cumulative state via `mutableLoanData(loanId).repaymentData` on every `Repayment` event.
- `LocationUpdated.newLocation` is `string indexed` → topic is keccak hash. The
  `contract_logs.params["location"]` field keeps the hash (audit trail); the canonical
  string read via `mutableLoanData(loanId).location` goes into `loan_details.location`.

## Implementation Steps

### 1. `packages/worker/src/indexer/parsers.rs`

- In `mod loan_registry`, replace the `LoanMinted` declaration with
  `event LoanDrawn(uint256 indexed loanId, address indexed holder, string indexed metadataURI);`.
- Replace the `Repayment` declaration with the struct form:
  ```solidity
  struct RepaymentData {
      uint256 offtakerAmount;
      uint256 equityDistributed;
      uint256 seniorPrincipalRepaid;
      uint256 seniorInterest;
      uint256 mgmtFee;
      uint256 perfFee;
      uint256 oetAlloc;
  }
  event Repayment(uint256 indexed tokenId, RepaymentData repaymentData);
  ```
- Rename `parse_loan_minted` → `parse_loan_drawn`. Set `event_name = "LoanDrawn"`. Drop
  `initial_maturity` and `location` from `params`.
- Update `parse_loan_repayment` to decode the struct payload. Emit all 7 fields under
  snake_case keys (`offtaker_amount`, `equity_distributed`, `senior_principal_repaid`,
  `senior_interest`, `mgmt_fee`, `perf_fee`, `oet_alloc`).
- The 5 unchanged lifecycle parsers stay as-is.

### 2. `packages/worker/src/indexer/loan_registry_reader.rs`

- Expand the `sol!` block to declare the full `ILoanRegistry` interface (rename from
  `ILoanRegistryTokenURI`) including the two enums (`LoanStatus`, `ClosureReason`), the
  two structs (`ImmutableLoanData`, `MutableLoanData`), the shared `RepaymentData`, and
  the two new view functions `immutableLoanData(uint256)` and `mutableLoanData(uint256)`.
- Add two methods on `LoanRegistryReader`:
  - `async fn immutable_loan_data(&self, contract: Address, loan_id: U256) -> Result<ImmutableLoanData>`
  - `async fn mutable_loan_data(&self, contract: Address, loan_id: U256) -> Result<MutableLoanData>`
  Each builds a `TransactionRequest`, calls `provider.call(...)`, decodes via
  `abi_decode_returns`. Mirror the existing `metadata_uri` shape.

### 3. `packages/worker/src/indexer/loan_metadata.rs`

- Rename the existing `ImmutableLoanData` DTO to `LoanMetadataJson` (avoids shadowing
  the Solidity struct now exposed by `loan_registry_reader`).
- Shrink to 6 fields (`#[serde(deny_unknown_fields)]` retained):
  `originator: String`, `borrower_id: String`, `commodity: String`, `corridor: String`,
  `governing_law: String`, `metadata_uri: Option<String>`.
- Define two new resolver traits alongside the existing `MetadataUriResolver`:
  ```rust
  #[async_trait]
  pub trait ImmutableDataResolver: Send + Sync {
      async fn immutable_loan_data(&self, contract: Address, loan_id: U256)
          -> Result<ImmutableLoanDataView>;
  }
  #[async_trait]
  pub trait MutableDataResolver: Send + Sync {
      async fn mutable_loan_data(&self, contract: Address, loan_id: U256)
          -> Result<MutableLoanDataView>;
  }
  ```
  Define plain Rust `ImmutableLoanDataView` / `MutableLoanDataView` structs in this file
  so the mapper layer is decoupled from the alloy-generated types. `LoanRegistryReader`
  impls both.

### 4. `packages/shared/migrations/20260528000001_loan_details_oncchain_columns.sql` (new)

```sql
-- Issue #442: indexer now snapshots the on-chain immutable + mutable structs at draw time
-- and tracks lifecycle changes via dedicated columns. Lifecycle events still write to
-- contract_logs as the immutable audit trail; loan_details holds the current state.
ALTER TABLE loan_details
  DROP COLUMN original_facility_size,
  ADD COLUMN facility               TEXT,
  ADD COLUMN status                 TEXT        NOT NULL DEFAULT 'Performing',
  ADD COLUMN closure_reason         TEXT        NOT NULL DEFAULT 'None',
  ADD COLUMN current_maturity_date  BIGINT,
  ADD COLUMN ccr_bps                INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN location               TEXT        NOT NULL DEFAULT '',
  ADD COLUMN repayment_offtaker_amount         NUMERIC(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN repayment_equity_distributed      NUMERIC(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN repayment_senior_principal_repaid NUMERIC(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN repayment_senior_interest         NUMERIC(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN repayment_mgmt_fee                NUMERIC(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN repayment_perf_fee                NUMERIC(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN repayment_oet_alloc               NUMERIC(78,0) NOT NULL DEFAULT 0;

-- One-off rename: historical contract_logs rows for the on-chain LoanDrawn event were
-- written with event_name = 'LoanMinted'. Bring them in line with the new identifier.
UPDATE contract_logs SET event_name = 'LoanDrawn' WHERE event_name = 'LoanMinted';
```

### 5. `packages/shared/src/loan_details_repo.rs`

- Remove `original_facility_size` from `LoanDetailsRow` and the INSERT/SELECT lists.
- Add 13 new fields to `LoanDetailsRow`: `facility: Option<String>`, `status: String`,
  `closure_reason: String`, `current_maturity_date: Option<i64>`, `ccr_bps: i32`,
  `location: String`, and 7 `BigDecimal` repayment columns.
- Update `upsert_loan_details` INSERT and `ON CONFLICT DO UPDATE` to include all new
  columns and drop the removed one.
- Update `list_loans_for_window` and `get_loan_details` SELECT lists.
- Add narrow connection-scoped mutators for lifecycle handlers:
  - `update_status(conn, chain_id, loan_id, status: &str)`
  - `update_closure(conn, chain_id, loan_id, status, closure_reason)`
  - `update_ccr_bps(conn, chain_id, loan_id, ccr_bps: i32)`
  - `update_location(conn, chain_id, loan_id, location: &str)`
  - `update_default(conn, chain_id, loan_id, ccr_bps: i32)` — sets `status='Default'` + ccr
  - `update_repayment_snapshot(conn, chain_id, loan_id, snapshot: &RepaymentSnapshot)`
  Define a `RepaymentSnapshot` struct (7 `BigDecimal` fields) in this file.

### 6. `packages/worker/src/indexer/loan_mapper.rs` — rename + rewrite

- Rename `LoanMintedMapper` → `LoanDrawnMapper`. Replace all `LoanMinted` strings in
  comments / error context with `LoanDrawn`.
- Constructor extends with two new resolver traits (`ImmutableDataResolver`,
  `MutableDataResolver`).
- `populate_details` flow:
  1. `loan_id` BigDecimal → U256.
  2. `uri = resolver.metadata_uri(addr, loan_id).await?`
  3. `immutable = immutable_resolver.immutable_loan_data(addr, loan_id).await?`
  4. `mutable = mutable_resolver.mutable_loan_data(addr, loan_id).await?`
  5. `json = fetcher.fetch_metadata(&uri).await?`
  6. Build `LoanDetailsRow` from all three sources (see field map in **Field sourcing**
     below).
  7. `details_repo.upsert_loan_details(conn, &row).await?`
- Atomic-rollback model preserved end-to-end.

### 7. Lifecycle mappers (same file, new structs)

Each impls `LogMapper`. Constructors take `(event, chain_id, event_repo, details_repo,
[mutable_resolver])`. `is_duplicate`, `block_number`, `set_block_timestamp` mirror
`ContractLogMapper`.

- `LoanStatusUpdatedMapper`: `insert_log` → `update_status`.
- `LoanCcrUpdatedMapper`: `insert_log` → `update_ccr_bps`.
- `LoanLocationUpdatedMapper`: `insert_log` → `mutable_resolver.mutable_loan_data(...)`
  → `update_location(...mutable.location)`.
- `LoanDefaultedMapper`: `insert_log` → `update_default(ccr_bps)`.
- `LoanClosedMapper`: `insert_log` → `update_closure('Closed', closure_reason)`.
- `LoanRepaymentMapper`: `insert_log` → `mutable_resolver.mutable_loan_data(...)` →
  `update_repayment_snapshot(...mutable.repaymentData)`.

### 8. `packages/worker/src/indexer/mod.rs` — rewire dispatch

- Update parser dispatch: replace `parse_loan_minted` with `parse_loan_drawn` in the
  `.or_else` chain on the loan-registry handler.
- Build the two new resolvers once at job startup (the same `LoanRegistryReader` impls
  all three resolver traits; clone `Arc<LoanRegistryReader>` and upcast).
- Replace the `if ev.event_name == "LoanMinted"` branch with a match on the new event
  names:
  ```rust
  match ev.event_name.as_str() {
      "LoanDrawn"           => Box::new(LoanDrawnMapper::new(...)),
      "LoanStatusUpdated"   => Box::new(LoanStatusUpdatedMapper::new(...)),
      "LoanCCRUpdated"      => Box::new(LoanCcrUpdatedMapper::new(...)),
      "LoanLocationUpdated" => Box::new(LoanLocationUpdatedMapper::new(...)),
      "LoanDefaulted"       => Box::new(LoanDefaultedMapper::new(...)),
      "LoanClosed"          => Box::new(LoanClosedMapper::new(...)),
      "LoanRepayment"       => Box::new(LoanRepaymentMapper::new(...)),
      _ => Box::new(ContractLogMapper::new(ev, chain_id, loan_log_repo.clone())),
  }
  ```

### 9. Downstream event_name sweep

Anywhere `event_name = 'LoanMinted'` is referenced in code or SQL:

- `packages/shared/src/contract_logs_repo.rs` — `grep` for `LoanMinted` and rename.
- `packages/api/src/routes/portfolio.rs` — same.
- Any other crate (`grep -rn "LoanMinted" packages/`).

Confirm no string remains besides historic comments that intentionally document the
rename.

### 10. Parser unit tests — `packages/worker/tests/parsers.rs`

- Replace the test-local `LoanMinted` `sol!` decl with `LoanDrawn`.
- Rewrite `loan_minted_decodes` → `loan_drawn_decodes`: 3 topics, empty `data`. Assert
  `event_name == "LoanDrawn"`. Preserve the assertion that `metadata_uri` is **not** in
  params (it's a hashed topic).
- Replace the `Repayment` `sol!` decl with the struct form.
- Rewrite `loan_repayment_decodes`: ABI-encode the `RepaymentData` tuple. Assert all 7
  new keys present with correct decimal-string values.
- The 5 unchanged lifecycle tests stay.

### 11. Mapper integration tests — `packages/worker/tests/loan_mapper.rs`

- Extend the trait-mocked harness with mocks for `ImmutableDataResolver` and
  `MutableDataResolver`.
- Happy-path `loan_drawn_mapper_inserts_full_row`: mock all 3 readers + IPFS fetcher;
  assert the full union of 19 columns on the row.
- One per lifecycle mapper:
  - `loan_status_updated_mapper_updates_loan_details`
  - `loan_ccr_updated_mapper_updates_loan_details`
  - `loan_location_updated_mapper_reads_mutable_and_updates`
  - `loan_defaulted_mapper_sets_status_and_ccr`
  - `loan_closed_mapper_sets_closed_status`
  - `loan_repayment_mapper_snapshots_cumulative` — two consecutive events on the same
    loan; assert the latest cumulative value lands (not a sum-of-sums).
- One failure-mode test for `LoanDrawnMapper`: mock the immutable resolver to fail;
  assert no `contract_logs` row, no `loan_details` row (outer transaction rolled back).

### 12. Product spec — `docs/product-specs/loans-data.md`

- Rewrite Data Model and API Contract sections to match the deployed `ILoanRegistry`.
- Document the three-source data split (IPFS / `immutableLoanData` / `mutableLoanData`).
- Rename `LoanMinted` → `LoanDrawn` and rewrite the `Repayment` payload section.
- Remove any reference to the fictional `getImmutable(loanId)` reader.
- Note that `loan_details.original_facility_size` has been removed; consumers compute
  `senior_tranche + equity_tranche` themselves.
- File a follow-up to close TD-9 once the spec is merged.

### 13. Lint + verify gates

- `cargo clippy --all -- -D warnings`
- `npx tsx scripts/lint-docs.ts`
- `cargo test -p pipeline-worker -p shared -p pipeline-api` (DB-gated tests require a
  Postgres connection; pure unit tests must not gate on env-var DB URLs per the
  project's standing test policy).

## Field sourcing reference (for step 6)

| `loan_details` column                    | Source                                    |
|---|---|
| `originator, borrower_id, commodity, corridor, governing_law, metadata_uri` | IPFS JSON via `tokenURI(loanId)` |
| `original_senior_tranche`                | `immutable.seniorTranche`                 |
| `original_equity_tranche`                | `immutable.equityTranche`                 |
| `original_offtaker_price`                | `immutable.offtakerPrice`                 |
| `senior_interest_rate_bps`               | `immutable.rateBps` (as `i32`)            |
| `origination_date`                       | `immutable.originationTimestamp` (`i64`)  |
| `original_maturity_date`                 | `immutable.originalMaturityTimestamp`     |
| `facility`                               | `immutable.facility`                      |
| `status`                                 | `loan_status_name(mutable.status)`        |
| `closure_reason`                         | `closure_reason_name(mutable.closureReason)` |
| `current_maturity_date`                  | `Some(mutable.currentMaturityDate as i64)`|
| `ccr_bps`                                | `mutable.ccrBps as i32`                   |
| `location`                               | `mutable.location`                        |
| `repayment_*` (7 columns)                | `mutable.repaymentData.*`                 |

## Critical files

- `packages/worker/src/indexer/parsers.rs`
- `packages/worker/src/indexer/loan_registry_reader.rs`
- `packages/worker/src/indexer/loan_metadata.rs`
- `packages/worker/src/indexer/loan_mapper.rs`
- `packages/worker/src/indexer/mod.rs`
- `packages/worker/tests/parsers.rs`
- `packages/worker/tests/loan_mapper.rs`
- `packages/shared/src/loan_details_repo.rs`
- `packages/shared/src/contract_logs_repo.rs`
- `packages/shared/migrations/20260528000001_loan_details_oncchain_columns.sql` (new)
- `packages/api/src/routes/portfolio.rs`
- `docs/product-specs/loans-data.md`
- `../pipeline-contracts/src/loanRegistry/LoanRegistryUpgradeable.sol` (read-only)
- `../pipeline-contracts/src/interfaces/ILoanRegistry.sol` (read-only)

## Verification

1. `cargo clippy --all -- -D warnings` is green.
2. `npx tsx scripts/lint-docs.ts` passes.
3. `cargo test -p pipeline-worker` decodes a synthetic `LoanDrawn` log (topic0 = keccak
   of the new signature, empty `data`) and a synthetic `Repayment` log carrying the
   tuple-encoded `RepaymentData`.
4. `cargo test -p pipeline-worker --test loan_mapper` exercises all 7 new mappers
   against a Postgres test DB.
5. End-to-end: against a regtest deployment that emits the new events, the indexer
   writes one fully populated `loan_details` row on `LoanDrawn` and updates the relevant
   columns on each lifecycle event. `contract_logs` carries the full audit trail with
   the new `event_name = 'LoanDrawn'`.

## Docs to update

- `docs/product-specs/loans-data.md` (Step 12).
- `docs/exec-plans/tech-debt-tracker.md` — note TD-9 (loans-data.md drift) resolved by
  this Issue.
- `ARCHITECTURE.md` — refresh the `packages/worker` bullet that mentions `LoanMinted`
  to read `LoanDrawn`.

---

## Pass 3 — Contract drift fixes + YieldMinter addition (2026-05-28)

Third coder pass fixing three contract drift bugs discovered after Pass 2, plus adding
the `PipelineYieldMinter` contract to the indexer.

### Fix 1 — `Repayment` event signature drift

`Repayment` now has `uint256 indexed repaymentId` as the second topic:
`event Repayment(uint256 indexed tokenId, uint256 indexed repaymentId, RepaymentData repaymentData)`

Updated the `sol!` event declaration in `parsers.rs` and the test-local declaration in
`tests/parsers.rs`. `parse_loan_repayment` now emits `repayment_id` (decimal string)
in the params JSON. `loan_repayment_decodes` test updated to pass `repaymentId` topic.

### Fix 2 — `MutableLoanData` struct ABI drift

`MutableLoanData` gained a leading `uint256 nextRepaymentId` field. Updated the `sol!`
interface block in `loan_registry_reader.rs` and the `MutableLoanDataView` struct in
`loan_metadata.rs` (new field `next_repayment_id: U256`, kept for completeness; not
persisted in `loan_history`). `mock_mutable_view` in tests updated accordingly.

### Fix 3 — repayment data source: `cumulativeRepaymentData` not `MutableLoanData.repaymentData`

`_recordPayment` in the new contract writes to a separate top-level mapping
`cumulativeRepaymentData[loanId]` — the `repaymentData` field inside `MutableLoanData`
is dead storage (always zero from `mutableLoanData()` calls).

Added `cumulativeRepaymentData(uint256 loanId)` to the `sol!` interface block and
implemented `MutableDataResolver::cumulative_repayment_data` on `LoanRegistryReader`.
Both `LoanDrawnMapper::populate_history` and `lifecycle_history_row` now call
`cumulative_repayment_data` at the event block and use that for the 7 `repayment_*` columns.
Mock implementations in `tests/loan_mapper.rs` updated.

### Addition — `YieldMinted` event from `PipelineYieldMinter`

New contract emits `event YieldMinted(uint256 sPlUsdAmount, uint256 treasuryAmount)` (non-indexed).

- `parse_yield_minted` parser added to `parsers.rs` with `yield_minted_decodes` unit test.
- `yield_minter_contracts: Vec<String>` added to `IndexerJobSettings`; parsed from
  `JOB_INDEXER_YIELD_MINTER_CONTRACTS` (optional, defaults to empty).
- `mod.rs` wires the new address list to a `ContractLogMapper` via `parse_yield_minted`.
- `docs/product-specs/loans-data.md` updated with the new event, struct drift, and
  cumulative repayment data sourcing.

Gates passed: `cargo clippy --all -- -D warnings`, `cargo test --all`, `npx tsx scripts/lint-docs.ts`.

## Pass 4 (2026-05-29): drop `loan_history`, consolidate into `contract_logs.params` JSONB

Reviewing the loan_history design, we observed that `contract_logs` already has a unified `params JSONB NOT NULL` column with a GIN index (migration `20260521000001_contract_logs_jsonb.sql`). A second dedicated table for loan snapshots is redundant — a fat per-event JSONB snapshot in `contract_logs.params` carries the same information and removes one table, one repo file, and 7 specialised mapper structs.

The Portfolio API does not filter on loan columns server-side; it reads rows and projects in Rust. So losing typed columns costs nothing the current consumer relies on.

### Design

Each loan-related event's `contract_logs.params` JSONB is shaped:
```json
{
  "loan_id": "42",
  "event":    { /* parser-emitted event-specific fields */ },
  "snapshot": { /* full per-event state — what loan_history.* columns carried */ }
}
```

`loan_id` stays at the top level (matches the existing `(params->>'loan_id')::numeric` convention in `contract_logs_repo.rs`). `snapshot` carries IPFS-sourced + on-chain immutable + on-chain mutable fields + the 7 cumulative repayment fields, all populated with the same carry-forward + block-pinned semantics as the loan_history design.

### Changes from Pass 2/3

- **Drop** the `loan_history` table (migration rewritten to a single-statement drop).
- **Delete** `packages/shared/src/loan_history_repo.rs` and `packages/shared/src/loan_details_repo.rs` (the latter was a zombie from Pass 2).
- **New** `packages/shared/src/loan_snapshot.rs` defining `LoanSnapshot` + `RepaymentSnapshot` (serde Serialize/Deserialize).
- **Extend** `ContractLogsRepo` with snapshot-aware queries (`list_latest_loan_snapshots`, `get_earliest_origination_date`, `get_latest_loan_snapshot`) and a `LoanSnapshotRow` row type.
- **Collapse** the 7 specialised mappers in `loan_mapper.rs` into a single `LoanEventMapper` that switches behaviour by `event.event_name`. It enriches `ContractLog.params` (moving parser-emitted fields under `event`, adding `snapshot`) and inserts via the existing `EventRepo.insert_log` path — no separate write.
- **Switch** the Portfolio API to read `LoanSnapshotRow` from `ContractLogsRepo` (drop the `LoanHistoryRepo` field on `AppState`).
- **Rewrite** mapper tests to assert on the JSONB shape; switch `portfolio_compute.rs` fixtures to `LoanSnapshotRow`.
- **Update** `docs/product-specs/loans-data.md` storage section to describe the JSONB snapshot model and the SQL pattern for "current state of loan X".

The plan-mode source for this pass is `/Users/aabliazimov/.claude/plans/expressive-chasing-fairy.md`.

## Pass 5 (2026-06-01): Contract restructuring — new field names, LocationUpdate, silent _updateMutable

The `LoanRegistryUpgradeable` contract underwent a significant restructuring of its data
surface. This pass aligns the entire indexer stack to the current contract.

### Contract changes from Pass 4 to Pass 5

**Removed events (declared but never emitted — `_updateMutable` is silent):**
`StatusUpdated`, `CCRUpdated`, `LocationUpdated` — dropped from parsers, dispatch, and tests.

**Renamed event:** `Repayment` → `PaymentRecorded` (event name in `contract_logs` changes from
`LoanRepayment` to `PaymentRecorded`).

**`RepaymentData` struct reordered and renamed:**
- `offtakerAmount` → `offtakerReceived` (moved to position 0)
- Field order: `offtakerReceived, seniorPrincipalRepaid, seniorInterest, equityDistributed, mgmtFee, perfFee, oetAlloc`

**`ImmutableLoanData` fully rewritten:**
Old: `seniorTranche, equityTranche, offtakerPrice, rateBps, originationTimestamp, originalMaturityTimestamp, facility` (mixed uint128/uint256/string)
New: `originalFacilitySize, originalSeniorTranche, originalEquityTranche, originalOfftakerPrice, seniorInterestRateBps (uint32), originationDate (uint64), originalMaturityDate (uint64)` — `facility` dropped.

**`MutableLoanData` fully rewritten:**
Old: `nextRepaymentId, status, closureReason, repaymentData (embedded), currentMaturityDate (uint128), ccrBps, location (string)`
New: `nextEconomicsEpochsId, nextRepaymentId, status, ccrBps, lastReportedCCRTimestamp, currentMaturityTimestamp, closureReason, currentLocation (LocationUpdate struct), metadataURI (mutable string)`

**New type:** `LocationType { Vessel, Warehouse, TankFarm, Other }` + `LocationUpdate { locationType, locationIdentifier, trackingURL, updatedAt }`

**`ClosureReason` extended:** ordinal 4 → `OtherWriteDown`.

### Files changed

- `packages/worker/src/indexer/parsers.rs` — removed 3 dead event parsers; renamed `Repayment`→`PaymentRecorded`, `parse_loan_repayment`→`parse_payment_recorded`; updated `RepaymentData` field order and names; extended `closure_reason_name` for ordinal 4; removed `loan_status_name`.
- `packages/worker/src/indexer/loan_registry_reader.rs` — full rewrite of `sol!` interface block to match new types; updated `immutable_loan_data`, `mutable_loan_data`, `cumulative_repayment_data` builders.
- `packages/worker/src/indexer/loan_metadata.rs` — full rewrite: new `ImmutableLoanDataView` (7 new fields), new `LocationType` enum + `from_ordinal`, new `LocationUpdateView`, new `MutableLoanDataView` (9 fields), `RepaymentDataView` (new field names/order).
- `packages/worker/src/indexer/loan_mapper.rs` — removed 3 dead dispatch branches; updated `snapshot_for_drawn` and `snapshot_for_lifecycle` for new field set; added IPFS re-fetch semantics (compare `metadata_uri_onchain`, re-fetch when changed); fixed `u256_to_bigdecimal` to use `.expect()` instead of `.unwrap_or_else()`.
- `packages/worker/src/indexer/mod.rs` — removed 3 dead parser imports + dispatch entries; added `parse_payment_recorded`.
- `packages/shared/src/loan_snapshot.rs` — full rewrite: new `LoanSnapshot` (20 fields), new `LocationUpdateSnapshot`, renamed `RepaymentSnapshot` fields.
- `packages/shared/src/contract_logs_repo.rs` — updated 3 `event_name IN (...)` filters from 7 stale names to 4 current names.
- `packages/worker/tests/parsers.rs` — removed 3 deleted-event tests; rewrote `loan_repayment_decodes` → `payment_recorded_decodes`; added `loan_closed_other_write_down_decodes`.
- `packages/worker/tests/loan_mapper.rs` — updated mock resolver structs to new field shapes; renamed `LoanRepayment` → `PaymentRecorded` in lifecycle test helpers; removed stale CCR/Location test cases.
- `packages/api/tests/portfolio_compute.rs` — updated `LoanSnapshot` fixture literals to new field set; added `zero_location()` helper; renamed `offtaker_amount` → `offtaker_received`.
- `docs/product-specs/loans-data.md` — rewritten to document 4 emitted events, silent `_updateMutable`, new struct shapes, IPFS re-fetch semantics.

### Notable decisions

- `senior_interest_rate_bps` widened from `i32` to `u32` in `LoanSnapshot` (matches contract type `uint32`). `i64::from(u32)` in portfolio compute is valid.
- `original_maturity_date` kept for portfolio yield compute boundary (not `current_maturity_timestamp`) to preserve existing semantics; `current_maturity_timestamp` stored as informational.
- `LocationType::from_ordinal` clamps out-of-range values to `Other` (same sentinel as the contract's last enum variant).
- `u256_to_bigdecimal` now uses `.expect()` — U256 always serialises to a valid decimal string; silent corruption via `unwrap_or_else(BigDecimal::from(0))` was removed.

### Gate results

- `cargo clippy --all -- -D warnings`: 0 errors, 0 warnings
- `npx tsx scripts/lint-docs.ts`: 0 errors, 29 warnings (pre-existing)
- `cargo test --all`: 74 tests passed, 0 failed
