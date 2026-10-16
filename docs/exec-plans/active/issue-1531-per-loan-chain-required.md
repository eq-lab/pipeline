# Issue #1531: LoanBook API: per-loan endpoints require chain_id

Source: https://github.com/eq-lab/pipeline/issues/1531

Parent epic: #1521 (LoanBook API — multi-chain). The epic's "Decisions (human, 2026-10-15)"
section is authoritative. Backend-only; no Figma reference, so there is no visual verification
step.

Dependencies, all merged on `main` (2c323ccb): #1528 (`RequiredChain` / `ChainFilter` in
`packages/api/src/routes/common.rs`, `AppState.chains`), and epic #1520, including #1526
(`loan_registry_address`, `trustee_indexed_loan_guard`, registry-scoped repo methods). Siblings
running in parallel: #1529 (submissions target chain) and #1530 (`GET /v1/loan-book` across all
chains).

## Scope

### In scope

Nine operations move from `Query<ChainQuery>` + `resolve_chain` (silent `DEFAULT_CHAIN_ID`
fallback) to the `RequiredChain` extractor. A missing, malformed, or unknown `chain_id` now
returns a JSON 400:

| Operation | File | Auth |
|---|---|---|
| `GET /v1/loan-book/{loan_id}/financials` | `packages/api/src/routes/loan_financials.rs` | public |
| `GET /v1/loan-book/{loan_id}/valuations` | `packages/api/src/routes/collateral_valuation.rs` | public |
| `GET /v1/loan-book/{loan_id}/ccr-history` | `packages/api/src/routes/ccr_history.rs` | public |
| `GET /v1/loan-book/{loan_id}/waterfall` | `packages/api/src/routes/waterfall.rs` | public |
| `GET /v1/loan-book/{loan_id}/transfers` | `packages/api/src/routes/loan_transfers.rs` | trustee |
| `POST /v1/loan-book/{loan_id}/transfers` | `packages/api/src/routes/loan_transfers.rs` | trustee |
| `POST /v1/loan-book/{loan_id}/assay` | `packages/api/src/routes/collateral_valuation.rs` | trustee |
| `POST /v1/loan-book/{loan_id}/offtake` | `packages/api/src/routes/collateral_valuation.rs` | trustee |
| `POST /v1/loan-book/{loan_id}/disbursement/complete` | `packages/api/src/routes/loan_book.rs` | trustee |

Changes that go with the extractor switch:

- Remove the per-endpoint `chain_id: Option<i64>` fields from `CcrHistoryQuery` and
  `WaterfallQuery`. Their other params (`from`/`to`/`step`, `amount`/`as_of`) keep working,
  extracted next to `RequiredChain`.
- `trustee_indexed_loan_guard` takes an already-resolved chain instead of `&ChainQuery`. Its
  pure pre-checks are split out so they can be unit-tested.
- Add `chain_id: i64` to `LoanFinancialsResponse`, `WaterfallResponse`, and
  `LoanTransfersResponse`. `CcrHistoryResponse` and `CollateralValuationResponse` already
  have it.
- Move both `/{loan_id}/transfers` operations from tag `CapitalAllocation` to `LoanBook`.
- In every affected `#[utoipa::path]`, replace the hand-written
  `("chain_id" = Option<i64>, Query, ...)` param with `RequiredChain` (`required: true`) and
  make the `400` response mention the `chain_id` cases.
- Update the module and function doc comments that still say "`chain_id?` defaulting to
  `DEFAULT_CHAIN_ID`" for these routes.
- Add a user-stories doc and update the docs (see Docs to Update).

### Out of scope

- `GET /v1/loan-book` (`get_loan_book`) belongs to #1530, and `submissions`, `loan`,
  `review`, and `resubmit` belong to #1529. `get_loan_book` keeps its `Query<ChainQuery>`
  here. Do not remove the `ChainQuery` / `resolve_chain` imports from `loan_book.rs` while
  `get_loan_book` still uses them.
