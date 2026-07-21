# Issue #886: Validate metadata_uri on loan submission: fetch and parse as LoanMetadataJson

Source: https://github.com/eq-lab/pipeline/issues/886

## Scope

Add a validation step to `submit_loan` (`POST /v1/loan-book/loan`, `packages/api/src/routes/loan_book.rs`)
that **downloads the document at `SubmitLoanRequest.metadata_uri` and confirms it deserialises
into `LoanMetadataJson`** — the exact type the indexer parses (`packages/worker/src/indexer/loan_metadata.rs`).
The check fails a submission at HTTP-request time if its on-chain metadata pointer would not parse
during indexing, instead of surfacing the failure after the loan is drawn.

**Decisions carried in from the issue (see issue comment):**

- **Type sharing:** move `LoanMetadataJson` into `shared` so worker and API depend on the *same* type
  (the only way the submission check truly matches indexing).
- **Error mapping:** any fetch/parse failure → **`400 Bad Request`** (`ApiError::BadRequest`). Do **not**
  split 4xx/5xx into 502.
- **Validation scope:** **parseability only** — verify the URI resolves to a document that deserialises
  as `LoanMetadataJson`. Do **not** cross-check the fetched document's fields against the inline
  `SubmitLoanRequest` fields (possible follow-up).

**In scope**

- Move `LoanMetadataJson` + the `LoanMetadataFetcher` trait + `HttpLoanMetadataFetcher` into a new
  `shared::loan_metadata` module; re-export from the worker so existing worker imports keep compiling.
- Add a `MetadataFetcher`-backed metadata fetch to the API's `AppState` (with an IPFS-gateway config).
- Add the async fetch+parse validation to the `submit_loan` handler, after `validate_submission` and
  before persistence, mapping failures to `400`.
- Unit tests using a mock `LoanMetadataFetcher`.

**Out of scope**

- Any consistency check between inline `SubmitLoanRequest` fields and the fetched document.
- Changing the indexer's own fetch/parse path (behaviour is unchanged; only the type's location moves).
- Any change to `validate_submission`'s existing pure invariants (they stay as-is).

## Assumptions and Risks

- **`validate_submission` must stay pure/no-I/O.** It is unit-tested as a pure function and documented as
  such. The network fetch is added as a *separate* async step in the handler — not inside
  `validate_submission`.
- **API crate gains a `reqwest` dependency.** `MetadataFetcher::new` takes a `reqwest::Client`. `reqwest`
  is already a workspace dependency (used by `worker`); adding `reqwest = { workspace = true }` to
  `packages/api/Cargo.toml` is low-risk.
- **Latency / DoS surface.** `POST /v1/loan-book/loan` becomes network-bound: `MetadataFetcher`'s default
  retry schedule is `[1s, 5s, 30s]` ≈ 36 s worst-case. That is acceptable for an authenticated
  `originator`-only endpoint, but the handler should construct the fetcher with a **shortened backoff**
  (e.g. `with_backoffs(vec![])` → single attempt, or one short retry) so a dead URI does not hang the
  request for 36 s. Chosen: single attempt (`with_backoffs(vec![])`) — the submitter can retry. Noted as
  a tunable.
- **External network dependency in a write path.** An IPFS-gateway outage now blocks submissions. Accepted
  per the issue decision (fail-fast is the point); mapped to `400` per decision. Logged as the tradeoff.
- **Moving `LoanMetadataJson` touches worker imports.** `LoanMetadataJson`, `LoanMetadataFetcher`,
  `HttpLoanMetadataFetcher` are referenced in `worker/src/indexer/{mod.rs, loan_mapper.rs,
  stellar/poller.rs}` and `worker/tests/loan_mapper.rs`. Re-exporting the moved items from
  `worker::indexer::loan_metadata` keeps those import paths working (verify with a worker build).
- `LoanMetadataJson` is `#[serde(deny_unknown_fields)]` and depends only on `shared::loan_snapshot::LoanDocument`
  (already in `shared`) — so the move has no new cross-crate dependency.

## Open Questions

_None._ (The three original open questions were resolved by the user before planning — see the issue comment: move type to `shared`, always `400`, parseability-only.)

## Implementation Steps

_All steps complete (implemented on `feat/886-validate-metadata-uri`)._

1. ✅ **Create `packages/shared/src/loan_metadata.rs`.** Move from `packages/worker/src/indexer/loan_metadata.rs`:
   - the `LoanMetadataJson` struct (with its serde attributes and the `use shared::loan_snapshot::LoanDocument`
     import rewritten as `use crate::loan_snapshot::LoanDocument`),
   - the `LoanMetadataFetcher` trait,
   - the `HttpLoanMetadataFetcher` struct + impl (uses `crate::metadata_fetcher::MetadataFetcher`).
   Register the module in `packages/shared/src/lib.rs` (`pub mod loan_metadata;`). Keep `async_trait` available
   (add to shared `Cargo.toml` if not already a dep).

