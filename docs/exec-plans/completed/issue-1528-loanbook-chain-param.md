# Issue #1528: LoanBook API: chain parameter foundation (configured chain list, optional/required chain extractors, 400 on unknown chain)

Source: https://github.com/eq-lab/pipeline/issues/1528

Parent epic: #1521 (LoanBook API — multi-chain). The epic's "Decisions (human, 2026-10-15)"
section is authoritative. This issue blocks #1529, #1530 and #1531.

No Figma reference. Backend only, so there is no visual verification step.

## Scope

### In scope

1. **Configured chain list on `AppState`.** Add a `ConfiguredChain { chain_id, kind }` value type.
   `ChainsConfig::from_env` already parses each chain's `ChainKind` in its loop. It now also
   records the chain in `ChainsConfig::chains: Vec<ConfiguredChain>`, in `CHAINS` order.
   `AppState` gets `pub chains: Vec<ConfiguredChain>`. `default_chain_id` stays.
2. **Two new extractors in `packages/api/src/routes/common.rs`**, next to `ChainQuery` /
   `resolve_chain`, which do not change:
   - `ChainFilter(pub Option<ConfiguredChain>)`: optional `chain_id` query param.
     `None` means all configured chains. `Some` is a validated member of `CHAINS`.
   - `RequiredChain(pub ConfiguredChain)`: required `chain_id` query param. Returns 400 when
     it is missing.
   - Both return 400 for an unknown or malformed `chain_id`.
3. **A pure parsing core** shared by both extractors, so the behavior can be unit-tested with
   no `AppState`, router or DB.
4. **OpenAPI.** Implement `utoipa::IntoParams` by hand on both extractors, so a handler can
   write `params(ChainFilter)` / `params(RequiredChain)` and get a correct `chain_id` query
   parameter with the right `required` flag and description.
5. **Unit tests** (pure, no DB) in `packages/api/tests/chain_param.rs`, plus one
   config test in `packages/api/tests/chains_config.rs`.

### Out of scope

- Migrating any LoanBook endpoint to the new extractors. That work belongs to #1529
  (submissions), #1530 (`GET /v1/loan-book`) and #1531 (per-loan endpoints). After this
  issue, no handler uses `ChainFilter` / `RequiredChain` yet. Existing behavior stays
  byte-for-byte the same, except for the duplicate-`CHAINS` startup check (see Resolved decisions).
- Any change to `ChainQuery`, `resolve_chain`, or `trustee_indexed_loan_guard`. #1531 will
  change the guard's signature to take a resolved `chain_id: i64` instead of `&ChainQuery`.
