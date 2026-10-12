# Issue #387: Portfolio yield API: APY + accrued + realized interest time series

Source: https://github.com/eq-lab/pipeline/issues/387

## Scope

**In scope.** Add a new backend endpoint that returns three time series describing the protocol-level senior book — weighted-average current APY, cumulative accrued senior interest, and cumulative realized senior interest — plus a headline snapshot. Computed on demand from already-indexed data (`loan_details` for `(Pᵢ, Rᵢ, startᵢ, scheduled endᵢ)` from #363, `contract_logs` for early-end lifecycle events and realized repayments). No caching, no indexer changes, no per-LP attribution, single-chain only.

Concretely:

1. New `GET /v1/portfolio/yield` Axum route under `packages/api`.
2. New `packages/api/src/routes/portfolio.rs` module hosting handler + DTOs + utoipa schema.
3. New `shared::portfolio_repo::PortfolioRepo` (or fold the two queries into the existing `LoanDetailsRepo` — see Implementation Step 2) for `(chain_id, [from, to])` reads of:
   - all `loan_details` rows where `origination_date <= to` (so we only fetch loans that could possibly contribute to any sample in range);
   - all `contract_logs` rows for `LoanClosed`, `LoanDefaulted`, `LoanRepayment` on the same chain with `block_timestamp <= to`.
4. Pure compute function (no DB) that, given the two row sets and the sample grid, returns `Vec<SamplePoint>` plus a `Headline`.
5. utoipa wiring (`PortfolioDoc`) and router merge into `packages/api/src/main.rs` under `/v1`.
6. Unit tests for the three formulas built around the 3-loan worked example in the Issue body.
7. Integration test in `packages/api/tests/portfolio.rs` that inserts `loan_details` + `contract_logs` rows and asserts a small sample series.
8. New product spec at `docs/product-specs/portfolio-yield.md` (no spec exists today; `yield.md` describes distribution mechanics, not the dashboard read endpoint) and link it from `docs/product-specs/index.md`. Cross-link from `docs/product-specs/dashboards.md` (Protocol Dashboard → "Trailing yield" / "Cumulative yield minted" panels — note the relationship: this endpoint serves the *book yield* view, distinct from the *yield-minted-into-vault* counter).

**Out of scope** (the Issue body is explicit):

- Partial senior principal amortisation. `Pᵢ` is treated as constant at `original_senior_tranche` until end, matching current data. First amortising loan triggers a separate Issue (TD entry already exists for amortisation handling).
- Per-LP yield (book-level only here).
- Cross-chain aggregation (client calls once per chain).
- Caching / pre-aggregation. Confirm Step 4's complexity argument fits the "compute on request" budget; revisit only if p99 exceeds 200ms on realistic data.
- Forward-looking projections.
- Stale-data SLA. The indexer's `last_indexed_block` lag could in principle make the "current" series briefly outdated; out of scope.

## Assumptions and Risks

- **Lifecycle source of truth is `contract_logs`.** The verified parsers and event names are `LoanClosed` (`params.loan_id`, `params.closure_reason`), `LoanDefaulted` (`params.loan_id`, `params.ccr_bps`), and `LoanRepayment` (`params.loan_id`, `params.senior_interest`, `params.senior_principal`, `params.offtaker_amount`, `params.equity_amount`). All values inside `params` are JSON **strings** for uint256 fields; integer fields like `ccr_bps` may be raw JSON numbers. The handler casts via `(params->>'senior_interest')::numeric` (same pattern as `position_repo.rs` lines 213, 225 and `kyc_repo.rs` line 413), which works for both shapes.
- **`loan_id` is `NUMERIC(78,0)` in `loan_details` and a string in `contract_logs.params->>'loan_id'`.** The join is `loan_details.loan_id = (contract_logs.params->>'loan_id')::numeric AND loan_details.chain_id = contract_logs.chain_id`.
- **Early-end semantics.** Per the Issue acceptance criteria a loan stops accruing and stops contributing to the APY denominator from `block_timestamp` onwards for both `LoanClosed` **and** `LoanDefaulted`. If multiple lifecycle events exist for the same `loan_id`, take the **earliest** `block_timestamp` (defensive — under normal operation there is at most one).
- **`LoanRepayment` does NOT end the loan.** It records cash flow only; the loan ends when `LoanClosed` fires (often, but not always, in the same tx as the final repayment). This is consistent with the Issue's framing: "realized senior interest" is a sum across `LoanRepayment` rows, "endᵢ" is from `LoanClosed`/`LoanDefaulted`/maturity. Documented inline in the spec.
- **`origination_date` vs first-sample bound.** Loans with `origination_date > t` are not yet active at sample `t` and contribute zero. Loans with `endᵢ <= t` are no longer active and contribute zero. "Active at t" means `startᵢ <= t < endᵢ` (half-open). This makes the day-of-mint and day-of-end transitions land at the same instant the chart would expect (steps-post).
- **No active loans at `t`.** Per the Issue: `apy_bps = null`, `active_loan_count = 0`, `principal_outstanding_usdc = "0"`. Accrued/realized still report their running cumulative totals (they don't "reset"). All monetary fields are 6dp strings; APY is **basis points as integer**, or `null` only when undefined.
- **Decimal handling.** `original_senior_tranche` is `NUMERIC(78,0)` in 6dp USDC base units. Accrued is computed in `BigDecimal` as `P · R_bps · Δt_secs / (10000 · 365 · 86400)`. We hold the entire computation in `BigDecimal` to avoid float drift and emit a truncated integer string at the end (no decimal point — the response represents USDC in 6dp base units, same convention as `original_senior_tranche`). One worked check: 100_000 USDC = `100_000_000_000` base units; at 12% for 30 days → `100_000_000_000 · 1200 · 2_592_000 / (10000 · 365 · 86400) = 986_301_369.86…` → emitted as `"986301369"` (truncated). Document the truncation rule in the spec.
- **APY rounding to basis points.** `apy_bps = round( Σᵢ Pᵢ·R_bps_i / Σᵢ Pᵢ )` over active loans, integer-divided to bps. Use `BigDecimal` arithmetic with explicit rounding to nearest integer (half-up). Document inline.
- **Query bounds and sample grid.**
  - `from` default: `MIN(origination_date) FOR chain_id`. If the table is empty for the chain, return HTTP 200 with `series: []` and a `headline` whose monetary fields are `"0"`, `apy_bps: null`, `active_loan_count: 0`, `as_of: <now>` (per acceptance criterion).
  - `to` default: now (server clock, unix seconds).
  - `step` default: 86400. Min 3600, max 604800 inclusive. Out-of-range → HTTP 400.
  - `chain_id` is required.
  - If `from > to`, HTTP 400.
  - Sample grid: `t = from, from+step, from+2·step, …` up to and including `to`. If `(to - from)` is not a multiple of `step`, the final sample is still `to` (so the chart's right edge reflects the requested end).
  - Cap sample count to prevent abuse: `step >= 3600` and `to - from <= 31_536_000 · 5` (5 years) → ≤ 43_800 samples worst case, plus 1 for the right edge. Reject larger windows with HTTP 400. Document inline; revisit later if a real consumer needs more.
- **Complexity check.** Single chain, ~hundreds of loans, daily samples over a year → ~365 samples × ~hundreds of loans = ~10⁵ inner-loop operations in `BigDecimal`. At ~1µs per BigDecimal op this is ~tens of milliseconds — comfortable under the 200ms target. Two SQL fetches (one per table, see Step 2) keep DB round-trips to a minimum.
- **Chain ID type.** `loan_details.chain_id` is `BIGINT` (i64). The query string accepts `u64`; cast and validate non-negative.
- **Tech-debt risk: defaulted loans still owing interest.** The current spec says they stop accruing at default. If future product guidance changes this, the relevant code is the `loan_end_at` resolver and unit tests around it — log under tech-debt-tracker if implementation reveals ambiguity (Issue body explicitly invites a TD entry).

## Open Questions

_None._ The Issue body resolves every design choice the planner could otherwise be guessing on (formulas, three-series framing, response shape, default `from`, step bounds, null-APY behaviour, decimal precision, exact lifecycle treatment for early-close and default). Implementation choices below (query layout, module placement, BigDecimal arithmetic) are coder discretion, not unresolved product questions.

## Implementation Steps

1. **Module layout** — create `packages/api/src/routes/portfolio.rs`. Mirror the structure of `routes/stats.rs` (existing closest analogue: chain-scoped, time-series output, utoipa-decorated). Register in `packages/api/src/routes/mod.rs` (add `pub mod portfolio;`) and merge from `packages/api/src/main.rs` alongside `stats`: `.nest("/v1", pipeline_api::routes::portfolio::router())` and `api_docs.merge(pipeline_api::routes::portfolio::PortfolioDoc::openapi())`.

2. **Data access — keep it in two queries, not one.** Two reads:

   - Query A (loan rows). On `LoanDetailsRepo`, add:
     ```rust
     pub async fn list_loans_for_window(
         &self,
         chain_id: i64,
         to_unix: i64,
     ) -> anyhow::Result<Vec<LoanDetailsRow>>
     ```
     SQL: `SELECT … FROM loan_details WHERE chain_id = $1 AND origination_date <= $2 ORDER BY origination_date`. We do **not** filter by `original_maturity_date >= from`: a loan can have a `LoanClosed` event earlier than its `original_maturity_date` (early close) but later than `from`, so end-of-window filtering must happen in compute after lifecycle resolution. The over-fetch is small (loan count for a chain is bounded in the hundreds for the foreseeable future).
   - Query B (lifecycle / repayment rows). New `shared::contract_logs_repo::ContractLogsRepo::list_loan_lifecycle_events(chain_id, to_unix) -> Vec<LifecycleRow>` (create the file if it doesn't exist — there's no existing `contract_logs_repo.rs`). One SQL hit with `event_name = ANY($2) AND chain_id = $1 AND block_timestamp <= $3`, returning:
     ```sql
     SELECT
         event_name,
         block_timestamp,
         (params->>'loan_id')::numeric                AS loan_id,
         (params->>'senior_interest')::numeric        AS senior_interest
     FROM contract_logs
     WHERE chain_id = $1
       AND event_name = ANY($2)               -- ['LoanClosed','LoanDefaulted','LoanRepayment']
       AND block_timestamp <= $3
     ORDER BY block_timestamp, log_index
     ```
     `senior_interest` is `NULL` for non-`LoanRepayment` rows (the JSON key is absent → `params->>'senior_interest'` returns NULL → cast to `Option<BigDecimal>`).

   Two queries (vs. one joined query) keeps the parsing trivially typed (`LoanDetailsRow` is reused as-is) and the indexes optimal: Query A uses `loan_details_origination_idx`, Query B uses `idx_contract_logs_event` (existing) plus the GIN index on `params` (existing).

3. **Compute step — `compute_series(loans, events, from, to, step) -> (Vec<Sample>, Headline)`.** Pure function in `portfolio.rs`. Pre-compute per-loan `end_at`:

   ```
   for each loan in loans:
       scheduled_end = loan.original_maturity_date
       lifecycle_end = MIN over events where event.loan_id == loan.loan_id
                          AND event.event_name in {LoanClosed, LoanDefaulted}
                          of event.block_timestamp
       loan.end_at = min(scheduled_end, lifecycle_end)   // unset lifecycle => scheduled_end
   ```

   Pre-compute realized timeline as a sorted Vec of `(block_timestamp, BigDecimal senior_interest)` from the `LoanRepayment` rows (NULLs filtered).

   Walk the sample grid `t = from, from+step, …` plus the right-edge `to`. For each `t`:
   - `active = loans where loan.origination_date <= t AND t < loan.end_at`
   - `numerator = Σᵢ Pᵢ · R_bps_i` over `active`
   - `denominator = Σᵢ Pᵢ` over `active`
   - `apy_bps = if denominator == 0 { None } else { Some(round(numerator / denominator)) }`
   - `accrued = Σᵢ Pᵢ · R_bps_i · (min(t, loan.end_at) − loan.origination_date) / (10000 · 365 · 86400)` over loans where `loan.origination_date <= t` (i.e. include matured loans for cumulative accrued — they accrued up to `end_at`)
   - `realized = sum of realized timeline entries with block_timestamp <= t`
   - `principal_outstanding = denominator`
   - `active_loan_count = active.len()`

   Use `BigDecimal` throughout; cast time deltas as `BigDecimal::from(i64)`. Emit monetary as `to_string()` with no decimal point (the `truncate(0)` semantics for `BigDecimal` rounds toward zero — call `.with_scale(0)` then `.to_plain_string()`, or document the chosen idiom). Confirm in code review.

   For `headline`: copy `series.last()` fields (or all-zero/null with `as_of = to` when series is empty due to no loans for the chain). Use the wording `current_apy_bps`, `current_accrued_usdc`, `current_realized_usdc`, `current_principal_outstanding_usdc`, `active_loan_count`, `as_of` as documented in the Issue body.

4. **Handler wiring** — `async fn get_yield(State, Query<YieldQuery>) -> impl IntoResponse`:
   - Parse + validate query params (clamp `step`, default `from`/`to`, reject if `from > to` or sample-count over cap → `(StatusCode::BAD_REQUEST, Json(json!({"error": "<message>"})))`). On default `from`: a second tiny query — `SELECT MIN(origination_date) FROM loan_details WHERE chain_id = $1` — added to `LoanDetailsRepo`. If `NULL` (no loans), short-circuit to a "no loans" 200 response with `series: []` and zeroed headline.
   - Call Query A + Query B in sequence (or `tokio::try_join!` — neither is heavy).
   - Call `compute_series`.
   - Return `Json(YieldResponse { chain_id, series, headline })`.
   - On DB error log via `tracing::error!` and return 500 with `{"error":"internal error"}` (same convention as `stats.rs` lines 80-87).

5. **DTOs and OpenAPI** — in `portfolio.rs`:
   ```rust
   #[derive(Deserialize, ToSchema)]
   pub struct YieldQuery {
       pub chain_id: i64,
       pub from: Option<i64>,
       pub to: Option<i64>,
       pub step: Option<i64>,   // default 86400
   }

   #[derive(Serialize, ToSchema)]
   pub struct SamplePoint {
       pub t: i64,
       pub apy_bps: Option<u32>,
       pub accrued_usdc: String,
       pub realized_usdc: String,
       pub principal_outstanding_usdc: String,
       pub active_loan_count: u32,
   }

   #[derive(Serialize, ToSchema)]
   pub struct Headline {
       pub current_apy_bps: Option<u32>,
       pub current_accrued_usdc: String,
       pub current_realized_usdc: String,
       pub current_principal_outstanding_usdc: String,
       pub active_loan_count: u32,
       pub as_of: i64,
   }

   #[derive(Serialize, ToSchema)]
   pub struct YieldResponse {
       pub chain_id: i64,
       pub series: Vec<SamplePoint>,
       pub headline: Headline,
   }

   #[derive(OpenApi)]
   #[openapi(
       paths(get_yield),
       components(schemas(YieldQuery, YieldResponse, SamplePoint, Headline)),
       tags((name = "Portfolio", description = "Portfolio-level yield time series"))
   )]
   pub struct PortfolioDoc;
   ```
   `#[utoipa::path]` block on `get_yield` mirrors `stats::get_daily_prices` (lines 180-193). Status codes: `200`, `400`, `500`.

6. **Spec doc** — write `docs/product-specs/portfolio-yield.md`. Use the format suggested by `docs/product-specs/index.md` (Overview → Behavior → API Contract → Data Model → Security; under 150 lines). Behaviour describes the three series qualitatively (current APY = book yield, accrued = USD interest earned to date, realized = USD repaid to date). Data Model section names the two source tables. Add row to `docs/product-specs/index.md` under "Current entries". Cross-link from `dashboards.md` (one-line addition noting that the *Portfolio Yield* chart on the Protocol Dashboard is sourced from this endpoint).

7. **Clippy / lint** — run `cargo clippy --all -- -D warnings` after every meaningful change. Run `npx tsx scripts/lint-docs.ts` after touching `docs/`.

## Test Strategy

**Unit tests (no DB), inside `packages/api/src/routes/portfolio.rs`.** Use the 3-loan worked example from the Issue body verbatim as a fixture builder:

```rust
fn fixture_loans() -> Vec<LoanDetailsRow> { /* A, B, C with documented params */ }
fn fixture_events() -> Vec<LifecycleRow> { /* empty for the base case */ }
```

Tests:

1. `apy_at_day_0_is_loan_a_only` — `apy_bps == Some(1200)`, `active_loan_count == 1`, `principal_outstanding == "100000000000"` (100k USDC in 6dp).
2. `apy_at_day_30_weighted_average_a_and_b` — `(100k·1200 + 50k·1500) / 150k = 1300 bps`. Asserts `Some(1300)`.
3. `apy_at_day_60_weighted_average_three_loans` — `(100k·1200 + 50k·1500 + 75k·1000) / 225k ≈ 1200 bps` (the rounded value; check exact arithmetic).
4. `accrued_at_day_30_matches_closed_form` — within ±1 base unit of `100_000·0.12·30/365` scaled to 6dp.
5. `accrued_at_day_60_three_loans` — matches `100k·0.12·60/365 + 50k·0.15·30/365`.
6. `apy_null_when_no_active_loans` — pass `t > 180 days`, assert `apy_bps == None`, `active_loan_count == 0`, `principal_outstanding == "0"`, accrued still equals the final cumulative value.
7. `early_close_stops_accrual` — fixture adds a `LoanClosed` event for loan B at day 90 (i.e. before its scheduled day 120 end). Assert accrual contribution of B caps at `(90 - 30) / 365 · 0.15 · 50k`, not `(120 - 30) / 365 · …`.
8. `default_stops_accrual_like_close` — same as #7 but with `LoanDefaulted`. Confirms the two are treated symmetrically.
9. `realized_is_step_function` — fixture adds a `LoanRepayment` for loan A at day 180 with `senior_interest = 5917` (≈ 100k·0.12·180/365). Sample at day 179 → realized = 0; sample at day 180 → realized = 5917; sample at day 200 → realized still 5917.
10. `step_clamp_rejects_out_of_range` — handler-level validation test: `step = 100` → 400; `step = 1_000_000` → 400; `step = 3600` → 200; `step = 604800` → 200.
11. `from_after_to_returns_400` — boundary validation.
12. `sample_count_cap_returns_400` — `to - from = 10 years` with `step = 3600` → 400.

**Integration test in `packages/api/tests/portfolio.rs` (DB-gated, mirrors `tests/emails.rs` setup helper).** Build a small app router, insert two loans + one `LoanRepayment` row + one `LoanClosed` row, hit the endpoint, assert series and headline JSON. Skip when `DATABASE_URL` unset (existing convention).

**Smoke gates.**
- `cargo clippy --all -- -D warnings`
- `cargo clippy --all --tests --all-targets -- -D warnings`
- `cargo test --all` (with `DATABASE_URL` set to exercise the integration path; without it the integration test short-circuits)
- `cargo build --workspace`
- `npx tsx scripts/lint-docs.ts`

## Implementation Status

**Completed** (post-review hardening rolled in).

### Files created / modified

| File | Change |
|------|--------|
| `packages/shared/src/contract_logs_repo.rs` | New — `ContractLogsRepo::list_loan_lifecycle_events` |
| `packages/shared/src/lib.rs` | Register `contract_logs_repo` module |
| `packages/shared/src/loan_details_repo.rs` | Added `list_loans_for_window` + `get_earliest_origination_date` |
| `packages/api/src/lib.rs` | Added `loan_details_repo` + `contract_logs_repo` fields to `AppState` |
| `packages/api/src/main.rs` | Instantiate new repos; wire portfolio router + OpenAPI doc |
| `packages/api/src/routes/mod.rs` | Register `pub mod portfolio` |
| `packages/api/src/routes/portfolio.rs` | New — DTOs, compute (`pub fn compute_series`), handler |
| `packages/api/tests/portfolio_compute.rs` | New — 13 compute-layer tests against the 3-loan worked example. Pure unit tests, no DB. |
| **Removed in this PR** — DB-gated env-var-controlled integration tests: `packages/api/tests/emails.rs`, `packages/shared/tests/loan_details_repo.rs`, `packages/worker/tests/loan_mapper.rs`, `packages/worker/tests/indexer_integration.rs`. See "Test-suite policy change" below. |
| `docs/product-specs/portfolio-yield.md` | New spec |
| `docs/product-specs/index.md` | Added row for new spec |
| `docs/product-specs/dashboards.md` | Added "Portfolio Yield chart" subsection cross-linking the spec |

### Deviations from the plan (recorded after the user-driven review)

1. **`from > to` UX softening (A2 of post-impl review).** Plan / Issue body said "HTTP 400 if `from > to`." Implementation distinguishes the two cases:
   - Caller *explicitly* sets `from > to` → HTTP 400 (matches plan).
   - Caller *omits* `from` AND the defaulted value (earliest origination date) is past `to` → HTTP 200 with `series: []` and zeroed headline. Returning 400 about a parameter the caller never set was confusing.
   Documented in `docs/product-specs/portfolio-yield.md` validation section.

2. **Window cap replaced with sample-count cap (A5 of post-impl review).** Plan said `to - from <= 5 years`; implementation caps `(to - from) / step + 1 <= 5_000` instead. This is a tighter, more honest bound — daily samples → ~13 years allowed, weekly → ~100 years, hourly → ~7 months. Eliminates the multi-second-response failure mode for hourly + multi-year requests.

3. **Defensive `(t − start).max(0)` clamp (A4 of post-impl review).** Plan didn't address pathological data; implementation clamps `active_secs` to ≥ 0 to guard against a hypothetical `LoanClosed.block_timestamp < origination_date` (re-org artifact).

4. **Test file split + relocation (per user request, then convention review).** Compute-layer tests live in `packages/api/tests/portfolio_compute.rs` — sibling of the HTTP integration test, matching the project-wide convention (all tests in `tests/`, no inline-but-separate files in `src/`, feature-named, no `_tests.rs` suffix). Three tautological tests (asserting Rust stdlib facts and constants) were removed; two real-coverage tests were added (`lifecycle_event_after_scheduled_maturity_does_not_extend_loan`, `realized_sums_multiple_repayments_for_same_loan`). `compute_series` is `pub` so the integration-test crate can access it.

5. **Accrued truncation timing.** Plan was silent; implementation sums in `BigDecimal` across all loans first and truncates once at the end. Avoids double-rounding and is semantically correct.

### Gate outcomes

- `cargo clippy --all -- -D warnings`: **clean**
- `cargo clippy --all --tests --all-targets -- -D warnings`: **clean**
- `cargo test --all`: **13 compute-layer unit tests pass. No DB-gated tests anywhere in the workspace** (see policy change below). Operator smoke-tests SQL- and HTTP-layer correctness manually (e.g. `cargo run -p pipeline-api` + `curl /v1/portfolio/yield?chain_id=...`).

### Test-suite policy change (this PR)

Removed all four pre-existing env-var-gated DB integration tests:

| Deleted file | What it tested |
|---|---|
| `packages/api/tests/emails.rs` | HTTP layer of the `/v1/emails` endpoint against a live DB. |
| `packages/shared/tests/loan_details_repo.rs` | `LoanDetailsRepo` SQL behaviour (#363). |
| `packages/worker/tests/loan_mapper.rs` | `LoanMintedMapper` end-to-end against a real Postgres (#363). |
| `packages/worker/tests/indexer_integration.rs` | Indexer cursor / dedup / cross-chain isolation. |

Rationale: every DB-gated test in the suite read `DATABASE_URL` (some via `POSTGRES_URL` fallback + `dotenvy`) to connect to a Postgres instance. In practice this meant: developers either set the env var to their dev DB (polluting it on every `cargo test --all`), or set it to a separate test DB (extra setup overhead, frequent migration-checksum surprises, sentinel-row accumulation between runs). The operator's preference, settled this PR, is: **no automated test connects to a real Postgres**. Pure unit tests cover compute layers; SQL/HTTP correctness is verified by `cargo sqlx prepare` at compile-time and manual smoke testing.

Unit-test coverage that survives:
- `shared/tests/metadata_fetcher.rs` — 8 mockito-backed HTTP tests for the fetcher (#363).
- `shared/tests/crystal.rs`, `eip712.rs`, `sumsub_signing.rs`, `webhook_models.rs` — pure unit tests.
- `worker/tests/mappers.rs`, `parsers.rs`, `price_poller.rs` — pure unit tests (mock pool only).
- `api/tests/portfolio_compute.rs` — 13 compute-layer tests (this PR).
- `api/tests/webhook_validation.rs` — pure unit tests.

Saved as feedback memory `feedback_tests_no_env_db_url.md` so the policy survives across sessions.
- `npx tsx scripts/lint-docs.ts`: **0 errors, 30 pre-existing warnings**

---

## Docs to Update

- **New spec**: `docs/product-specs/portfolio-yield.md`. Title "Portfolio Yield API"; sections Overview → Behavior → API Contract → Data Model → Security. Document the three series, the API contract (verbatim from the Issue body), the data sources, the decimal/string conventions, the `apy_bps = null` semantics, and the explicit out-of-scope (caching, per-LP, amortisation, cross-chain).
- **Index registration**: add one row to `docs/product-specs/index.md` under "Current entries".
- **Cross-link**: one-line addition to `docs/product-specs/dashboards.md` (Protocol Dashboard "Trailing yield" subsection) pointing to the new spec — explicitly contrast "book yield" (this endpoint) vs. "cumulative yield minted into vault" (existing `RepaymentSettled`/USYC-driven counter).
- **Tech-debt-tracker**: only if implementation surfaces ambiguity (e.g. defaulted-loan accrual treatment differs from the simple rule). The Issue body explicitly invites this. No proactive entry needed.
- **`docs/exec-plans/active/` lifecycle**: this plan moves to `docs/exec-plans/completed/` after the PR merges (manager-owned).
- **OpenAPI**: `YieldDoc::openapi()` is merged into the master doc at server startup; `/swagger` exposes the new endpoint automatically. No separate spec file to update.

---

## Subsequent changes (post-original-plan)

The history above describes the original plan and the deltas relative to it. After post-implementation review, the following further changes were made:

1. **Route moved to `/v1/stats/yield`.** Originally `/v1/portfolio/yield`. The URL now lives next to `/v1/stats/prices` and `/v1/stats`; the file remains `routes/portfolio.rs` (since `yield` is a Rust keyword and the data is still portfolio-level). The OpenAPI doc bundle is renamed `PortfolioDoc` → `YieldDoc` with tag `"Yield"`.
2. **Sample-count cap lowered `5_000` → `1_000`.** With daily samples this allows ~2.7 years (was ~13); weekly ~19 years (was ~100); hourly ~42 days (was ~7 months). Applied uniformly to `/v1/stats/yield` and `/v1/stats/prices`; `/v1/stats` caps `apy_days` at 1_000 days.
3. **Shared formatting helpers extracted to `packages/api/src/formatting.rs`.** Local `iso_utc` / `to_usdc_6dp` in `portfolio.rs` moved to module-scope helpers `iso_utc`, `iso_utc_from_unix`, `base6_to_decimal_string`. Used by both `portfolio.rs` and `stats.rs`. Backed by a `LazyLock<BigDecimal>` cached divisor and seven inline unit tests.
4. **`/v1/stats/prices` full-history cap.** Added `PositionRepo::get_earliest_price_timestamp`. When `days` is omitted, the implicit window starts at the earliest recorded price for the vault; the same `MAX_SAMPLES` cap applies. Mirrors `/v1/stats/yield`'s full-history bound (earliest origination date).
5. **`/v1/stats` and `/v1/stats/prices` migrated to `ApiError`.** Replaced the inline `match { Err => 500 }` pattern with `Result<Json<T>, ApiError>` and `?` propagation. Matches `/v1/stats/yield`. `/v1/stats/vaults` migrated for consistency.
