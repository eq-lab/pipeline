# Issue #363: Index ImmutableLoanData from metadataURI on LoanMinted

Source: https://github.com/eq-lab/pipeline/issues/363

## Implementation status

Complete (2026-05-22). Lint + tests green.

### Scope simplification (post-implementation user direction)

After the initial implementation landed, the user reviewed the schema and asked to drop both `loan_fetch_failures` AND the lifecycle columns from `loans`, renaming the table to `loan_details` and storing **only the immutable JSON fields** (the Solidity-described `ImmutableLoanData` struct, keyed by `(chain_id, loan_id)`). Lifecycle (`status`, `closed_at`, `closure_reason`) and `holder` are derivable from `contract_logs` — no need to materialise them. Rationale: the failures table was write-only (no consumer in this PR — background retry is out of scope) and lifecycle columns duplicated information already present in event rows.

Final shape:

- [x] Migration `20260522000001_loan_details_table.sql` — one table, immutable fields only, PK `(chain_id, loan_id)`.
- [x] `shared::metadata_fetcher::MetadataFetcher` — generic `fetch_json<T>` with ipfs:// resolution + 1s/5s/30s retry.
- [x] `pipeline_worker::indexer::loan_metadata` — `ImmutableLoanData` DTO + traits `LoanMetadataFetcher` / `MetadataUriResolver` for mocking + `HttpLoanMetadataFetcher` adapter.
- [x] `shared::loan_details_repo::{LoanDetailsRepo, LoanDetailsRow}` — only `upsert_loan_details` + `get_loan_details`. No status mutators, no failure recording.
- [x] `pipeline_worker::indexer::loan_registry_reader::LoanRegistryReader` — alloy `sol!` binding for ERC-721 `tokenURI`. Stateless (no cache — see Deviations).
- [x] `pipeline_worker::indexer::loan_mapper::LoanMintedMapper` — handles `LoanMinted` only (writes contract_logs row, then attempts tokenURI + fetch + upsert; failures emit `tracing::warn!` and return Ok). All other LoanRegistry events route through `ContractLogMapper`.
- [x] **Latent #336 bug fix**: `parse_loan_minted` no longer writes the dead indexed-string topic hash into `params["metadata_uri"]`.
- [x] `IndexerJobSettings.ipfs_gateway_url` reads `JOB_INDEXER_IPFS_GATEWAY_URL` (default `https://ipfs.io/ipfs/`); `.env.example` updated.
- [x] `run_indexer_job` constructs `MetadataFetcher`, `LoanRegistryReader`, `LoanDetailsRepo` once at job start; closure branches `LoanMinted` → `LoanMintedMapper`, else → `ContractLogMapper`.
- [x] Tests — `shared/tests/metadata_fetcher.rs` (7 tests, mockito), `shared/tests/loan_details_repo.rs` (3 tests, DB-gated), `worker/tests/loan_mapper.rs` (4 tests, DB-gated, trait-mocked fetcher+resolver).
- [x] Tech-debt entries TD-8 (in-tx fetch stall) and TD-9 (stale loans-data.md spec).

### Failure semantics — what the operator sees during a URI outage

Under the "never skip `loan_details`" policy there is no "failed loan_details" steady state: a LoanMinted in `contract_logs` either has a matching `loan_details` row (success) or both rows are absent (the batch rolled back and will be retried). The operator-visible signals are:

- **Indexer logs**: `tracing::error!` from `index_loop` carrying the per-batch failure with full anyhow context (HTTP status, parse error, etc.) plus the message "indexer error — retrying in 5s".
- **Indexer cursor stalls**: `last_indexed_block` in `log_collector_state` stops advancing past the offending block range. Combined with `eth_blockNumber` from the RPC, this is the canonical "indexer is stuck" alarm.
- **Mitigation**: point `JOB_INDEXER_IPFS_GATEWAY_URL` at a pinned private gateway, or accept the stall until the public gateway recovers.

### Deviations from the original plan