2. ✅ **Trim the worker's `loan_metadata.rs` and re-export.** Delete the moved definitions from
   `packages/worker/src/indexer/loan_metadata.rs`; add
   `pub use shared::loan_metadata::{HttpLoanMetadataFetcher, LoanMetadataFetcher, LoanMetadataJson};`
   near the top so every existing `crate::indexer::loan_metadata::{...}` import (in `mod.rs`,
   `loan_mapper.rs`, `stellar/poller.rs`, `tests/loan_mapper.rs`) continues to resolve. The indexer-specific
   items (`LoanAddress`, `LoanId`, `BlockHint`, resolver traits, `*View` structs) stay in the worker.

3. ✅ **Add `reqwest` to the API crate.** In `packages/api/Cargo.toml` add `reqwest = { workspace = true }`.

4. ✅ **Add IPFS-gateway config to the API.** In `packages/api/src/config.rs` read
   `IPFS_GATEWAY_URL` (env), defaulting to `"https://ipfs.io/ipfs/"` (mirrors the worker's default). Expose
   it however the surrounding config code is structured (a small `pub fn ipfs_gateway_url_from_env() -> String`
   or a field on an existing config struct — match the file's existing pattern).

5. ✅ **Add the fetcher to `AppState`.** In `packages/api/src/lib.rs` add a field
   `pub loan_metadata_fetcher: Arc<dyn shared::loan_metadata::LoanMetadataFetcher>,` (trait object so tests
   can inject a mock and the handler stays decoupled). In `packages/api/src/main.rs`, construct it:
   `Arc::new(HttpLoanMetadataFetcher::new(MetadataFetcher::new(reqwest::Client::new(), ipfs_gateway_url).with_backoffs(vec![])))`
   and pass it into the `AppState { .. }` initialiser.

6. ✅ **Add a pure error-mapping helper in `loan_book.rs`.** Introduce
   `async fn validate_metadata_uri(fetcher: &dyn LoanMetadataFetcher, uri: &str) -> Result<(), String>`
   that calls `fetcher.fetch_metadata(uri).await` and maps any `Err` to a user-facing string
   (e.g. `format!("metadata_uri did not resolve to a valid loan-metadata document: {e}")`). Keep it `pub`
   so the unit test can exercise it with a mock fetcher (mirrors the `validate_submission` testability
   convention). Do **not** fold this into `validate_submission` (which stays pure/no-I/O).

7. ✅ **Wire it into `submit_loan`.** After the existing `validate_submission(&payload).map_err(ApiError::BadRequest)?;`
   line, add:
   `validate_metadata_uri(state.loan_metadata_fetcher.as_ref(), &payload.metadata_uri).await.map_err(ApiError::BadRequest)?;`
   (before serialising/persisting). This runs the structural checks first (cheap), then the network fetch.

8. ✅ **Clippy + build.** Run `cargo clippy --all -- -D warnings` and build both `api` and `worker`
   (`cargo build -p pipeline-api -p worker`) to confirm the type move and re-exports compile everywhere.

## Test Strategy

Add tests in `packages/api/tests/loan_submission.rs` (extend the existing file; pure, no HTTP/DB — per the
project convention that tests live in `tests/` and use no live Postgres):

- A local `struct MockFetcher { result: ... }` implementing `shared::loan_metadata::LoanMetadataFetcher`
  (mirrors `worker/tests/loan_mapper.rs`'s `MockMetadataFetcher` / `FailingFetcher`): one variant returns
  `Ok(LoanMetadataJson { .. })`, one returns `Err(anyhow!( .. ))`.
- `validate_metadata_uri` returns `Ok` when the fetcher yields a valid `LoanMetadataJson`.
- `validate_metadata_uri` returns `Err` (non-empty message) when the fetcher errors (simulating a 404 /
  unparseable / unknown-field document).
- Confirm the existing `validate_submission` tests still pass unchanged (it remains pure).
- Optionally: a serde round-trip test asserting a representative JSON document (matching the indexer's
  expected shape, including `deny_unknown_fields`) deserialises into the moved `shared::loan_metadata::LoanMetadataJson`,
  and that an unknown extra field is rejected — locking the shared type to the indexer contract.

Also confirm the moved type keeps the worker green: `cargo test -p worker` (exercises
`worker/tests/loan_mapper.rs`, which uses the re-exported `LoanMetadataJson` / `LoanMetadataFetcher`).

## Docs to Update

- `docs/product-specs/loans.md` → **"Origination request submission (off-chain)"** section: add one line
  noting that on submission the service fetches `metadata_uri` and rejects the request (`400`) if the
  document does not parse into the canonical loan-metadata shape used at indexing.
- No design-doc change required (no architectural boundary change — the type simply moves into `shared`,
  the canonical home for cross-crate DTOs).
- On completion, move this plan to `docs/exec-plans/completed/` (manager step).