- Moving `/{loan_id}/transfers` to the `LoanBook` tag (#1531).
- Replacing per-request `parse_chain_type` env reads elsewhere (kyc, vouchers, audit_log,
  `contract_logs_repo`). Adopters may use `ConfiguredChain::kind` instead, but this issue
  does not touch those modules.

## Assumptions and Risks

- **Error body convention.** Every API error is `ApiError` → `{"error": "<message>"}` with
  the status code (`packages/api/src/error.rs`). Both extractors use
  `type Rejection = ApiError` and return `ApiError::BadRequest(..)`, so the 400 body is
  `{"error": "..."}`, like every other 400 in the API. The error is not a separate
  machine-readable code. No existing 400 carries one (the only coded body is
  `{"error":"account_suspended"}`, a 403 sentinel), and the issue asks only for "a clear message".
- **Exact 400 messages** (tests pin these strings, so adopters and the frontend can rely on them):
  - missing (`RequiredChain` only): `chain_id is required`
  - not an integer, or empty (`chain_id=`, `chain_id=abc`): `invalid chain_id: <raw>`
  - integer not in `CHAINS`: `unknown chain_id: <id> (configured: <id1>, <id2>, ...)`.
    The configured list is in `CHAINS` order. Chain ids are public deployment facts, not secrets.
  - query string that cannot be decoded (for example a repeated `chain_id=1&chain_id=2`):
    `invalid chain_id: must appear at most once`. Any other `QueryRejection` from the
    `chain_id`-only struct maps to the same `invalid chain_id: ...` prefix with the rejection's
    `body_text()`.
  - The raw value is trimmed before parsing, which matches how `trustee_indexed_loan_guard`
    trims `loan_id`.
- **This is not the same as today's `Query<ChainQuery>` failure mode.** Today, a non-integer
  `chain_id` makes axum's default `QueryRejection` return a plain-text 400. The new extractors
  return JSON. This is intended, and it only applies to adopters.
- **Coexisting with other `Query<T>` extractors.** The extractors read only `chain_id` from
  `parts.uri` through a private `#[derive(Deserialize)] struct RawChainParam { chain_id: Option<String> }`.
  serde ignores unknown keys, and no LoanBook query struct uses `deny_unknown_fields`, so
  a handler can take `Query<SubmissionsQuery>` and `ChainFilter` side by side. Adopters
  (#1531, `CcrHistoryQuery` / `WaterfallQuery`) should remove the now-redundant
  `chain_id: Option<i64>` field from their own query structs, so there is one source of truth.
  Leaving it in place causes no runtime conflict, but if the field stays `i64`, a non-integer
  value would fail in their `Query<T>` first with the old plain-text 400.
- **Duplicate ids in `CHAINS`.** `parse_chains_env` (shared with the worker) does not
  deduplicate. With `CHAINS=1,1`, an "all chains" union would count chain 1 twice. Per the
  resolved decision, the API rejects duplicates at startup.
- **Concurrent change from #1526.** #1526 adds a required per-chain
  `CHAIN_<id>_{EVM,STELLAR}_API_LOAN_REGISTRY_ADDRESS` map to `ChainsConfig` / `AppState`.
  Expect conflicts on adjacent lines in `ChainsConfig`, `ChainsConfig::from_env`, the
  `AppState` struct, `main.rs`, and `tests/voucher_signing.rs::make_test_state`. Resolve them
  by keeping both fields. `ConfiguredChain` / `chains` stay independent of the registry map:
  do not merge the address into `ConfiguredChain`. If #1526 merges first, the
  `chains_config.rs` tests in this issue must also set that required env var for each chain.
- **`AppState` construction sites.** The only construction sites are
  `packages/api/src/main.rs` and `packages/api/tests/voucher_signing.rs::make_test_state`.
  Both must set the new field, or the build breaks.
- Dependency order: no open blockers. #1529, #1530 and #1531 depend on this issue.

## Resolved decisions (human, 2026-10-15)

- Duplicate chain ids in `CHAINS` make API startup fail. `ChainsConfig::from_env` bails with
  `CHAINS contains duplicate chain id <id>`. This is API-only: shared `parse_chains_env` and
  the worker are unchanged.

## Open Questions

_None_

## Implementation Steps

1. **`ConfiguredChain` + `ChainsConfig::chains`** in `packages/api/src/config.rs`:
   - Add `#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub struct ConfiguredChain { pub chain_id: i64, pub kind: ChainKind }`.
   - Add `pub chains: Vec<ConfiguredChain>` to `ChainsConfig`.
   - In `ChainsConfig::from_env`, right after `parse_chains_env()`, reject duplicates with
     `anyhow::bail!("CHAINS contains duplicate chain id {id}")` (resolved decision).
   - In the existing `for &chain_id in &chains` loop, push
     `ConfiguredChain { chain_id, kind: chain_kind }` after `parse_chain_type` +
     `validate_chain_kind_keys`, then return it in `Self { .. }`.
2. **`AppState::chains`** in `packages/api/src/lib.rs`: add `pub chains: Vec<crate::config::ConfiguredChain>`
   next to `default_chain_id`. Following AGENTS.md "comment-less code", add no new doc
   comments.
3. **Wire it** in `packages/api/src/main.rs`: `chains: chains_config.chains,` in the
   `AppState { .. }` literal. `chains_config` is already split up field by field there, so
   move `chains` out the same way.
4. **Fix the test `AppState` builder** in `packages/api/tests/voucher_signing.rs`:
   `chains: vec![ConfiguredChain { chain_id, kind: ChainKind::Evm }]`.
5. **Pure parsing core** in `packages/api/src/routes/common.rs` (public, so tests can call it):
   ```rust
   pub fn parse_chain_filter(uri: &Uri, chains: &[ConfiguredChain]) -> Result<Option<ConfiguredChain>, ApiError>;
   pub fn parse_required_chain(uri: &Uri, chains: &[ConfiguredChain]) -> Result<ConfiguredChain, ApiError>;
   ```
   - `parse_chain_filter`: `axum::extract::Query::<RawChainParam>::try_from_uri(uri)`, then
     map the rejection to a 400 (see the messages in Assumptions). `None` → `Ok(None)`.
     `Some(raw)` → trim, `i64::from_str` (failure → `invalid chain_id: <raw>`), then look the
     id up in `chains` (absent → `unknown chain_id: ...`).
   - `parse_required_chain`: `parse_chain_filter(..)?.ok_or_else(|| ApiError::BadRequest("chain_id is required".into()))`.
6. **Extractors** in the same file:
   ```rust
   pub struct ChainFilter(pub Option<ConfiguredChain>);
   pub struct RequiredChain(pub ConfiguredChain);

   impl FromRequestParts<Arc<AppState>> for ChainFilter {
       type Rejection = ApiError;
       async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> Result<Self, ApiError> {
           parse_chain_filter(&parts.uri, &state.chains).map(Self)
       }
   }
   // RequiredChain: same, via parse_required_chain.

   impl ChainFilter {
       pub fn chain_id(&self) -> Option<i64>;
       pub fn resolve<'a>(&'a self, all: &'a [ConfiguredChain]) -> &'a [ConfiguredChain];
   }
   ```
   `resolve` returns `std::slice::from_ref(c)` for `Some(c)`, and `all` for `None`. List
   endpoints iterate over this slice, so "omitted = all configured chains" lives in one place.
   Follow the axum 0.8 `FromRequestParts` style already used by `AuthClaims` in
   `packages/api/src/auth.rs`.
7. **OpenAPI `IntoParams`** in the same file: implement `utoipa::IntoParams` by hand for
   `ChainFilter` and `RequiredChain`. Each returns one `Parameter` built with
   `utoipa::openapi::path::ParameterBuilder`: name `chain_id`, `ParameterIn::Query`,
   integer/int64 schema, `Required::False` / `Required::True`, and these descriptions:
   - `ChainFilter`: `"Chain ID to filter by. Optional — omit for all configured chains (CHAINS). An id not in CHAINS → 400."`
   - `RequiredChain`: `"Chain ID the loan lives on. Required — loan_id is only unique within a chain. Missing, malformed, or not in CHAINS → 400."`
8. **Intended call-site patterns for the adopting issues.** Do not implement these here. The
   coder should check that the API supports them as written:
   ```rust
   // #1530 — GET /v1/loan-book (optional, omitted = all chains)
   #[utoipa::path(get, path = "/v1/loan-book", params(ChainFilter), responses(..., (status = 400, description = "Unknown or malformed chain_id")), tag = "LoanBook")]
   async fn get_loan_book(State(state): State<Arc<AppState>>, chain: ChainFilter) -> Result<Json<LoanBookResponse>, ApiError> {
       handle_loan_book(&state, chain.resolve(&state.chains)).await.map(Json)
   }

   // #1529 — GET /v1/loan-book/submissions (optional filter by target chain, alongside another Query)
   async fn list_submissions(AuthClaims(claims): AuthClaims, State(state): State<Arc<AppState>>,
                             chain: ChainFilter, Query(q): Query<SubmissionsQuery>) -> ... {
       repo.list(q.status, chain.chain_id()) // None = no chain predicate
   }

   // #1531 — per-loan GET / writes (required)
   #[utoipa::path(get, path = "/v1/loan-book/{loan_id}/financials",
                  params(("loan_id" = String, Path, ...), RequiredChain), ...)]
   async fn get_financials(State(state): State<Arc<AppState>>, Path(loan_id): Path<String>,
                           RequiredChain(chain): RequiredChain) -> ... {
       // chain.chain_id, chain.kind
   }
   ```
   Handlers must list `ChainFilter` / `RequiredChain` before any body extractor (`Json<T>`),
   as axum requires for `FromRequestParts` extractors.
9. **Lint:** `cargo clippy --all -- -D warnings`, `cargo fmt --all --check`.

## Test Strategy

All tests are pure: no DB, no `DATABASE_URL` / `POSTGRES_URL`, no inline `#[cfg(test)]`.

**New file `packages/api/tests/chain_param.rs`.** It calls `parse_chain_filter` /
`parse_required_chain` with `Uri::from_static(..)` and a fixture
`[ConfiguredChain{1, Evm}, ConfiguredChain{99000001, Stellar}]`:

- filter: no query string → `Ok(None)`; `?other=x` → `Ok(None)`.
- filter: `?chain_id=1` → `Some(chain 1, Evm)`; `?chain_id=99000001` → `Some(.., Stellar)` (kind carried through).
- filter: `?chain_id=%201%20` → trimmed → `Some(chain 1)`.
- filter: `?chain_id=5` → 400, `unknown chain_id: 5 (configured: 1, 99000001)`.
- filter: `?chain_id=abc` and `?chain_id=` → 400, `invalid chain_id: ...`.
- filter: `?chain_id=1&chain_id=2` → 400 with the `invalid chain_id` prefix.
- filter: `?chain_id=1&status=InReview` → `Some(chain 1)` (coexists with other params).
- required: no `chain_id` → 400 `chain_id is required`; valid → the chain; unknown → the same
  message as the filter.
- Error shape: convert an `Err` with `ApiError::into_response()`, then assert status `400`
  and that the body parses as JSON `{"error": "<exact message>"}`. Reading the body uses
  `axum::body::to_bytes`, which needs a `#[tokio::test]`. That already works in this
  package's tests.
- `ChainFilter::resolve`: `Some` → a one-element slice; `None` → the full fixture slice, in order.
  `chain_id()` mirrors that.
- OpenAPI: `serde_json::to_value(ChainFilter::into_params(|| None))` → one param, `name ==
  "chain_id"`, `in == "query"`, `required == false`, integer schema. For `RequiredChain`,
  `required == true`.

The `FromRequestParts` impls are one-line delegations to the pure functions, so a
full-router test is not required. That would mean copying the 100-line `AppState` builder
from `voucher_signing.rs`.

**`packages/api/tests/chains_config.rs`** (existing env-mutating config tests under
`ENV_LOCK`; no DB):

- `CHAINS=1,2`, `DEFAULT_CHAIN_ID=1`, no signer keys → `cfg.chains ==
  [ConfiguredChain{1, Evm}, ConfiguredChain{2, Evm}]`.
- `CHAINS=1,1` → `from_env()` is `Err` and the message contains `duplicate`.

**Existing suites:** `voucher_signing.rs` must still compile and pass with the new field.
Run `cargo test -p pipeline-api` and `cargo clippy --all -- -D warnings`.

## Docs to Update

- None required for this issue. It adds internal building blocks and changes no
  endpoint's behavior.
- `ARCHITECTURE.md` (the "Per-chain task model" paragraph: "The API resolves chain by an
  optional `chain_id` query parameter on every route, falling back to `DEFAULT_CHAIN_ID`")
  becomes inaccurate once LoanBook endpoints adopt the extractors. That sentence and
  `docs/product-specs/api-authorization.md` endpoint rows are updated by the adopting issues
  (#1529, #1530, #1531), not here, so the docs never describe behavior that has not shipped.
- Add one line to the `ChainsConfig` env
  doc block in `packages/api/src/config.rs` (`CHAINS=... # ...; ids must be unique`).