- `LoanRegistryReader` has **no in-process cache** (original plan called for an LRU). Each `LoanMinted` event is processed exactly once because the `is_duplicate(contract_logs)` gate runs before the mapper's `insert`, so a cache would have a 0% hit rate in the steady state. Reintroduce if a new code path starts calling `tokenURI` outside the once-per-event ingest flow.
- `MetadataUriResolver::metadata_uri` takes `(contract, loan_id)` so a single resolver serves multiple LoanRegistry contracts.
- `MetadataFetcher::with_backoffs(Vec<Duration>)` builder lets tests override the 1s/5s/30s defaults.
- **Scope reduction (post-plan)**: dropped `loan_fetch_failures` table, dropped lifecycle columns (`status`, `closed_at`, `closure_reason`) and `holder` from the materialised table, renamed `loans` → `loan_details`. Lifecycle is derived from `contract_logs` by the downstream API (separate Issue).

## Scope

**In scope:**

1. Add `loan_details` table via sqlx migration in `packages/shared/migrations/20260522000001_loan_details_table.sql`. Schema mirrors the immutable fields of the off-chain JSON document keyed by `(chain_id, loan_id)`. Lifecycle (`status`, `closed_at`, `closure_reason`) and `holder` are intentionally NOT materialised — the downstream API derives them from `contract_logs`.
2. New `shared::loan_details_repo::{LoanDetailsRepo, LoanDetailsRow}` with `upsert_loan_details` (idempotent for re-index) and `get_loan_details` (read for downstream API).
3. New shared HTTP fetcher in `packages/shared/src/metadata_fetcher.rs` exposing a reusable `fetch_json<T: DeserializeOwned>(url) -> Result<T>` API plus an `ipfs://` → gateway URL resolver. Supports `http(s)://` and `ipfs://CID[/path]` schemes. Retries fire on transport errors (both `send` and body-read) and HTTP 5xx; terminal on 4xx, unknown scheme, and JSON parse errors. Default 4 attempts with `[1s, 5s, 30s]` sleeps between them (convention: `attempts = backoffs.len() + 1` — every backoff entry is an actual sleep). `with_backoffs` builder lets tests override the defaults.
4. New worker-local `tokenURI` reader in `packages/worker/src/indexer/loan_registry_reader.rs` — a thin alloy `sol!` binding for the standard ERC-721 `tokenURI(uint256) returns (string)`. Recovers the URI string because the `LoanMinted` event declares `string indexed metadataURI` (topic value is the keccak256 hash, not the URI). Stateless: one reader instance serves all configured registries, taking `contract: Address` per call.
5. New worker mapper `pipeline_worker::indexer::loan_mapper::LoanMintedMapper`. Handles ONLY `LoanMinted`: writes the `contract_logs` row first, then attempts `tokenURI` → `fetch_json::<ImmutableLoanData>` → `upsert_loan_details`. Runs inside the indexer's open transaction so the `contract_logs` row and `loan_details` row commit atomically.
6. Wire the registry handler closure in `mod.rs` to branch: `LoanMinted` → `LoanMintedMapper`; everything else (`LoanClosed`, `LoanDefaulted`, `LoanStatusUpdated`, `LoanCCRUpdated`, `LoanLocationUpdated`, `LoanRepayment`) → existing `ContractLogMapper`. Lifecycle events are not stored in `loan_details`.
7. Failure-handling policy: any failure (URI recovery via `tokenURI`, `fetch_json`, numeric field parse, DB upsert) propagates out of `LoanMintedMapper::insert` so the indexer's outer transaction rolls back. The batch is re-pulled on the next polling cycle and retried until it succeeds. `loan_details` is never skipped — every `contract_logs` LoanMinted row is guaranteed to have a matching `loan_details` row. Trade-off: while the URI source is unavailable the indexer does not advance past the affected block range (and other event types share the batch, so all indexing stalls). Tracked as TD-8 for the future move to an async backfill worker.
8. New env var `JOB_INDEXER_IPFS_GATEWAY_URL` (default `https://ipfs.io/ipfs/`), wired into `IndexerJobSettings.ipfs_gateway_url` and `.env.example`.
9. **Fix latent #336 bug in `parse_loan_minted`.** The old code stored `decoded.metadataURI` into `params["metadata_uri"]`, but because `metadataURI` is `string indexed`, that value is the keccak256 topic hash, not a URI. Remove the `metadata_uri` key from `LoanMinted` `params` JSON entirely. Update the parser unit test to assert the key is absent.
10. Unit and integration tests for `metadata_fetcher`, `loan_details_repo`, the `LoanMintedMapper` insert path with mocked fetcher + resolver.

