# Issue #833: Loan Book API — Trustee "Loans" page portfolio metrics

Source: https://github.com/eq-lab/pipeline/issues/833

## Scope

Extend `GET /v1/loan-book` (`packages/api/src/routes/loan_book.rs`) so its `LoanBookSummary` serves the five portfolio-wide tiles on the Trustee "Loans" page (`trustee-dashboard-prototype-v4_1.html`, `screenLoans()` ~L730). The tiles are portfolio-wide (they do not change per Performing/Watchlist/Default/Closed tab).

Decisions (resolved with the requester):

| Tile | Decision | Implementation |
|------|----------|----------------|
| **Deployed senior** | Σ senior tranche, active loans | Expose the already-computed `total_senior` as a new field. |
| **At-risk (WL + Default)** | Classify **by status ∈ {WatchList, Default}** over **all open loans** (originated, not Closed — **including defaulted** loans the active-time filter drops). Relative % over **NAV**: `at_risk_senior / total_collateral`. | New pass over the full `loans` slice; new `at_risk_senior` (absolute) + `at_risk_pct` fields. |
| **Weighted rate** | Principal-weighted over active loans | Dedicated field `weighted_rate` (same value/method as `avg_yield`, which stays for the Protocol Dashboard). |
| **Weighted tenor** | Principal-weighted over active loans | Dedicated field `weighted_tenor_days` (same value as `avg_duration_days`, which stays for the Protocol Dashboard). |
| **Top concentration** | Largest single-commodity exposure by **senior share** over active loans; return `{ commodity, share }`, **no limit** (frontend owns the limit constant). | New `top_concentration` nested field. |

### Scope addendum — Loans **table** columns (folded in on review)

The table header (`Originator · Commodity·spot · Senior outst. · Collateral · CCR · Maturity · Stage`) needed per-loan fields the endpoint didn't return, so `LoanBookEntry` also gains:

| Column | Field | Source |
|--------|-------|--------|
| Senior outst. | `senior_outstanding` | `original_senior_tranche − senior_principal_repaid` (already computed for CCR) |
| Maturity | `maturity` (i64) | `current_maturity_timestamp` (rollover-aware) |
| CCR age | `ccr_reported_at` (i64) | `last_reported_ccr_timestamp` |
| Commodity · spot | `spot_price`, `spot_change_7d` | latest price for the loan's anchor asset/provider; 7-day change vs. `prices_as_of(to − 7d)` |

Spot pricing adds a `LoanAssetPriceRepo::prices_as_of(cutoff)` query and a handler-side `spot_by_loan` builder; `compute_loan_book` gains a `spot_by_loan: &HashMap<String, LoanSpot, S>` parameter (pure — the DB glue stays in the handler, mirroring `collateral_by_loan`).

Out of scope:
- No new endpoint — additive fields on the existing `LoanBookSummary` (non-breaking for the Protocol Dashboard loan-book consumer).
- No `weighted_rate` / `weighted_tenor` fields — they duplicate `avg_yield` / `avg_duration_days`; the plan documents the mapping instead. (If the frontend prefers explicit aliases, trivial to add later.)
- No policy-limit source (the 10% limit is frontend-owned per the decision).
- No DB migration.

## Assumptions and Risks

- **At-risk population vs. active set.** The existing active filter is `origination_date <= now < effective_end`, and `effective_end` is set by a `LoanClosed` **or** `LoanDefaulted` event — so defaulted loans are excluded from `active`. The at-risk metric therefore iterates the **full `loans` slice** independently: include a loan when `origination_date <= now`, it has **no `LoanClosed` event at/before now** (a `LoanDefaulted` event does **not** disqualify it), and `status ∈ {WatchList, Default}`.
- **At-risk numerator** = Σ outstanding senior (`original_senior_tranche − senior_principal_repaid`) over at-risk loans → the absolute figure ($4.85M in the mock).
- **At-risk denominator** = the summary's existing `total_collateral` (active-set NAV). This is a deliberate NAV denominator per the decision; note the mild population asymmetry (numerator may include non-active defaults, denominator is active collateral). `at_risk_pct` is `null` when `total_collateral` is unavailable (no priced loans) or zero.
- **Top concentration** is computed over the **active** set by senior tranche. `null` only when `total_senior == 0`.
- Risk: `main` has evolved (loan-book now has `ccr_bps`, collateral valuation). Plan is written against current `main` (`compute_loan_book<S>(loans, events, to, collateral_by_loan)`).

## Open Questions

