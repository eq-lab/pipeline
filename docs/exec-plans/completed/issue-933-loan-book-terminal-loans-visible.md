# Issue #933: Show Default/Closed loans as visible rows in GET /v1/loan-book

Source: https://github.com/eq-lab/pipeline/issues/933

## Scope

`GET /v1/loan-book`'s `loans[]` array currently only contains loans in the **active** set
(`origination_date <= to && to < effective_end`, where `effective_end` is the earliest
`LoanClosed`/`LoanDefaulted` lifecycle timestamp). A loan drops out of `loans[]` entirely the
instant it defaults or closes, even though it's correctly indexed into `contract_logs` and
still feeds the `at_risk_wl_and_default_*` summary aggregates.

This plan makes `Default` and `Closed` loans visible as rows in `loans[]`, while:

- Summary aggregates (`total_deployed`, `deployed_senior`, `avg_yield`, `avg_duration_days`,
  `total_collateral`, `senior_debt_coverage`, `top_concentration`, `weighted_rate`,
  `weighted_tenor_days`) continue to be computed over the **active** set only — unchanged
  semantics, no double-counting with the existing `at_risk_wl_and_default_*` metrics.
- Ordering: active loans first (existing principal-descending sort, unchanged), then terminal
  (Default/Closed) loans, themselves sorted by principal descending.

**Out of scope:** `routes::portfolio::compute_series` (same exclude-on-default pattern, but
different point-in-time accrual semantics — a separate follow-up if wanted), any frontend
wiring, any change to `at_risk_wl_and_default_*` computation.

## Assumptions and Risks

- **`display_status()` needs no change.** Per its doc comment (`packages/api/src/routes/loan_book.rs:55`),
  terminal on-chain states (`Default`, `Closed`) are never overridden by the `Disbursing`/`Past
  Due` derived statuses — so a terminal loan's entry will correctly show `"Default"` or
  `"Closed"` as-is once it's included in the loop.
- **`watchlist_entered_at`/`days_on_watchlist` need no change.** Already gated on `s.status ==
  "WatchList"` (line 1279), so they naturally come out `None` for Default/Closed entries.
- **Collateral/spot maps are unconditional by loan_id**, not filtered by active status — a
  terminal loan's `collateral`/`ltv`/`ccr_bps`/`spot_price`/`spot_change_7d` fields populate
  the same way an active loan's would, no extra plumbing needed.
- **Division-by-zero risk**: `avg_yield`/`avg_duration_days` (lines 1326-1333) currently divide
  unconditionally by `total_deployed`, safe today only because the old guard
  (`if active.is_empty() { return empty_response(); }`) ensured `active` (and thus
  `total_deployed`) was non-empty whenever this code runs. Once the guard is relaxed to `if
  active.is_empty() && terminal.is_empty()`, `active` can be empty while `terminal` isn't —
  this must be explicitly guarded (see step 4) or it will panic on the empty-active/
  terminal-only case.
- **`active_keys` (line 1350) must still be built from `active` only**, not `active ∪
  terminal` — the at-risk loop uses `!active_keys.contains(&key)` to add extra collateral for
  at-risk-but-inactive (i.e. defaulted) loans; this logic is unaffected by this change and
  must not be touched.

## Open Questions

_None._ Aggregate-inclusion, Closed-loan visibility, and scope (loan-book only, not
portfolio.rs) were all resolved in conversation before this plan was written (see issue body).

## Implementation Steps

All in `packages/api/src/routes/loan_book.rs` unless noted.

1. **Extract per-loan entry construction into a helper.** The current single loop (lines
   ~1216-1323) interleaves building each `LoanBookEntry` (status, collateral, ltv, ccr_bps,
   spot, watchlist fields) with accumulating the summary aggregates. Pull the entry-building
   part into a private helper:
   ```rust
   struct EntryComputation {
       entry: LoanBookEntry,
       principal: BigDecimal,
       outstanding_senior: BigDecimal,
       rate_bps: u32,
       duration_days: i64,
       collateral: Option<BigDecimal>,
       commodity: String,
   }

   fn build_loan_entry<S: std::hash::BuildHasher>(
       loan: &LoanSnapshotRow,
       to: i64,
       collateral_by_loan: &HashMap<String, BigDecimal, S>,
       spot_by_loan: &HashMap<String, LoanSpot, S>,
       disbursement_by_loan: &HashMap<String, bool, S>,
       watchlist_entry_by_loan: &HashMap<String, i64, S>,
   ) -> EntryComputation
   ```
   Move the existing per-loan logic (principal/duration/rate calc, collateral/ltv/ccr lookup,
   spot lookup, `display_status` call, watchlist calc, `LoanBookEntry` construction) into this
   function body verbatim; return the numeric ingredients the caller needs for aggregation
   alongside the built entry.

