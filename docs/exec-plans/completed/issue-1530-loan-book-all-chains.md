# Issue #1530: LoanBook API: GET /v1/loan-book across all chains

Source: https://github.com/eq-lab/pipeline/issues/1530

Parent epic: #1521 (LoanBook API — multi-chain). The epic's "Decisions (human, 2026-10-15)"
section is authoritative, except where a later human decision (the #1526 integration review)
overrides it. See Resolved decisions.

Depends on #1528 (merged: `AppState.chains`, `ChainFilter` / `RequiredChain`,
`parse_chain_filter`) and epic #1520 (merged: registry-scoped readers, `handle_loan_book`,
outstanding = `disbursed − repaid − written_down`). Siblings in flight: #1529 (submissions target
chain) and #1531 (per-loan required `chain_id`). Both also edit `routes/loan_book.rs` and
`routes/common.rs`.

No Figma reference. Backend only, so there is no visual verification step.

## Scope

### In scope

- `GET /v1/loan-book`:
  - `chain_id` omitted → the union over every chain in `AppState.chains`.
  - `chain_id` = a configured chain → that chain only. The response is byte-identical to today's
    response for that chain.
  - `chain_id` = a well-formed integer that is not configured → **200 with an empty book** (Resolved decision 1).
  - `chain_id` malformed or repeated → 400 with the #1528 messages
    (`invalid chain_id: <raw>`, `invalid chain_id: must appear at most once`).
- Re-key every per-loan map from `loan_key(loan_id)` (`String`) to `(chain_id, loan_key(loan_id))`.
  This covers the collateral, spot, disbursement and watchlist maps passed to `compute_loan_book`,
  the assay and offtake maps inside `collateral_by_loan`, the `active_keys` set in the at-risk loop,
  and the lifecycle-event matching in `effective_end` / `is_closed`.
- `LifecycleRow` gains `chain_id`, so lifecycle events from two chains cannot match each other's
  loans.
- Summary cards are recomputed over the union in a single `compute_loan_book` pass. They are not
  summed per chain.
- Deterministic row ordering: principal descending, then `chain_id` ascending, then `loan_id`
  ascending (numeric). Active rows come first, then terminal rows, as today.
- Each chain in the fan-out uses its own LoanRegistry address from `state.loan_registry_addresses`.
- OpenAPI: the `chain_id` param is declared through an `IntoParams` extractor type. The old
  hand-written `("chain_id" = Option<i64>, …)` tuple is removed.

### Out of scope