_None._ (All five metric definitions resolved; weighted-rate/tenor reuse and additive-DTO placement confirmed as defaults.)

## Implementation Steps

1. **DTO — `LoanBookSummary`** (`loan_book.rs` ~L53). Add fields (additive, keep existing order first):
   ```rust
   /// Σ senior tranche over active loans, USDC (6-decimal string). Distinct from
   /// `total_deployed`, which includes the equity tranche.
   pub deployed_senior: String,
   /// Σ outstanding senior (`original_senior_tranche − senior_principal_repaid`) of
   /// at-risk loans — status WatchList or Default, over all open (originated,
   /// non-closed) loans, including defaulted ones. USDC 6-decimal string; "0.000000"
   /// when none.
   pub at_risk_senior: String,
   /// `at_risk_senior / total_collateral` (NAV), 4-decimal fraction string. `null`
   /// when `total_collateral` is unavailable or zero.
   pub at_risk_pct: Option<String>,
   /// Largest single-commodity exposure by senior share over active loans. `null`
   /// when Σ senior is zero.
   pub top_concentration: Option<TopConcentration>,
   ```
   Add the nested DTO:
   ```rust
   #[derive(Debug, Serialize, ToSchema)]
   pub struct TopConcentration {
       /// Underlying commodity with the largest senior exposure.
       pub commodity: String,
       /// That commodity's share of Σ senior, 4-decimal fraction (e.g. "0.0720").
       pub share: String,
   }
   ```

2. **Compute — `compute_loan_book`** (`loan_book.rs` ~L688):
   - `deployed_senior` = `base6_to_decimal_string(&total_senior)` (already accumulated).
   - **At-risk pass** over the full `loans` slice (independent of `active`): helper `fn is_closed(loan, events, to) -> bool` (any `LoanClosed` event for that `loan_id` with `block_timestamp <= to`). Accumulate `at_risk_senior = Σ (original_senior_tranche − senior_principal_repaid)` for loans where `origination_date <= to && !is_closed(..) && matches!(status.as_str(), "WatchList" | "Default")`.
   - `at_risk_pct` = `(any_collateral && total_collateral > 0).then(|| (&at_risk_senior / &total_collateral).with_scale_round(4, HalfUp).to_plain_string())`.
   - **Top concentration**: fold `active` into a `HashMap<String /*commodity*/, BigDecimal /*senior*/>`; pick max by value; `share = (max_senior / total_senior).with_scale_round(4, HalfUp)`; build `Some(TopConcentration{..})` when `total_senior > 0`.
   - Populate the four new fields in the returned `LoanBookSummary`.
3. **`empty_response`** (`loan_book.rs` ~L811): `deployed_senior: "0.000000"`, `at_risk_senior: "0.000000"`, `at_risk_pct: None`, `top_concentration: None`.
4. **OpenAPI** — add `TopConcentration` to the `#[openapi(components(schemas(...)))]` list on `LoanBookDoc`.
5. **Lint/build gate** — `cargo clippy --all -- -D warnings` and `cargo build`.

## Test Strategy

Extend `packages/api/tests/loan_book.rs` (compute-layer, no DB/HTTP; pure). Add a status parameter (or a `make_loan_status` variant) and a `LoanDefaulted`/`LoanClosed` event helper.

- `deployed_senior` sums senior only (excludes equity), over active loans.
- **At-risk includes a defaulted loan excluded from `active`**: build a loan with a `LoanDefaulted` event before `now` and `status = "Default"`; assert it is absent from `loans[]` (active table) yet contributes to `at_risk_senior`.
- At-risk counts a `WatchList` loan; excludes `Performing`; excludes a `LoanClosed` loan even if status is stale.
- `at_risk_pct` = `at_risk_senior / total_collateral` with a supplied collateral map; `null` when no collateral priced.
- `at_risk_senior == "0.000000"` and `at_risk_pct == null`/computed when all performing.
- **Top concentration** aggregates multiple loans of the same commodity (e.g. two "Cocoa" loans) and picks the max share; `share` value correct; ties resolved deterministically.
- `empty_response` (no active loans) → new fields defaulted.
- Existing `avg_yield` / `avg_duration_days` assertions remain green (they double as Weighted rate / Weighted tenor).

## Docs to Update

- `docs/product-specs/` loan-book / trustee section: document the four new summary fields and note that the Trustee "Weighted rate"/"Weighted tenor" tiles reuse `avg_yield` / `avg_duration_days`.
- Run `npx tsx scripts/lint-docs.ts` after doc edits. OpenAPI is regenerated from the `utoipa` annotations.