- `ChainQuery` and `resolve_chain` themselves stay unchanged (epic decision). Other API groups
  still use them.
- Frontend changes. Trustee hooks already send `chain_id` (see the audit below). Adding the new
  `chain_id` response field to the TS interfaces is optional, additive, and not part of this
  issue. Per the epic, frontend follow-ups are standalone `frontend` issues.
- Using `ConfiguredChain.kind` in place of `shared::chains::parse_chain_type(chain_id)` in
  `loan_financials.rs`. That is a possible cleanup, not required.

### Client audit (verified at 2c323ccb)

| Caller | Endpoint | Sends `chain_id`? |
|---|---|---|
| `packages/trustee/src/api/useLoanFinancials.ts:76` | financials | yes, `ENV.STELLAR_CHAIN_ID` |
| `packages/trustee/src/api/useLoanValuation.ts:127` | valuations | yes, `ENV.STELLAR_CHAIN_ID` |
| `packages/trustee/src/api/useLoanCcrHistory.ts:56` | ccr-history | yes, `ENV.STELLAR_CHAIN_ID` |
| `packages/trustee/src/api/useLoanWaterfall.ts:62` | waterfall | yes, `ENV.STELLAR_CHAIN_ID` |
| `packages/trustee/src/api/useCompleteDisbursement.ts:26` | disbursement/complete | yes, `ENV.STELLAR_CHAIN_ID` |
| none | `GET`/`POST` transfers, assay, offtake | no client in Trustee or LP frontend. They are used only through Swagger or manual calls |
| `packages/frontend` (LP) | none of the per-loan endpoints | n/a (it calls only `GET /v1/loan-book/submissions?chain_id=…`, which is #1529) |

No first-party caller breaks. `scripts/` and `docker/` contain no calls to these routes.
Manual or ops callers of transfers, assay, and offtake that relied on the default chain will
now get a 400. Call this out in the PR description.

## Assumptions and Risks

- **Validation order.** axum runs extractors in argument order, before the handler body. The
  order below applies to every endpoint and must be documented in each handler's doc comment:
  1. `AuthClaims` (trustee endpoints only): 401. It comes first so an unauthenticated
     caller never reaches chain validation.
  2. `Path<String>`: never fails for a `String`.
  3. `RequiredChain`: 400 with `chain_id is required`, `invalid chain_id: <raw>`,
     `unknown chain_id: <id> (configured: …)`, or `invalid chain_id: must appear at most once`.
     The body is JSON `{"error": …}`.
  4. Other `Query<T>` (ccr-history, waterfall): axum's plain-text 400 for a missing or invalid
     `from` / `amount`. Behavior is unchanged.
  5. `Json<T>` body (assay, offtake, POST transfers): axum's body rejection. It must stay the
     last argument. Behavior is unchanged.
  6. Handler body, unchanged order: role check 403, then `invalid loan_id: <raw>` 400, then
     payload / window / amount validation 400, then 404 / 422.

  So an authenticated non-trustee who omits `chain_id` gets 400, not 403. This matches
  current behavior, where `?chain_id=abc` already fails in `Query<ChainQuery>` before the
  role check, and it matches how a malformed JSON body already beats 403. The issue does not
  change the ordering inside the handler body (for example, POST transfers runs the guard's
  404 before payload validation, while assay and offtake validate the payload before their
  404). It only makes the chain step explicit and uniform.
- **Error message consistency.** All chain errors come from `parse_required_chain`, so all nine
  endpoints return identical texts. Keep the existing loan-id text `invalid loan_id: <raw>`
  and the existing not-found texts (`loan {id} not indexed on chain {chain}` and
  `no valuation for loan {id} on chain {chain}`). `loan_registry_address`'s
  `unknown chain_id: {id}` becomes unreachable on these routes, because startup guarantees a
  registry for every configured chain. Keep the `?` as a defensive check.
- **No DB in tests.** The issue asks to test "same `loan_id` on two chains resolves to the right
  one". End to end, that needs Postgres, and project rules forbid any DB or `DATABASE_URL`
  access in tests. Pure tests cover it instead (see Resolved decisions): the chain the
  extractor resolves is the one that reaches the guard pre-check (each chain's own registry),
  and it is the one echoed by the response builders. The real check is a QA user story under
  #1527.
- **Trustee routes cannot be router-tested for the chain 400 without a DB.** `AuthClaims` calls
  `account_repo.find_session`, which touches the DB, so a request with a valid token is not
  allowed in a test. A request without a token returns 401 before chain validation. For the
  five trustee operations, coverage comes from the pure pre-check tests plus OpenAPI assertions
  that `RequiredChain` is declared. The four public GETs get real router-level tests: a lazy,
  never-connected pool is enough, because `RequiredChain` rejects before any query.
- **`tower::ServiceExt::oneshot`** needs tower's `util` feature. axum 0.8 already enables it
  through feature unification. If the test does not compile, add
  `tower = { workspace = true, features = ["util"] }` under `[dev-dependencies]` in
  `packages/api/Cargo.toml`.
- **Merge conflicts with siblings.** #1529 and #1530 also edit `packages/api/src/routes/loan_book.rs`
  (the `use crate::routes::common::{…}` line ~37, the router, `get_loan_book`), `ARCHITECTURE.md:122`,
  `docs/user-stories/index.md` (Epic #1521 table), and possibly `packages/api/tests/loan_book.rs`.
  Keep this issue's `loan_book.rs` edits limited to `complete_disbursement` and the import line,
  and rebase onto whichever sibling merges first.
- **Breaking change for unknown callers.** This is intended per the epic. See the client audit.

## Resolved decisions (human, 2026-10-15)

- **Two-chain test (Q1).** The pure substitute is accepted: extractor router tests, plus
  `trustee_loan_precheck` returning each chain's own registry for the same `loan_id`, plus the
  response builders echoing the resolved `chain_id`. The real end-to-end two-chain check is a
  QA user story (Story 3 of the user-stories doc). The epic #1521 QA issue #1527 runs it.
- **Validation order (Q2).** The order is 401 (`AuthClaims`), then chain 400 (`RequiredChain`),
  then 403 (role), as planned. An authenticated non-trustee without `chain_id` gets 400.

## Open Questions

_None_

## Implementation Steps

1. **`packages/api/src/routes/common.rs`: guard takes a resolved chain.**
   - Add a pure, `pub` pre-check that does no I/O:
     ```rust
     pub fn trustee_loan_precheck<'a>(
         claims: &Claims,
         state: &'a AppState,
         chain_id: i64,
         loan_id: &str,
     ) -> Result<(BigDecimal, &'a str), ApiError>
     ```
     Its order is: trustee role check (403, same text as today), then
     `BigDecimal::from_str(loan_id.trim())` (400 `invalid loan_id: {loan_id}`), then
     `loan_registry_address(state, chain_id)?`. It returns `(loan_id, registry)`.
   - Change `trustee_indexed_loan_guard` to
     `pub(crate) async fn trustee_indexed_loan_guard(claims: &Claims, state: &AppState, chain_id: i64, loan_id: &str) -> Result<BigDecimal, ApiError>`.
     It calls `trustee_loan_precheck` and then the existing `latest_status_by_loans` 404 check.
     Remove the `resolve_chain` call and the `&ChainQuery` parameter. Callers pass
     `chain.chain_id`, where `chain` is the `ConfiguredChain` from `RequiredChain`.
   - Update its doc comment: the chain is resolved by `RequiredChain` before the guard runs,
     and the guard no longer returns the chain.
   - Leave `ChainQuery` and `resolve_chain` untouched.

2. **`packages/api/src/routes/loan_financials.rs`.**
   - Change the handler signature to
     `(State(state), Path(loan_id), RequiredChain(chain): RequiredChain)` and use
     `let chain_id = chain.chain_id;`. Drop `Query`, `ChainQuery`, and `resolve_chain` from the
     imports.
   - Add `pub chain_id: i64` to `LoanFinancialsResponse`, right after `loan_id`, with a doc
     comment. Set it in `build_response` from `row.chain_id`, so the signature does not change
     and the 12 existing call sites in `tests/loan_financials.rs` keep compiling.
   - utoipa: `params(("loan_id" = String, Path, description = "On-chain loan id"), RequiredChain)`.
     Change the 400 description to "Missing, malformed, or unknown chain_id; or malformed loan id".

3. **`packages/api/src/routes/collateral_valuation.rs`** (valuations, assay, offtake).
   - `get_collateral_valuation`: `(State, Path, RequiredChain(chain))`, using `chain.chain_id`.
   - `submit_assay` / `submit_offtake`:
     `(AuthClaims, State, Path, RequiredChain(chain), Json(payload))`, with `Json` last. Keep the
     current in-body order: role, then loan_id, then payload validation, then anchor 404, then
     mode check. Replace `resolve_chain` with `chain.chain_id`.
   - utoipa on all three: `RequiredChain` param and the 400 description updated to mention
     `chain_id`. Remove the `ChainQuery` / `resolve_chain` / `Query` imports. `loan_registry_address`
     is still used by `loan_snapshot_senior_usd`.

4. **`packages/api/src/routes/ccr_history.rs`.**
   - Remove `chain_id` from `CcrHistoryQuery`.
   - Change the handler to `(State, Path, RequiredChain(chain), Query(query): Query<CcrHistoryQuery>)`.
     `RequiredChain` comes before `Query`, so a chain error is reported before a
     missing-`from` error.
   - utoipa: `params(("loan_id" = String, Path, …), RequiredChain, CcrHistoryQuery)`, with the
     400 description updated. Drop the `resolve_chain` import.

5. **`packages/api/src/routes/waterfall.rs`.**
   - Remove `chain_id` from `WaterfallQuery`. Handler: `(State, Path, RequiredChain(chain), Query<WaterfallQuery>)`.
   - Add `pub chain_id: i64` as the first field of `WaterfallResponse`, with a doc comment.
     Change `build_response(b)` to `build_response(chain_id: i64, b: &WaterfallBreakdown)` and
     update its 2 call sites in `packages/api/tests/waterfall.rs` (lines ~886 and ~974).
   - utoipa: `RequiredChain` plus `WaterfallQuery`, with the 400 description updated to add the
     chain cases. Drop the `resolve_chain` import.

6. **`packages/api/src/routes/loan_transfers.rs`.**
   - Both handlers: `(AuthClaims, State, Path, RequiredChain(chain)[, Json(payload)])`, then
     `let loan_id = trustee_indexed_loan_guard(&claims, &state, chain.chain_id, &loan_id).await?;`.
     Keep the POST order: guard first, then `validate_loan_transfers`.
   - Add `pub chain_id: i64` to `LoanTransfersResponse`, after `loan_id`. Make `from_row` and
     `defaults` `pub`. `from_row` takes `row.chain_id`, and `defaults` becomes
     `defaults(chain_id: i64, loan_id: &BigDecimal)`. Making them `pub` lets the tests call them.
   - utoipa: `tag = "LoanBook"` on both, the `RequiredChain` param, and the 400 description
     updated. Rewrite the `LoanTransfersDoc` doc comment, which currently says "Tagged
     `CapitalAllocation` because…". The routes now live under `LoanBook` because they are
     per-loan resources, while they still back the capital-allocation buckets. Update the module
     doc: "`chain_id?` defaulting to `DEFAULT_CHAIN_ID`" becomes "required `chain_id`
     (`RequiredChain`)".

7. **`packages/api/src/routes/loan_book.rs`: `complete_disbursement` only.**
   - Change the signature to `(AuthClaims, State, Path, RequiredChain(chain))`, then
     `let loan_id = trustee_indexed_loan_guard(&claims, &state, chain.chain_id, &loan_id).await?;`
     and `mark_complete(chain.chain_id, …)`.
   - utoipa: the `RequiredChain` param, and a 400 description of "Missing, malformed, or unknown
     chain_id; or malformed loan id".
   - Import `RequiredChain`. Keep `resolve_chain` and `ChainQuery` for `get_loan_book`; #1530
     owns that. Leave the module doc line 7 to #1530, or qualify it now as "`GET /v1/loan-book`:
     `chain_id?` …; per-loan routes require `chain_id`".

8. **`packages/api/src/routes/capital_allocation.rs`.** The module doc (line ~12) references
   `POST …/transfers`. Add "(LoanBook tag; requires `chain_id`)" only if it reads naturally.
   No code change.

9. **Lint and format.** Run `cargo fmt --all --check` and `cargo clippy --all -- -D warnings`,
   then `cargo test -p pipeline-api`. After editing docs, run `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests are pure. They use no DB, read no `DATABASE_URL` / `POSTGRES_URL`, and put nothing in
inline `#[cfg(test)]`. Tests go in `packages/api/tests/<topic>.rs`. Each new test file starts
with `// spec: docs/exec-plans/active/issue-1531-per-loan-chain-required.md#test-strategy`.

**New file `packages/api/tests/loan_chain_required.rs`.**

- `make_test_state()`: copy the lazy-pool `AppState` builder from
  `tests/loan_registry_scope.rs`, using `sqlx::PgPool::connect_lazy`, which never connects.
  Set `chains = [ConfiguredChain{1, Evm}, ConfiguredChain{99_000_001, Stellar}]` and
  `loan_registry_addresses` for both chains (two distinct addresses), with `jwt_keys: None`.
- **Router-level, public GETs.** Build each `router()` (`loan_financials`,
  `collateral_valuation`, `ccr_history`, `waterfall`) with `.with_state(Arc::new(state))` and
  call `tower::ServiceExt::oneshot`. Paths have no `/v1` prefix, for example
  `/loan-book/7/financials`. For each of the four endpoints, check:
  - no `chain_id` returns 400 with body `{"error":"chain_id is required"}`
  - `chain_id=5` returns 400 with `unknown chain_id: 5 (configured: 1, 99000001)`
  - `chain_id=abc` returns 400 with `invalid chain_id: abc`
  - ccr-history `?from=1&step=60` (other params present, chain missing) returns the chain 400,
    which proves the extractor coexists with `CcrHistoryQuery`
  - waterfall `?amount=100` without chain returns the chain 400
  - ordering: ccr-history with neither `from` nor `chain_id` returns the JSON chain 400, not
    the plain-text `from` rejection, which proves `RequiredChain` runs first
  - Never send a request with a valid chain to these routers, because the handler would then
    query the lazy pool.
- **Router-level, trustee routes (no token).** `POST /loan-book/7/assay` (and one more trustee
  route) with no `Authorization` and no `chain_id` returns 401, showing auth is checked before
  chain. This needs no DB: `jwt_keys: None` rejects synchronously.
- **Guard pre-check (two chains, same `loan_id`).** Build `Claims` with role `trustee`, as in
  `tests/auth_jwt.rs`. `trustee_loan_precheck(&claims, &state, 1, "7")` returns
  `(7, <chain-1 registry>)`, and `(…, 99_000_001, "7")` returns `(7, <stellar registry>)`.
  Also check: a non-trustee gets 403 with the exact message; a non-trustee with a malformed
  loan id still gets 403 (role before loan id); a trustee with `"abc"` gets 400
  `invalid loan_id: abc`; `" 7 "` is trimmed.
- **Response builders echo the chain.**
  - `loan_financials::build_response` with a `LoanSnapshotRow { chain_id: 99_000_001, … }`
    gives `resp.chain_id == 99_000_001`. Reuse the fixture style of `tests/loan_financials.rs`,
    or put this assertion in that file.
  - `waterfall::build_response(99_000_001, &b).chain_id == 99_000_001` (in `tests/waterfall.rs`).
  - `LoanTransfersResponse::defaults(1, &7)` gives `chain_id == 1` with zeroed amounts.
    `from_row` with a `LoanCapitalTransfersRow { chain_id: 99_000_001, … }` echoes that chain
    (in `tests/loan_transfers.rs`).
- **OpenAPI contract.** For every one of the nine operations, read the bundles
  `LoanFinancialsDoc`, `CollateralValuationDoc`, `CcrHistoryDoc`, `WaterfallDoc`,
  `LoanTransfersDoc`, and `LoanBookDoc` with `::openapi()` and `serde_json::to_value` them. Check:
  - exactly one `chain_id` query param with `required == true`
  - a `"400"` response is present
  - `tags == ["LoanBook"]`, which covers both transfers operations
  - ccr-history and waterfall still list `from`/`to`/`step` and `amount`/`as_of`, and there is
    no duplicate `chain_id`
  - the component schemas `LoanFinancialsResponse`, `WaterfallResponse`, and
    `LoanTransfersResponse` have a required `chain_id` integer property

**Existing suites** must compile and pass after the signature changes: `tests/waterfall.rs`
(the two `build_response` call sites) and `tests/loan_financials.rs` (unchanged signature).
`tests/chain_param.rs` is untouched. Run `cargo test -p pipeline-api` and
`cargo clippy --all -- -D warnings`.

**Manual or QA (user-stories doc).** A same `loan_id` on two chains returns each chain's own
financials and transfers on a stack with two configured chains.

## Docs to Update

- **New `docs/user-stories/epic-1521/1531-per-loan-chain-required.md`**, with status
  `Initial` and the format of `1528-loanbook-chain-param.md`. Stories:
  1. A per-loan GET without `chain_id` returns 400 `chain_id is required`, and with an
     unknown id returns 400 `unknown chain_id: …`.
  2. A trustee write (assay, offtake, disbursement/complete, POST transfers) without
     `chain_id` returns 400, and nothing is written.
  3. On a stack with two chains, the same `loan_id` resolves per chain, and the response
     carries `chain_id`. This is the real two-chain check, accepted in place of a DB test,
     and is executed by QA #1527.
  4. Swagger shows `chain_id` as required and the transfers routes under `LoanBook`.
  5. The Trustee loan-detail page (financials, valuation, CCR chart, waterfall, mark
     disbursement complete) still works.

  Link the doc from the Epic #1521 table in `docs/user-stories/index.md`.
- **`ARCHITECTURE.md:122`.** "The API resolves chain by an optional `chain_id` query parameter
  on every route, falling back to `DEFAULT_CHAIN_ID`" is no longer true for LoanBook. Add that
  LoanBook per-loan routes require `chain_id` (400 if missing or unknown), and leave the list
  and submissions behavior to #1529 / #1530. Coordinate the wording with whichever sibling
  lands first.
- **`docs/product-specs/trustee-dashboard.md:77`.** Change `…/waterfall?amount=…[&as_of][&chain_id]`
  to `…?chain_id=…&amount=…[&as_of]`, with `chain_id` required.
- **`docs/product-specs/loans.md:138`** (`POST …/disbursement/complete`). Note that `chain_id`
  is required.
- Code doc comments covered in the steps: the `loan_transfers.rs` module doc, the
  `LoanTransfersDoc` comment, the `trustee_indexed_loan_guard` doc, and each handler's ordering
  note.
- `docs/product-specs/api-authorization.md` has no rows for these routes, so it needs no change.