- `GET /v1/loan-book/submissions` (#1529) and the per-loan endpoints (#1531).
- `/v1/dashboard/*`. `dashboard.rs` calls `compute_loan_book` for a single chain. It only gets the
  type changes the new map key forces, and its behaviour does not change.
- Frontend changes. The LP and Trustee loan-book views are #1537. Today the frontend always sends
  `chain_id`, so it sees no change.
- Concurrent fan-out (sequential per Resolved decision 2).

## Assumptions and Risks

- **Amounts are already on one scale. Each summary input was checked:**
  - Snapshot money fields are normalised to 6 dp per chain at read time.
    `decode_snapshot_rows` → `LoanSnapshot::normalize_usdc_for_display(chain_kind)`
    (`packages/shared/src/contract_logs_repo.rs:169`, `packages/shared/src/loan_snapshot.rs:90`).
    This covers `original_senior_tranche`, `original_equity_tranche`, `disbursed`, `repaid`,
    `written_down`, `interest_adjustment` and every `repayment.*` field. So `total_deployed`,
    `deployed_senior`, `at_risk_wl_and_default_senior`, `senior_outstanding`,
    `original_senior_tranche` and `repaid_to_date` can be summed across chains.
  - Collateral is computed in USD by `compute_collateral` and then multiplied by 1e6. It does not
    depend on the chain, so `total_collateral`, `senior_debt_coverage`, `ltv`, `ccr_bps` and the
    NAV denominator of `at_risk_wl_and_default_pct` are safe.
  - `avg_yield` / `weighted_rate` / `avg_duration_days` / `weighted_tenor_days` are weighted by
    principal (6 dp). They use bps and seconds, which are the same on every chain.
  - `top_concentration` groups by the `commodity` string. In a union, the same commodity on two
    chains is summed into one exposure. That is the intended "largest single-commodity exposure"
    over the whole book. Two chains spelling the same commodity differently would stay separate,
    which is a data-quality matter and not addressed here.
  - Spot prices come from the global `loan_asset_prices` table. The table is not scoped to a chain
    and is keyed by `(asset, provider)`, so one fetch serves every chain.
- **Single-chain byte identity.** Today `list_latest_loan_snapshots` returns rows ordered by
  `loan_id` ascending (`LIST_LATEST_LOAN_SNAPSHOTS_SQL`), and `sort_by_key(Reverse(principal))` is
  stable. So rows with equal principal already come out in `loan_id`-ascending order. The new
  explicit tie-break `(chain_id, loan_id)` reproduces that order exactly for one chain. `loan_id`
  must be compared as `BigDecimal` (numeric), not as the `loan_key` string, because `"10" < "9"`
  as strings. The order of DB calls inside the handler may change, but that does not affect the
  output.
- **Lifecycle events have no chain today.** `LifecycleRow` is `{event_name, block_timestamp,
  loan_id}`. Without a chain, a `LoanClosed` for loan 1 on chain A would close loan 1 on chain B in
  the union. Adding `chain_id` to the shared struct changes both lifecycle SELECTs and every struct
  literal: 8 literal sites in `packages/api/tests/{portfolio_compute,financial_position,
  capital_allocation,loan_book}.rs`. `portfolio`, `financial_position` and `capital_allocation`
  ignore the new field because they work on one chain. The alternative is to keep
  `LifecycleRow` unchanged and tag events only inside loan_book (for example
  `&[(i64, LifecycleRow)]`). It was rejected because it leaks into `dashboard.rs`'s call and keeps
  a chain-less row type around for future multi-chain readers.
- **`packages/shared/tests/contract_logs_repo.rs:71`** asserts that
  `LOAN_LIFECYCLE_EVENTS_FOR_REGISTRY_SQL` is registry-scoped on bind `$4`. Adding a `chain_id`
  column to the SELECT list does not change any bind position, so the test stays green.
- **Unknown-chain conflict.** The epic says unknown → 400. The #1526 integration review decided
  that `GET /v1/loan-book` returns 200 with an empty book for an unconfigured chain. The reason is
  that the LP dashboard (`useDeploymentMonitorPanel.ts` → `useDashboardChain()` /
  `wallet/useActiveChain.ts`) sends the connected wallet's EVM chain id, which may not be in
  `CHAINS`. That decision is recorded in
  `docs/exec-plans/completed/issue-1526-loanbook-registry-scope.md` and pinned by
  `loan_book_for_unconfigured_chain_is_empty_not_error` in
  `packages/api/tests/loan_registry_scope.rs`. `ChainFilter` returns 400 for that case, so this
  endpoint cannot use `ChainFilter` as-is while the empty-book behaviour stands. See step 2 and
  Resolved decision 1.
- **Latency.** Per chain, the handler runs up to 7 queries: snapshots, lifecycle events, anchors,
  disbursement, watchlist, and assays + offtakes (only when anchors exist). The 2 global price
  queries run once. With a sequential fan-out, latency grows linearly with N chains, about
  N × today's single-chain time. CHAINS holds 2 or 3 entries today, so that is acceptable
  (sequential confirmed by Resolved decision 2).
  `PgPool::connect` uses the default sqlx pool (10 connections), and a sequential fan-out never
  holds more than one. The workspace has no `futures` crate. `tokio::try_join!` cannot fan out
  over a runtime-length list, and `JoinSet` needs `'static` futures, which means cloning
  `Arc<AppState>` into each task. Sequential confirmed by Resolved decision 2.
- **Merge conflicts.** #1529 edits `list_submissions` / `submit_loan` and #1531 edits
  `complete_disbursement` / `trustee_indexed_loan_guard` in the same files. This plan changes only
  `get_loan_book`, `handle_loan_book`, `spot_by_loan`, `collateral_by_loan`, `compute_loan_book`
  and its helpers, plus one new extractor in `common.rs`, so any conflicts should be textual and
  local.
- **Comment rule.** `AGENTS.md` asks for code with no comments. `loan_book.rs` already has many
  doc comments. The coder must not add new comments and should update only the existing comments
  this change makes false: the module header line 7 and the `compute_loan_book` /
  `handle_loan_book` doc text that says "keyed by `loan_key(loan_id)`".

## Resolved decisions (human, 2026-10-15)

1. **Unconfigured `chain_id` on `GET /v1/loan-book` → 200 with an empty book** (empty `loans`, zeroed `summary`). This overrides the epic's "unknown → 400" for this endpoint only, and the epic body will be updated. Malformed or repeated `chain_id` values still return 400 with the #1528 messages. Implemented through `LenientChainFilter` (step 2).
2. **Sequential fan-out across chains.** No `JoinSet` and no new `futures` dependency (step 4).

## Open Questions

_None_

## Implementation Steps

0. [x] **Pin today's output first (byte-identity guard).** Before any refactor, add the test
   `single_chain_output_is_byte_identical` to `packages/api/tests/loan_book.rs`. It builds a rich
   single-chain fixture: active plus terminal loans, two loans with equal principal, a WatchList
   loan with a watchlist entry, a Default loan with collateral, and collateral, spot and
   disbursement entries. It asserts that `serde_json::to_string(&compute_loan_book(..))` equals a
   string literal captured from the current `main` code. Run it green on the unmodified code, then
   update only the map-key construction in the fixture during step 3. The expected literal must not
   change.

1. [x] **`LifecycleRow.chain_id`** (`packages/shared/src/contract_logs_repo.rs`):
   - Add `pub chain_id: i64` to `LifecycleRow` (line ~202).
   - Add `chain_id,` to the SELECT list of `LOAN_LIFECYCLE_EVENTS_FOR_REGISTRY_SQL` (line 33) and of
     the inline SQL in `list_loan_lifecycle_events` (line ~457).
   - Update every `LifecycleRow { … }` literal in `packages/api/tests/portfolio_compute.rs`,
     `financial_position.rs`, `capital_allocation.rs` and `loan_book.rs` (`event()` helper and the
     line-326 literal) with `chain_id: 1`. That matches `make_loan`'s `chain_id: 1`.

2. [x] **Chain scope extractor for the loan book** (`packages/api/src/routes/common.rs`). This step
   implements Resolved decision 1.
   - Refactor `parse_chain_filter` without changing behaviour. Pull the URI → `Option<i64>` part
     (decode, the duplicate and malformed messages, trim, integer parse) into
     `fn parse_chain_id_param(uri: &Uri) -> Result<Option<i64>, ApiError>`. `parse_chain_filter`
     then becomes `parse_chain_id_param` + configured lookup + the existing `unknown chain_id … (configured: …)`
     message. Every `chain_param.rs` test must stay green unchanged.
   - Add `pub enum ChainScope { All, One(ConfiguredChain), Unconfigured(i64) }`.
   - Add `pub fn parse_chain_scope(uri: &Uri, chains: &[ConfiguredChain]) -> Result<ChainScope, ApiError>`.
     Absent → `All`. Configured → `One`. Well-formed but not configured → `Unconfigured(id)`.
     Malformed or repeated → the same 400 as `parse_chain_filter`.
   - Add `pub struct LenientChainFilter(pub ChainScope)` with
     `FromRequestParts<Arc<AppState>>` (same `std::future::ready` shape as `ChainFilter`) and
     `IntoParams` via the existing `chain_id_param(Required::False, …)`. The description reads:
     "Chain ID to filter by. Optional — omit for all configured chains (CHAINS). An id not in CHAINS
     returns an empty loan book; a malformed or repeated value → 400."
   - Add `impl LenientChainFilter { pub fn chain_ids(&self, all: &[ConfiguredChain]) -> Vec<i64> }`.
     `All` → every configured id in CHAINS order. `One(c)` → `[c.chain_id]`. `Unconfigured(id)` →
     `[id]`. `handle_loan_book` skips the unconfigured id because it has no registry, so the result
     is an empty book.

3. [x] **Re-key the compute layer** (`packages/api/src/routes/loan_book.rs`):
   - Add `pub type LoanRef = (i64, String);` and
     `pub fn loan_ref(chain_id: i64, loan_id: &BigDecimal) -> LoanRef { (chain_id, loan_key(loan_id)) }`.
     Keep `loan_key` public, because `list_submissions` and the tests use it.
   - `compute_loan_book` and `build_loan_entry`: change all four map params to
     `&HashMap<LoanRef, _, S>`. Every lookup becomes `.get(&loan_ref(loan.chain_id, &loan.loan_id))`.
     Compute it once per loan in `build_loan_entry` instead of four `loan_key` calls.
   - `effective_end` / `is_closed`: match `e.chain_id == loan.chain_id && e.loan_id == loan.loan_id`.
   - At-risk loop: `active_keys: HashSet<LoanRef>`, and the `collateral_by_loan` lookup uses
     `loan_ref`.
   - Sorting: replace both `sort_by_key(|loan| Reverse(principal_of(loan)))` with
     `sort_by_cached_key(|loan| (Reverse(principal_of(loan)), loan.chain_id, loan.loan_id.clone()))`
     for active and for terminal.
   - `senior_by_commodity` stays keyed by commodity, so concentration is over the union. Its
     tie-break by commodity name already exists.
   - `dashboard.rs` (~line 359): retype the four empty maps to `HashMap<LoanRef, _>`. No behaviour
     change.

4. [x] **Fan-out in `handle_loan_book`** (`packages/api/src/routes/loan_book.rs`):
   - New signature: `pub async fn handle_loan_book(state: &AppState, chain_ids: &[i64]) -> Result<LoanBookResponse, ApiError>`.
   - Compute `to` once.
   - Loop over each `chain_id` in `chain_ids`, sequentially (Resolved decision 2):
     - `let Some(registry) = state.loan_registry_addresses.get(&chain_id) else { continue };`
       This is a per-chain registry lookup. It skips an unconfigured chain, as today's single-chain
       empty return does.
     - Run `list_latest_loan_snapshots(pool, chain_id, registry, to)`. If it is empty, `continue`
       and skip the other per-chain queries, as today's early return does.
     - Run `list_loan_lifecycle_events_for_registry`, `collateral_valuation_repo.all_anchors(chain_id)`,
       `loan_disbursement_repo.list_for_chain(chain_id)` and
       `latest_watchlist_entry_by_chain(pool, chain_id, registry, to)`.
     - When this chain's anchors are non-empty, run `latest_assays(chain_id)` and
       `latest_offtakes(chain_id)`. Key them by `(r.chain_id, loan_key(&r.loan_id))`.
     - Append to the accumulated `loans`, `events` and `anchors`. Insert into
       `disbursement_by_loan` / `watchlist_entry_by_loan` / `assays` / `offtakes` with key
       `(chain_id, loan_key(..))`.
   - If the accumulated `loans` is empty, return `empty_response()`. No price queries run, the same
     as today.
   - Run the global price queries once: `loan_asset_price_repo.latest_prices()`. When the
     accumulated anchors are non-empty, `spot_by_loan` also runs `prices_as_of(cutoff, not_before)`.
   - `collateral_by_loan`: change the signature to take the pre-fetched `assays` / `offtakes`
     (`HashMap<LoanRef, _>`) instead of `chain_id`. Key both lookup and output by
     `loan_ref(anchor.chain_id, &anchor.loan_id)`.
   - `spot_by_loan`: key the output by `loan_ref(anchor.chain_id, &anchor.loan_id)`.
   - Call `compute_loan_book` once over the union.

5. [x] **Handler + OpenAPI** (`get_loan_book`):
   - Replace `Query(query): Query<ChainQuery>` + `resolve_chain` with
     `chain: LenientChainFilter`, then call
     `handle_loan_book(&state, &chain.chain_ids(&state.chains))`.
   - In `#[utoipa::path(...)]`, use `params(LenientChainFilter)` and add
     `(status = 400, description = "Malformed or repeated chain_id")`. Update the 200 description to
     say the book covers the selected chain, or all configured chains when `chain_id` is omitted.
   - Remove `ChainQuery` / `resolve_chain` from this module's imports only if they become unused.
     `complete_disbursement` still uses `ChainQuery` until #1531.

6. [x] **Existing test using the old signature.** In
   `packages/api/tests/loan_registry_scope.rs::loan_book_for_unconfigured_chain_is_empty_not_error`,
   change the call to `handle_loan_book(&state, &[560_048])`. Add the case
   `handle_loan_book(&state, &[])` → empty book. Both return before any DB I/O, so the lazy pool
   is never touched.

7. [x] **Lint/format:** `cargo fmt --all`, `cargo clippy --all -- -D warnings`,
   `cargo test -p pipeline_api -p shared`, and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests are pure unit tests in `packages/<pkg>/tests/<topic>.rs`. There is no inline
`#[cfg(test)]` and no `DATABASE_URL` / `POSTGRES_URL` / real Postgres.

`packages/api/tests/loan_book.rs`:
- `single_chain_output_is_byte_identical`: the golden JSON string from step 0, captured on
  unmodified `main`.
- All existing tests stay green with only mechanical edits: map helpers (`collateral_map`,
  `all_complete`, the spot/watchlist helpers) build `loan_ref(1, …)` keys, and `event()` sets
  `chain_id: 1`.
- Two chains with overlapping loan ids. The fixture has loan 1 and loan 2 on chain `1`, and loan 1
  on chain `99000001`, with different principal, commodity, collateral, spot, disbursement and
  watchlist values per chain:
  - `overlapping_ids_keep_per_chain_inputs`: each entry gets its own chain's collateral, ltv, ccr,
    spot, `disbursed`/status (`Disbursing` on one chain only) and `days_on_watchlist`.
  - `lifecycle_event_is_chain_scoped`: a `LoanClosed` for `(1, 1)` moves only chain 1's loan 1 into
    the terminal set. `(99000001, 1)` stays active.
  - `at_risk_extra_collateral_is_chain_scoped`: `(1, 1)` is active WatchList and `(99000001, 1)` is
    Default (terminal) with collateral. The Default loan's collateral is added to the NAV
    denominator. Keying by bare `loan_key` would wrongly exclude it.
  - `union_summary_recomputed`: `total_deployed`, `deployed_senior`, `total_collateral`,
    `senior_debt_coverage` and the at-risk figures equal hand-computed union values. `avg_yield` /
    `avg_duration_days` are weighted by principal across both chains, which is not the mean of the
    per-chain values. `top_concentration` sums the same commodity across chains.
  - `ordering_tie_break_chain_then_loan`: three loans with equal principal, `(99000001, 1)`,
    `(1, 10)` and `(1, 9)`, fed in reverse order, come out as `(1, 9)`, `(1, 10)`,
    `(99000001, 1)`. This also asserts numeric, not string, `loan_id` comparison. The same check is
    run for the terminal set.
  - `union_entries_match_single_chain_entries`: in the union response, each chain's entries
    serialized with `serde_json` equal the entries from computing that chain alone.

`packages/api/tests/chain_param.rs`:
- `parse_chain_scope`: absent → `All`. `1` → `One` with kind. ` 1 ` is trimmed. `560048`
  (unconfigured) → `Unconfigured(560048)`. `abc` / empty → 400 `invalid chain_id: …`.
  `chain_id=1&chain_id=2` → 400 `invalid chain_id: must appear at most once`.
- `LenientChainFilter::chain_ids` for each variant. For `All`, the ids come in CHAINS order.
- Extend `openapi_params_have_expected_required_flag` (or add a test next to it) so that
  `LenientChainFilter::into_params` returns one optional int64 `chain_id` query param.
- `loan_book_openapi_declares_chain_param`: `LoanBookDoc::openapi()` JSON for
  `/v1/loan-book` `get` has exactly one `chain_id` param with `required: false`, and a 400 response.
- Existing `parse_chain_filter` tests stay unchanged, which guards the refactor.

`packages/api/tests/loan_registry_scope.rs`: step 6 updates.

`packages/shared/tests/contract_logs_repo.rs`: unchanged and still green.

Not testable without a DB (accepted): the real per-chain SQL fan-out. It is covered by the pure
compute tests plus the existing registry-scope SQL assertions.

## Docs to Update

- `docs/product-specs/trustee-dashboard.md` (Loans page row, ~line 172): add that
  `GET /v1/loan-book` takes an optional `chain_id`. When it is omitted, the book covers every
  configured chain, `summary` is recomputed over the union, and rows are ordered by principal desc
  then `(chain_id, loan_id)`. An unconfigured id returns an empty book (Resolved decision 1), and a
  malformed id returns 400.
- `docs/product-specs/dashboards.md`, Deployment Monitor / Active Loans section: add one sentence
  with the same `chain_id` semantics, and note that the LP frontend currently always sends the
  dashboard chain.
- `packages/api/src/routes/loan_book.rs` module header (line 7): replace "`chain_id?` defaulting to
  `DEFAULT_CHAIN_ID`" with "`chain_id?` — omitted = all configured chains".
- New `docs/user-stories/epic-1521/1530-loan-book-all-chains.md`, in the same format as
  `1528-loanbook-chain-param.md`. QA #1527 needs these stories:
  1. With no `chain_id`, loans from both configured chains appear, and overlapping ids show as
     separate rows with their own `chain_id`.
  2. With `chain_id=<configured>`, the response is identical to before.
  3. With `chain_id=<unconfigured>`, the response is 200 with an empty book.
  4. With `chain_id=abc`, the response is 400 JSON.
  5. The summary cards equal the union's figures.
- On completion, move this plan to `docs/exec-plans/completed/`.