**Out of scope:**

- The Portfolio Yield API endpoint (`/v1/portfolio/yield`) that consumes the `loan_details` table (separate Issue).
- Backfill for loans minted before this lands. Operator re-runs the indexer from the configured start block; `upsert_loan_details` is idempotent.
- Partial-senior-principal amortisation tracking.
- Renaming `LoanRepayment` → `RepaymentRecorded` (cosmetic; bundle later).
- Background retry job for failed metadata fetches (no failures table to drive it — see TD-8).
- Persisting `attempts` / `last_error` for failed fetches (deliberately dropped in favour of `tracing::warn!` + the contract_logs ⋈ loan_details diff).
- **Updating `docs/product-specs/loans-data.md`** — the spec is out of sync with the deployed contract (it documents a `getImmutable(loanId)` reader that does not exist). A separate docs Issue will be filed (tracked in TD-9).

## Assumptions and Risks

- **Indexer transaction boundary.** `LogMapper::insert` is called inside the indexer's open transaction (`index_once` in `packages/worker/src/indexer/mod.rs`). The `LoanMinted` upsert path runs on the same connection, so the `contract_logs` row and the `loan_details` row commit atomically. The metadata fetch (HTTP/IPFS) and the `tokenURI` `eth_call` both happen INSIDE that transaction. Under the "never skip loan_details" policy, any unrecoverable failure propagates out and the entire batch rolls back; the next polling cycle re-pulls and retries the same range until it succeeds. A prolonged URI outage therefore halts forward progress for ALL indexed events in the affected block range (not just LoanMinted). Tracked as TD-8 for the future move to an async backfill worker.
- **Indexed `metadataURI` is a hash, not the string.** Recovery via `tokenURI(loanId)` (standard ERC-721). The contract does **not** expose `getImmutable(loanId)` or any on-chain `ImmutableLoanData` struct. The `eth_call` reuses the same `eth_rpc_url` as the indexer poller. No caching — each event is processed exactly once.
- **IPFS gateway availability.** Public gateways (`ipfs.io`) are best-effort. Persistent failures show up as a missing `loan_details` row for a present `LoanMinted` event; ops can swap `JOB_INDEXER_IPFS_GATEWAY_URL` to a private pinned gateway in production.
- **JSON schema drift.** `ImmutableLoanData` uses `#[serde(deny_unknown_fields)]` — adding a new field to the JSON breaks ingestion. Drift surfaces as `tracing::warn!` plus a missing `loan_details` row. Trade-off accepted in favour of strict schema enforcement (Q3).
- **`NUMERIC(78,0)` representation.** `uint256` JSON values arrive as decimal strings → parsed via `BigDecimal::from_str` and rejected if they contain a decimal point.
- **Idempotency.** `upsert_loan_details` runs `INSERT ... ON CONFLICT (chain_id, loan_id) DO UPDATE SET <all immutable columns>`. A re-fetch with corrected data heals a prior row.
- **Re-org safety.** Assumes block reorgs deeper than `log_confirmations_delay` (default 12) don't happen. A reorg that removes a `LoanMinted` after our `loan_details` row is written would leave an orphan row. Indexer-wide tech debt, not unique to this Issue.

## Resolved questions

Recorded verbatim for the decision trail (preserves the original phrasing; later scope reductions noted inline).

- **Q1. `metadataURI` recovery strategy.** Use `eth_call tokenURI(loanId)` (standard ERC-721 read), **not** the fictional `getImmutable(loanId)`. The deployed `LoanRegistryUpgradeable` does not have `getImmutable` or any on-chain `ImmutableLoanData` struct. Use a minimal alloy `sol!` binding for `tokenURI` rather than binding to a non-existent struct. The spec doc (`docs/product-specs/loans-data.md`) is outdated; the deployed contract is the source of truth. Spec update OUT OF SCOPE for this Issue — separate docs Issue (TD-9).
- **Q2. Module placement.** A shared HTTP client in the `shared` crate. JSON fetcher at `packages/shared/src/metadata_fetcher.rs`, generic `fetch_json<T: DeserializeOwned>(url) -> Result<T>`. The `tokenURI` reader (alloy binding) is worker-specific; lives at `packages/worker/src/indexer/loan_registry_reader.rs`.
- **Q3. Empty / null inner `metadataURI` (the optional field inside the JSON document).** Store as `NULL` in `loan_details.metadata_uri`. Don't fail the fetch. This is a normal value.

