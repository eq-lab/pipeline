# Issue #363: Index ImmutableLoanData from metadataURI on LoanMinted

Source: https://github.com/eq-lab/pipeline/issues/363

## Scope

**In scope:**

1. Add a new `loans` table (and `loan_fetch_failures` sidecar table) via a new sqlx migration in `packages/shared/migrations/`.
2. New `shared::loan_repo::LoanRepo` with `upsert_loan`, `update_loan_status`, `record_fetch_failure`, and read helpers (`get_loan`, `list_loans`) used by downstream consumers (separate Portfolio Yield API Issue).
3. New `pipeline_worker::indexer::loan_metadata` module exposing `fetch_metadata(uri: &str) -> Result<ImmutableLoanData>` over `reqwest`. Supports `http(s)://` and `ipfs://CID` schemes (IPFS via configured gateway). Retry with backoff 1s / 5s / 30s (3 attempts total).
4. Extend the `LoanMinted` indexing path (already implemented in `packages/worker/src/indexer/mappers.rs` for #336's `contract_logs` row) to additionally call `fetch_metadata` and `upsert_loan`. The new behaviour must run inside the same `mapper.insert(...)` call so it executes in the indexer's open transaction.
5. Extend the `LoanClosed`, `LoanDefaulted`, and `LoanStatusUpdated` handlers in the same mapper layer to call `update_loan_status` against the existing `loans` row (status / closed_at / closure_reason).
6. Failure-handling policy: if `fetch_metadata` fails after all retries, insert a `loan_fetch_failures` row, log a warn, and **still insert the `contract_logs` LoanMinted row** (event indexing must not block on URI availability). The mapper must not propagate fetch errors out of `insert(...)`.
7. New env var `IPFS_GATEWAY_URL` (default `https://ipfs.io/ipfs/`), wired into worker config and `.env.example` if such a file exists for the worker.
8. Unit and integration tests for `loan_repo`, `loan_metadata`, the LoanMinted upsert path, and the lifecycle-update handlers.
9. Product-spec note. Add a short paragraph to `docs/product-specs/loans-data.md` (or a new sibling `docs/design-docs/`) documenting the off-chain `loans` materialisation and the failure mode, so future readers know the DB shape is authoritative for read APIs.

**Out of scope:**

- The Portfolio Yield API endpoint (`/v1/portfolio/yield`) that consumes the `loans` table (separate Issue).
- Backfill for loans minted before this lands. Operator re-runs the indexer from the configured start block; `upsert_loan` is idempotent.
- Partial-senior-principal amortisation tracking (log in `docs/exec-plans/tech-debt-tracker.md` if not already tracked).
- Renaming `LoanRepayment` → `RepaymentRecorded` (cosmetic; bundle later).
- Background retry job for `loan_fetch_failures` (separate Issue if failure rate warrants it).
- Re-emitting / repairing failed metadata fetches in this iteration.

## Assumptions and Risks

- **Indexer transaction boundary.** `LogMapper::insert` is called inside an open `&mut PgConnection` tied to the indexer's outer transaction (see `index_once` in `packages/worker/src/indexer/mod.rs`). The `LoanMinted` upsert path must run on that same connection so the `contract_logs` row and the `loans` row land atomically. Any `reqwest` fetch must therefore complete before `insert(...)` returns; the retry budget (1s + 5s + 30s ≈ ~36s worst case) stalls indexing of that block range. This is acceptable for a low-volume LoanMinted event stream but must be made explicit. If a future high-volume scenario emerges, lift the fetch out of the transaction (tech debt).
- **Indexed `metadataURI` is a hash, not the string.** In the deployed event, `metadataURI` is declared as `string indexed`, so the topic value the indexer receives is the keccak256 hash of the URI, not the URI itself. The existing parser already stores the topic into `params["metadata_uri"]` as the hashed value. We need the actual URI to fetch the JSON. Two paths exist:
  1. Read the URI from `LoanRegistry.getImmutable(tokenId).metadataURI` via an `eth_call` (extra RPC roundtrip per mint).
  2. Change the parser to ABI-decode the URI from non-indexed event data — only possible if the event is redeclared with `metadataURI` not indexed (contract change, out of scope).
  The plan uses option 1: add a `LoanRegistryReader` (alloy contract binding) and call `getImmutable(loanId)` to resolve the on-chain URI. This is captured in **Open Questions** because it changes the worker's contract dependencies.
- **IPFS gateway availability.** Public gateways (`ipfs.io`) are best-effort. The 3-attempt retry is short; persistent failures are recorded in `loan_fetch_failures`. The operator can swap `IPFS_GATEWAY_URL` to a private pinned gateway in production.
- **JSON schema drift.** If the off-chain JSON diverges from the Solidity `ImmutableLoanData` field set, `serde_json::from_slice::<ImmutableLoanData>` will fail and the loan row will not be created (failure-recorded path). Schema drift surfaces as `loan_fetch_failures.last_error` containing `serde_json` parse errors.
- **`NUMERIC(78,0)` representation.** The `uint256` JSON values arrive as decimal strings. They must be bound to SQL as `bigdecimal::BigDecimal` (already a workspace dep). All 5 NUMERIC columns must use `BigDecimal::from_str(...)` and reject any decimal-point input.
- **Idempotency.** `upsert_loan` runs `INSERT ... ON CONFLICT (chain_id, loan_id) DO UPDATE SET ...`. Status mutators (`update_loan_status`) must NOT clobber immutable fields — they only set `status`, `closed_at`, `closure_reason`.
- **Re-org safety.** This iteration assumes block reorgs deeper than `log_confirmations_delay` (default 12) never happen. A reorg that removes a `LoanMinted` event after our `loans` row is written would leave an orphan row. Tracked as tech debt for the indexer overall, not unique to this Issue.

## Open Questions

- Q1. **`metadataURI` recovery strategy.** Confirm option 1 (`eth_call` to `LoanRegistry.getImmutable(loanId)`) is acceptable. The alternative is to change the on-chain event to make `metadataURI` non-indexed in a future contract version; for now we add an `eth_call` per `LoanMinted` event. Should the `eth_call` happen against the same `eth_rpc_url` used by the indexer poller (yes, default), and should we cache by `loanId` (yes, but cache is in-process only)?
- Q2. **Where does `LoanRegistryReader` live?** The cleanest home is `packages/shared/src/evm.rs` next to existing alloy bindings, or a new `packages/shared/src/loan_registry.rs`. The plan defaults to a new `loan_registry.rs` module under `packages/shared` so both `worker` and `api` can depend on it; flag if reviewer prefers it under `packages/worker/src/indexer/`.
- Q3. **Treatment of `metadataURI` being empty / null.** The Solidity struct allows `string metadataURI` to be empty (the event already carries one URI; the field inside the JSON is a *secondary* pointer). The plan stores it as `NULL` via `Option<String>` in the repo, and the migration declares the column as `NULL`-able. Confirm this is OK rather than treating empty `metadataURI` as a hard fetch failure.

## Implementation Steps

### Step 1: Migration

Create `packages/shared/migrations/20260522000001_loans_table.sql` matching the schema from the Issue body:

```sql
CREATE TABLE loans (
    chain_id                    BIGINT       NOT NULL,
    loan_id                     NUMERIC(78,0) NOT NULL,
    holder                      TEXT         NOT NULL,
    originator                  TEXT         NOT NULL,
    borrower_id                 TEXT         NOT NULL,
    commodity                   TEXT         NOT NULL,
    corridor                    TEXT         NOT NULL,
    original_facility_size      NUMERIC(78,0) NOT NULL,
    original_senior_tranche     NUMERIC(78,0) NOT NULL,
    original_equity_tranche     NUMERIC(78,0) NOT NULL,
    original_offtaker_price     NUMERIC(78,0) NOT NULL,
    senior_interest_rate_bps    INTEGER      NOT NULL,
    origination_date            BIGINT       NOT NULL,
    original_maturity_date      BIGINT       NOT NULL,
    governing_law               TEXT         NOT NULL,
    metadata_uri                TEXT         NOT NULL,
    inner_metadata_uri          TEXT,
    status                      TEXT         NOT NULL DEFAULT 'Performing',
    closed_at                   BIGINT,
    closure_reason              TEXT,
    indexed_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, loan_id)
);
CREATE INDEX loans_origination_idx ON loans (origination_date);
CREATE INDEX loans_closed_idx      ON loans (closed_at) WHERE closed_at IS NOT NULL;

CREATE TABLE loan_fetch_failures (
    chain_id        BIGINT       NOT NULL,
    loan_id         NUMERIC(78,0) NOT NULL,
    metadata_uri    TEXT         NOT NULL,
    last_error      TEXT         NOT NULL,
    attempts        INT          NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, loan_id)
);
```

Notes:
- `metadata_uri` stores the URI from the on-chain `getImmutable(loanId).metadataURI` (the URI that was fetched).
- `inner_metadata_uri` stores the optional secondary URI carried inside the JSON document (`metadataURI` key in the JSON), nullable per Q3.

### Step 2: New `loan_metadata` module in the worker

Create `packages/worker/src/indexer/loan_metadata.rs`:

```rust
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImmutableLoanData {
    pub originator: String,
    #[serde(rename = "borrowerId")]
    pub borrower_id: String,
    pub commodity: String,
    pub corridor: String,
    #[serde(rename = "originalFacilitySize")]
    pub original_facility_size: String,
    #[serde(rename = "originalSeniorTranche")]
    pub original_senior_tranche: String,
    #[serde(rename = "originalEquityTranche")]
    pub original_equity_tranche: String,
    #[serde(rename = "originalOfftakerPrice")]
    pub original_offtaker_price: String,
    #[serde(rename = "seniorInterestRateBps")]
    pub senior_interest_rate_bps: String,
    #[serde(rename = "originationDate")]
    pub origination_date: String,
    #[serde(rename = "originalMaturityDate")]
    pub original_maturity_date: String,
    #[serde(rename = "governingLaw")]
    pub governing_law: String,
    #[serde(default, rename = "metadataURI")]
    pub metadata_uri: Option<String>,
}

pub struct LoanMetadataFetcher {
    http: reqwest::Client,
    ipfs_gateway_url: String, // e.g. "https://ipfs.io/ipfs/"
}

impl LoanMetadataFetcher {
    pub fn new(http: reqwest::Client, ipfs_gateway_url: String) -> Self { ... }

    /// Fetches and parses the metadata document. Retries with 1s/5s/30s backoff (3 attempts).
    /// Returns Err on terminal failure; the caller logs to `loan_fetch_failures`.
    pub async fn fetch_metadata(&self, uri: &str) -> Result<ImmutableLoanData> { ... }

    fn resolve(uri: &str, gateway: &str) -> Result<reqwest::Url> { ... }
}
```

- For `ipfs://CID[/path]` strip the scheme and join onto `IPFS_GATEWAY_URL` (e.g. `https://ipfs.io/ipfs/CID/path`).
- For `https://...` and `http://...` use the URL as-is.
- All other schemes return a terminal error (no retry).
- Retries fire only on transport / 5xx errors; 4xx and JSON parse errors are terminal (one attempt, no further retries).

### Step 3: New `loan_repo` module in `packages/shared`

Create `packages/shared/src/loan_repo.rs` and wire it into `packages/shared/src/lib.rs`:

```rust
pub struct LoanRepo { pub pool: sqlx::PgPool }

pub struct LoanRow {
    pub chain_id: i64,
    pub loan_id: BigDecimal,
    pub holder: String,
    pub originator: String,
    pub borrower_id: String,
    pub commodity: String,
    pub corridor: String,
    pub original_facility_size: BigDecimal,
    pub original_senior_tranche: BigDecimal,
    pub original_equity_tranche: BigDecimal,
    pub original_offtaker_price: BigDecimal,
    pub senior_interest_rate_bps: i32,
    pub origination_date: i64,
    pub original_maturity_date: i64,
    pub governing_law: String,
    pub metadata_uri: String,
    pub inner_metadata_uri: Option<String>,
    pub status: String,
    pub closed_at: Option<i64>,
    pub closure_reason: Option<String>,
}

impl LoanRepo {
    pub async fn upsert_loan(&self, conn: &mut PgConnection, row: &LoanRow) -> Result<()>;
    pub async fn update_loan_status(
        &self,
        conn: &mut PgConnection,
        chain_id: i64,
        loan_id: &BigDecimal,
        status: &str,
        closed_at: Option<i64>,
        closure_reason: Option<&str>,
    ) -> Result<()>;
    pub async fn record_fetch_failure(
        &self,
        conn: &mut PgConnection,
        chain_id: i64,
        loan_id: &BigDecimal,
        metadata_uri: &str,
        err: &str,
    ) -> Result<()>;
    pub async fn get_loan(&self, chain_id: i64, loan_id: &BigDecimal) -> Result<Option<LoanRow>>;
}
```

Behaviour:
- `upsert_loan`: `INSERT ... ON CONFLICT (chain_id, loan_id) DO UPDATE SET <all immutable columns>` so a re-index from genesis is idempotent. Does not touch `status`, `closed_at`, `closure_reason`.
- `update_loan_status`: noop if no row exists (logs `warn!` with `loan_id`). When `status == "Closed"`, set `closed_at = block_timestamp` and `closure_reason` from the event.
- `record_fetch_failure`: `INSERT ... ON CONFLICT (chain_id, loan_id) DO UPDATE SET attempts = attempts + 1, last_error = $..., last_attempt_at = NOW()`.

### Step 4: On-chain `LoanRegistry` binding for `getImmutable`

Add a minimal alloy contract binding at `packages/shared/src/loan_registry.rs` (per Q2 — flag if reviewer disagrees):

```rust
alloy::sol! {
    #[sol(rpc)]
    interface ILoanRegistry {
        struct ImmutableLoanData {
            address originator;
            bytes32 borrowerId;
            string  commodity;
            string  corridor;
            uint256 originalFacilitySize;
            uint256 originalSeniorTranche;
            uint256 originalEquityTranche;
            uint256 originalOfftakerPrice;
            uint256 seniorInterestRateBps;
            uint256 originationDate;
            uint256 originalMaturityDate;
            string  governingLaw;
            string  metadataURI;
        }
        function getImmutable(uint256 tokenId) external view returns (ImmutableLoanData memory);
    }
}

pub struct LoanRegistryReader { provider: alloy::providers::RootProvider<...>, ... }

impl LoanRegistryReader {
    pub fn new(rpc_url: &str) -> Result<Self>;
    /// Returns the canonical metadata URI for a loan.
    pub async fn metadata_uri(&self, contract: Address, loan_id: U256) -> Result<String>;
}
```

`metadata_uri` simply returns `getImmutable(loanId).metadataURI`. The full on-chain struct is not needed at indexing time — the off-chain JSON is the source of truth — but we read it to recover the URI from the indexed-string topic.

In-process LRU cache: a `tokio::sync::Mutex<HashMap<(Address, U256), String>>` on `LoanRegistryReader` of bounded size (e.g. 4096 entries) to avoid re-fetching across mapper recomputes during a single indexer process lifetime.

### Step 5: Wire metadata fetching into the `LoanMinted` mapper

The current flow registers `parse_loan_*` parsers under the `loan_registry_contracts` event handler in `packages/worker/src/indexer/mod.rs`, all wrapped in a generic `ContractLogMapper`. Change this so the loan handler uses a dedicated `LoanRegistryMapper` instead:

1. Add `packages/worker/src/indexer/loan_mapper.rs`:
   ```rust
   pub struct LoanRegistryMapper {
       event: ContractLog,
       chain_id: i64,
       event_repo: Arc<EventRepo>,
       loan_repo: Arc<LoanRepo>,
       metadata_fetcher: Arc<LoanMetadataFetcher>,
       registry_reader: Arc<LoanRegistryReader>,
   }
   #[async_trait] impl LogMapper for LoanRegistryMapper { ... }
   ```
2. In `insert(...)`:
   - Always call `event_repo.insert_log(conn, &self.event, self.chain_id)` first (preserves #336's contract_logs behaviour).
   - Then branch by `event_name`:
     - `LoanMinted`: resolve `metadata_uri` via `registry_reader.metadata_uri(...)`, call `metadata_fetcher.fetch_metadata(uri)`. On success, build a `LoanRow` and call `loan_repo.upsert_loan(...)`. On failure, call `loan_repo.record_fetch_failure(...)` and `tracing::warn!` — do **not** propagate the error.
     - `LoanClosed`: parse `loan_id` and `closure_reason` from `event.params`, call `loan_repo.update_loan_status(conn, chain_id, &loan_id, "Closed", Some(event.block_timestamp), Some(reason))`.
     - `LoanDefaulted`: parse `loan_id`, call `update_loan_status(..., "Default", None, None)`.
     - `LoanStatusUpdated`: parse `loan_id` and `status` string, call `update_loan_status(..., &status, None, None)`.
     - Other loan events (`LoanCCRUpdated`, `LoanLocationUpdated`, `LoanRepayment`): no `loans` table change — `contract_logs` insert is sufficient.
3. In `packages/worker/src/indexer/mod.rs`:
   - Construct `LoanMetadataFetcher`, `LoanRegistryReader`, and an `Arc<LoanRepo>` once at job start.
   - Replace the loan-registry `add_event_handler` block to return a `LoanRegistryMapper` instead of a `ContractLogMapper`.

### Step 6: Config wiring

In `packages/worker/src/indexer/config.rs`:

- Add `ipfs_gateway_url: String` to `IndexerJobSettings`, read from `IPFS_GATEWAY_URL` with default `https://ipfs.io/ipfs/`.

In `packages/worker/src/main.rs`: nothing changes; `run_indexer_job(settings, pool)` already receives both.

### Step 7: Update `parsers.rs` for status string normalisation

Verify the existing `parse_loan_status_updated` writes `params["status"]` as the string name (e.g. `"WatchList"`). The mapper relies on this — `update_loan_status` simply forwards the string. No code change expected, but add a unit test that asserts a `StatusUpdated` event with ordinal 3 produces `params["status"] == "Closed"`, since the mapper would route that to a `Closed` lifecycle on the row.

### Step 8: Add `LoanRepo` to `main.rs` wiring

The worker's `main.rs` already calls `run_indexer_job(settings, pool)`. Inside `run_indexer_job` (Step 5) we will instantiate `LoanRepo::new(pool.clone())` from the same pool. No new env vars beyond `IPFS_GATEWAY_URL`.

### Step 9: Tests

See **Test Strategy**. New tests live under:
- `packages/worker/tests/loan_metadata.rs` — unit tests for the fetcher.
- `packages/worker/tests/loan_mapper.rs` — integration test for `LoanRegistryMapper::insert` against a real Postgres (skipped without `DATABASE_URL`, matching `indexer_integration.rs` pattern).
- `packages/shared/tests/loan_repo.rs` — unit tests for `upsert_loan`, `update_loan_status`, `record_fetch_failure` against a real Postgres.

### Step 10: Docs

- Add a short section "Off-chain `loans` materialisation" to `docs/product-specs/loans-data.md` describing the indexer-side `loans` table, the failure mode (event-indexing never blocks on URI availability), and that `loan_fetch_failures` is the operator-visible signal.
- Add an entry to `docs/exec-plans/tech-debt-tracker.md` for the in-transaction `reqwest` fetch (note the worst-case ~36 s stall risk and the future move to an async backfill job).

## Test Strategy

### Unit tests — `loan_metadata.rs`

`packages/worker/tests/loan_metadata.rs` (uses `wiremock` or `mockito` — pick `mockito` as it's already common in Rust async test suites; add to `[dev-dependencies]` of `pipeline-worker`):

1. `fetches_https_success` — 200 OK with the full JSON sample from the Issue, asserts every parsed field.
2. `routes_ipfs_to_gateway` — `ipfs://CID/path` → asserts the HTTP request URL is `<gateway>CID/path`.
3. `retries_on_5xx_three_times` — server returns 500 / 500 / 200; assert success and 3 total requests. Verify backoff is at least configured intervals (test sets short overrides via constructor params to keep the run fast).
4. `terminal_on_4xx` — server returns 404; one attempt only, returns Err.
5. `terminal_on_malformed_json` — server returns 200 with invalid JSON; one attempt only.
6. `terminal_on_missing_fields` — server returns 200 with JSON missing `originatorId`; one attempt only (serde rejection).
7. `terminal_on_unknown_scheme` — `ftp://...` returns Err without any HTTP attempt.

### Unit tests — `loan_repo.rs`

`packages/shared/tests/loan_repo.rs` (DB-backed, gated on `DATABASE_URL` matching the existing convention):

1. `upsert_loan_insert_then_idempotent_update` — insert once, call again with the same fields, assert no change and no duplicate (PK is `(chain_id, loan_id)`).
2. `upsert_loan_does_not_overwrite_status` — insert with default `status='Performing'`, call `update_loan_status` to `'Closed'`, then `upsert_loan` again, assert `status` is still `'Closed'`.
3. `update_loan_status_to_closed_sets_closed_at_and_reason`.
4. `update_loan_status_noop_when_no_row` — returns Ok, logs warn; `get_loan` returns None.
5. `record_fetch_failure_increments_attempts`.

### Integration test — `loan_mapper.rs`

`packages/worker/tests/loan_mapper.rs` (DB-backed, gated on `DATABASE_URL`):

Use a trait abstraction or dependency injection so the test can substitute a mock `LoanMetadataFetcher` and `LoanRegistryReader`. Concretely:

- Define `trait MetadataFetcher { async fn fetch_metadata(&self, uri: &str) -> Result<ImmutableLoanData>; }` and `trait MetadataResolver { async fn metadata_uri(&self, c: Address, id: U256) -> Result<String>; }`.
- The mapper holds `Arc<dyn MetadataFetcher>` and `Arc<dyn MetadataResolver>`.

Tests:

1. `loan_minted_success_inserts_both_rows` — feed a synthetic `LoanMinted` ContractLog to the mapper, mock fetcher returns the canonical JSON, assert both `contract_logs` and `loans` rows exist with correct values.
2. `loan_minted_fetch_failure_still_inserts_contract_log` — fetcher returns Err, assert `contract_logs` LoanMinted row exists AND `loan_fetch_failures` row exists AND `loans` has no row.
3. `loan_closed_flips_status_and_sets_closure_fields` — insert a loan row, feed `LoanClosed`, assert `status='Closed'`, `closed_at` set, `closure_reason` set.
4. `loan_status_updated_flips_status_only` — feed `LoanStatusUpdated` with `status='WatchList'`, assert `status` updated, `closed_at` and `closure_reason` remain null.
5. `loan_defaulted_flips_status_to_default`.
6. `loan_minted_idempotent_on_reindex` — call the mapper twice for the same event; `contract_logs` dedup kicks in (existing behaviour) and `loans` upsert is idempotent.

### Smoke

- `cargo clippy --all -- -D warnings` passes.
- `cargo test -p pipeline-worker` + `cargo test -p shared` pass (with and without `DATABASE_URL`).
- `cargo build --workspace` succeeds.

## Docs to Update

- `docs/product-specs/loans-data.md` — add an "Off-chain `loans` materialisation" subsection describing the DB shape, the failure mode (event indexing is not blocked on URI availability), and the existence of `loan_fetch_failures` as an ops surface.
- `docs/exec-plans/tech-debt-tracker.md` — log the in-transaction metadata fetch (worst case ~36 s stall) and the long-term move to a separate backfill worker.
- `docs/product-specs/index.md` — update only if the new subsection in `loans-data.md` requires a navigation entry (read first; likely no change).
- No user-facing doc changes (this is internal indexer plumbing).