2. **Add a `terminal` loan set alongside `active`.** After the existing `active` vec + sort
   (~line 1188-1192), add:
   ```rust
   let mut terminal: Vec<&LoanSnapshotRow> = loans
       .iter()
       .filter(|loan| loan.snapshot.origination_date <= to && to >= effective_end(loan, events))
       .collect();
   terminal.sort_by_key(|loan| std::cmp::Reverse(principal_of(loan)));
   ```

3. **Relax the early-return guard.** Change
   `if active.is_empty() { return empty_response(); }`
   to
   `if active.is_empty() && terminal.is_empty() { return empty_response(); }`.

4. **Rewrite the entry-building loop.** Replace the current `for loan in &active { ... }` body
   with a call to `build_loan_entry`, folding the returned numeric fields into the existing
   aggregate accumulators (`total_deployed`, `weighted_rate_bps`, `weighted_duration`,
   `total_senior`, `total_outstanding_senior`, `senior_by_commodity`, `total_collateral`,
   `any_collateral`) exactly as today. Then add a second loop over `terminal` that calls
   `build_loan_entry` and pushes `.entry` into `entries` **without** touching any aggregate
   accumulator. `entries` capacity becomes `active.len() + terminal.len()`.

5. **Guard `avg_yield`/`avg_duration_days` against an empty active set.** Wrap both in
   `(total_deployed > zero).then(|| ...)`, matching the `Option` types already declared on
   `LoanBookSummary` and the guard style already used for `senior_debt_coverage` /
   `total_collateral_str` / `top_concentration`. `weighted_rate`/`weighted_tenor_days` already
   just clone `avg_yield`/`avg_duration_days`, so no separate change needed there.

6. **Leave the at-risk loop (lines ~1344-1380) untouched** — it already iterates the full
   `loans` slice and keys `active_keys` off `active` (unaffected by `terminal`).

7. **Update doc comments:**
   - `LoanBookResponse.loans` (line 273-274): "Active loans, sorted by principal descending" →
     note it now includes terminal (Default/Closed) loans appended after the active set.
   - `effective_end()` (lines 1131-1139) and `compute_loan_book` (lines 1152-1159): both
     currently describe Default/Closed as excluded from "the loan book" — reword to clarify
     `effective_end` now gates only the **aggregate/active** set, not row visibility.

## Test Strategy

All in `packages/api/tests/loan_book.rs` (pure compute-layer tests, no HTTP/DB).

Update three existing tests that assert the old exclude-from-`loans` behavior:

- `weighted_rate_and_tenor_null_when_no_active_loans` (line 237-246): currently asserts
  `r.loans.is_empty()`. Change to assert `r.loans.len() == 2`, both entries' `status ==
  "Closed"`, while `weighted_rate`/`weighted_tenor_days` stay `None`.
- `closed_loan_excluded_via_lifecycle_event` (line 301-313): rename to something like
  `closed_loan_visible_but_excluded_from_active_aggregates`; assert `r.loans.len() == 2`, the
  closed loan's entry has `status == "Closed"`, and `r.summary.total_deployed` reflects only
  the still-active loan's principal.
- `no_active_loans_returns_empty_book` (line 315-324): rename to
  `no_active_loans_still_shows_terminal_loans`; assert `r.loans.len() == 2` (both `Closed`)
  while `summary.total_deployed == "0.000000"` and `avg_yield`/`avg_duration_days` stay `None`.

Add new tests (reuse `fixture_loans()` / `event()` / `at()` / `at_with()` helpers):

- A loan with a `LoanDefaulted` event shows up in `r.loans` with `status == "Default"`, and is
  excluded from `total_deployed`/`deployed_senior` (reuse the loan-3 `LoanDefaulted` fixture
  pattern already used around lines 450-458 for at-risk tests).
- Sort order: give a terminal loan the largest principal in the fixture set and confirm it
  still sorts *after* all active entries (active-first, then terminal-by-principal — not one
  merged sort).

Re-run (no logic change expected, but confirm still green):
`empty_registry_returns_empty_book` (line 326-340), `collateral_coverage_null_without_prices`
(line 342-353).

## Docs to Update

- `docs/product-specs/trustee-dashboard.md` line 172 — the "Loans page (`GET /v1/loan-book`)"
  row's at-risk tile description currently reads "...WatchList/Default across all open loans,
  including defaulted ones dropped from the active set". Update the trailing clause to reflect
  that defaulted (and closed) loans are now visible in `loans[]` with their raw status, just
  excluded from the active-set aggregates — file is at the 200-line doc-lint cap, so edit this
  line's wording in place rather than adding new lines.
- On completion, move this plan to `docs/exec-plans/completed/` (manager step).