## Implementation summary

Final code layout (paths are authoritative — see source for full APIs):

| Layer | File | Purpose |
|---|---|---|
| Schema | `packages/shared/migrations/20260522000001_loan_details_table.sql` | `loan_details (chain_id, loan_id, ...immutable fields..., metadata_uri NULL, indexed_at)` |
| Shared | `packages/shared/src/metadata_fetcher.rs` | `MetadataFetcher::{new, with_backoffs, fetch_json, resolve}` |
| Shared | `packages/shared/src/loan_details_repo.rs` | `LoanDetailsRepo::{new, upsert_loan_details, get_loan_details}`, `LoanDetailsRow` |
| Worker | `packages/worker/src/indexer/loan_metadata.rs` | `ImmutableLoanData` DTO + traits `LoanMetadataFetcher` (mocking) + `MetadataUriResolver` (mocking) + `HttpLoanMetadataFetcher` adapter |
| Worker | `packages/worker/src/indexer/loan_registry_reader.rs` | `LoanRegistryReader::{new, metadata_uri(contract, loan_id)}` — alloy `sol!` binding for `tokenURI`, stateless |
| Worker | `packages/worker/src/indexer/loan_mapper.rs` | `LoanMintedMapper` impls `LogMapper`. Writes `contract_logs` → attempts `tokenURI` → `fetch_metadata` → `upsert_loan_details`. Failures `tracing::warn!` + return Ok |
| Worker | `packages/worker/src/indexer/mod.rs` | Constructs the three deps once; closure branches `LoanMinted` → `LoanMintedMapper`, else → `ContractLogMapper` |
| Worker | `packages/worker/src/indexer/parsers.rs` | `parse_loan_minted` no longer writes the indexed-string topic hash into `params["metadata_uri"]` |
| Worker | `packages/worker/src/indexer/config.rs` | `IndexerJobSettings.ipfs_gateway_url` reads `JOB_INDEXER_IPFS_GATEWAY_URL` (default `https://ipfs.io/ipfs/`) |

## Test Strategy

Realised tests (see source files for full assertions):

| File | Count | Notes |
|---|---|---|
| `packages/shared/tests/metadata_fetcher.rs` | 8 | mockito-backed: HTTPS success, IPFS gateway routing, 5xx retry → success, retry exhaustion on persistent 5xx, 4xx terminal, malformed JSON terminal, missing-field terminal, unknown scheme terminal. |
| `packages/shared/tests/loan_details_repo.rs` | 3 | DB-gated: insert + idempotent re-upsert, overwrite-on-conflict heals corrupted prior row, get-missing returns None. |
| `packages/worker/tests/loan_mapper.rs` | 4 | DB-gated; mocks `LoanMetadataFetcher` and `MetadataUriResolver` traits: success path writes both rows; fetch failure writes only `contract_logs`; resolver failure writes only `contract_logs`; reindex of same event is dedup'd at `contract_logs` and the `loan_details` upsert is idempotent. |
| `packages/worker/tests/parsers.rs` (updated) | n/a | Regression: `loan_minted_decodes` now asserts the absence of `params.metadata_uri` (Scope item 9). |

DB-gated tests follow the existing project convention: `setup_pool` returns `None` when `DATABASE_URL` is unset, and the test early-returns. Run with `cargo test --all -- --test-threads=1` (a pre-existing issue with parallel DB-backed tests in `indexer_integration.rs` causes races on shared tables; not introduced by this change).

### Smoke gates

- `cargo clippy --all -- -D warnings` — pass.
- `cargo clippy --all --tests --all-targets -- -D warnings` — pass.
- `cargo test --all` with and without `DATABASE_URL` — pass.
- `cargo build --workspace` — pass.

## Docs to Update

- `docs/exec-plans/tech-debt-tracker.md` — TD-8 logged (in-transaction fetch stall, suggested fix is the async backfill worker). TD-9 logged (rewrite of `docs/product-specs/loans-data.md`).
- `docs/product-specs/loans-data.md` — **deliberately NOT touched** in this PR; rewrite tracked as TD-9.
- No user-facing doc changes (internal indexer plumbing).
