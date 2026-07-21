# Issue #894: Loan Book API: add senior-deployed, repaid-to-date, disbursed, days-on-watchlist per loan

Source: https://github.com/eq-lab/pipeline/issues/894

## Scope

Add four new fields to each entry of `GET /v1/loan-book` (`LoanBookEntry` in `packages/api/src/routes/loan_book.rs`):

- **`original_senior_tranche`** (`String`, USDC 6-decimal) — the loan's original/deployed senior tranche (as opposed to the existing `senior_outstanding`, which nets off repayment).
- **`repaid_to_date`** (`String`, USDC 6-decimal) — cumulative offtaker cash received to date.
- **`disbursed`** (`bool`) — whether the loan's USDC off-ramp has been marked complete.
- **`days_on_watchlist`** (`Option<i64>`) — days since the loan's most recent transition into `WatchList` status; `null` unless the loan's current status is `WatchList`.

Per the issue's resolved decisions (see issue body + comments):
- Scoped to `GET /v1/loan-book` (the list) only — **not** `GET /v1/loan-book/{loan_id}/financials`. This does not by itself unblock #874 (whose loan-detail tiles read `/financials`); that would need a separate follow-up if pursued.
- `disbursed` is a boolean flag, not a computed amount string (the protocol has no partial-disbursement amount, only the binary off-ramp-complete flag already tracked by `loan_disbursement_repo`).
- Field naming avoids reusing "deployed" for the per-loan senior field, since `LoanBookSummary.deployed_senior` already means Σ **outstanding** senior across the book — a different quantity. `original_senior_tranche` mirrors the on-chain/`EconomicsInput` field name and sits naturally next to the existing `senior_outstanding`.

**Out of scope:** `/financials` changes, any frontend wiring (trustee package), any change to the existing `senior_outstanding` / `deployed_senior` semantics.

## Assumptions and Risks

- **`repaid_to_date` = `repayment.offtaker_received`.** Verified against the trustee prototype's own mock data: the Helios loan shows "Repaid to date $6.30M" and, in the same screen's "Recorded counters" line, "offtaker $6.30M" — same figure. This is the cumulative-cash-received basis, not a senior-principal-only figure. Documented as an assumption rather than a hard product confirmation (per #874's flagged open question), but the evidence is direct and specific enough to proceed without blocking.
- **`days_on_watchlist` = time since the *most recent* transition into `WatchList`**, not the first-ever transition (i.e., if a loan left and re-entered `WatchList`, the counter resets). Matches the mock's "18 days · since 3 Jun" framing for an actively-watchlisted loan. Implemented via `DISTINCT ON (loan_id) ... ORDER BY block_timestamp DESC` (see step 2), which structurally encodes "most recent" — no extra logic needed to choose between "first" and "most recent," the query only supports "most recent."
- **`LoanStatusUpdated` params shape.** Confirmed in `packages/worker/src/indexer/parsers.rs::parse_loan_status_updated` (EVM) and the Stellar equivalent (`packages/worker/src/indexer/stellar/loan_registry_parsers.rs`) that `LoanStatusUpdated` rows store `params = {"loan_id": ..., "status": "<name>"}` — a **flat** `params->>'status'`, distinct from other event types' `params->'snapshot'->>'status'` (nested). The new query (step 2) must read the flat key; do not copy `latest_status_by_loans`'s nested-path pattern.
- **Edge case: `days_on_watchlist` can be `None` even when `status == "WatchList"`** if no matching `LoanStatusUpdated → WatchList` event is found before `to` (e.g., pre-migration data gaps). This is an acceptable, documented fallback — not a bug to guard against further.
- **`compute_loan_book` stays pure (no DB calls).** The new `days_on_watchlist` map must be fetched in `handle_loan_book` (like `disbursement_by_loan` already is) and passed in as a new parameter, not queried inside `compute_loan_book`.
- **Test-call-site fan-out.** `compute_loan_book(...)` is called at 9 sites in `packages/api/tests/loan_book.rs` (lines 133, 150, 166, 325, 520, 646, 661, 676, 692 as of this plan) — every call site needs the new 7th parameter added (an empty `&HashMap::new()` where the tests don't care about watchlist timing).

## Open Questions

_None._ The two decisions #874 flagged (repaid-to-date basis, senior original-vs-outstanding) are resolved in Scope above with direct evidence from the prototype mock; the "most recent vs first-ever watchlist entry" question is resolved by the query design in Assumptions and Risks. Field names, types, and every call site are concrete below.

## Implementation Steps

1. **Extend `LoanBookEntry`** (`packages/api/src/routes/loan_book.rs`, after the existing `senior_outstanding` field, ~line 193): add
   ```rust
   /// Original senior tranche (deployed), USDC (6-decimal string) — distinct from
   /// `senior_outstanding` (net of repayment) and from `LoanBookSummary.deployed_senior`
   /// (the book-wide Σ *outstanding* senior). Backs the "Facility / senior" tile pairing
   /// with `principal`.
   pub original_senior_tranche: String,
   ```
   and after `documents` (end of struct, ~line 239):
   ```rust
   /// Cumulative offtaker cash received to date, USDC (6-decimal string). Backs the
   /// "Repaid to date" tile (`RepaymentSnapshot.offtaker_received`).
   pub repaid_to_date: String,
   /// Whether the loan's USDC off-ramp has been marked complete. Backs the
   /// "Facility / disbursed" tile (paired with `principal`, the facility amount).
   /// Mirrors the flag already used internally to derive the `Disbursing` status
   /// override (see [`display_status`]) — the protocol tracks only this binary
   /// flag, no partial-disbursement amount.
   pub disbursed: bool,
   /// Days since the loan's most recent transition into `WatchList` status.
   /// `null` unless the loan's current `status` is `WatchList`, or (rare) no
   /// matching on-chain transition event is found before `to`.
   pub days_on_watchlist: Option<i64>,
   ```
   Add all four to `LoanBookDoc`'s `components(schemas(...))` list is unnecessary (they're fields of an already-listed schema, `LoanBookEntry` — utoipa picks them up automatically via `ToSchema` derive; no separate registration needed).

2. **Add a new repo query** in `packages/shared/src/contract_logs_repo.rs`, near `latest_status_by_loans` (~line 307): a method that returns, per loan on a chain, the timestamp of the most recent `LoanStatusUpdated → WatchList` transition at or before `to`:
   ```rust
   /// Per-loan timestamp of the most recent `LoanStatusUpdated` transition into
   /// `WatchList`, at or before `to_unix`. Absent for a loan with no such transition.
   /// Backs the Loan Book `days_on_watchlist` field — `LoanStatusUpdated.params` is
   /// FLAT (`params->>'status'`), unlike other event types' nested
   /// `params->'snapshot'->>'status'` (see `latest_status_by_loans`).
   pub async fn latest_watchlist_entry_by_chain<'e, E>(
       &self,
       executor: E,
       chain_id: i64,
       to_unix: i64,
   ) -> anyhow::Result<Vec<(bigdecimal::BigDecimal, i64)>>
   where
       E: sqlx::Executor<'e, Database = sqlx::Postgres>,
   {
       let rows = sqlx::query_as::<_, (bigdecimal::BigDecimal, i64)>(
           "SELECT DISTINCT ON ((params->>'loan_id')::numeric)
                (params->>'loan_id')::numeric AS loan_id,
                block_timestamp
            FROM contract_logs
            WHERE chain_id = $1
              AND event_name = 'LoanStatusUpdated'
              AND params->>'status' = 'WatchList'
              AND block_timestamp <= $2
            ORDER BY (params->>'loan_id')::numeric, block_timestamp DESC, log_index DESC",
       )
       .bind(chain_id)
       .bind(to_unix)
       .fetch_all(executor)
       .await?;
       Ok(rows)
   }
   ```
   Follow the file's existing `sqlx::query_as::<_, (Type, Type)>` tuple-row pattern (matches `latest_status_by_loans`'s return shape) rather than introducing a new named row struct, since only two columns are needed.

3. **Wire it into `handle_loan_book`** (`packages/api/src/routes/loan_book.rs`, ~line 847, alongside the existing `disbursement_by_loan` fetch): add
   ```rust
   // Per-loan timestamp of the most recent WatchList entry, keyed by loan_key.
   // Backs `days_on_watchlist` — absent → no known transition (null field).
   let watchlist_entry_by_loan: HashMap<String, i64> = state
       .contract_logs_repo
       .latest_watchlist_entry_by_chain(&state.pool, chain_id, to)
       .await?
       .into_iter()
       .map(|(loan_id, ts)| (loan_key(&loan_id), ts))
       .collect();
   ```
   and pass `&watchlist_entry_by_loan` as a new final argument to `compute_loan_book(...)`.

4. **Extend `compute_loan_book`'s signature** (~line 1039) with a 7th parameter:
   ```rust
   watchlist_entry_by_loan: &HashMap<String, i64, S>,
   ```
   (matching the existing generic-hasher pattern used by `collateral_by_loan` / `spot_by_loan` / `disbursement_by_loan`).

5. **Populate the four new fields** inside the per-loan entry-building loop (~line 1076–1165):
   - `original_senior_tranche: base6_to_decimal_string(&s.original_senior_tranche)`
   - `repaid_to_date: base6_to_decimal_string(&s.repayment.offtaker_received)`
   - `disbursed: off_ramp_complete` (reuse the `off_ramp_complete` local already computed a few lines above for the `Disbursing` status derivation — do not recompute).
   - `days_on_watchlist: (s.status == "WatchList").then(|| watchlist_entry_by_loan.get(&loan_key(&loan.loan_id)).map(|&entered_at| (to - entered_at) / SECS_PER_DAY)).flatten()`

6. **Update `empty_response()`** — no change needed; it returns `loans: vec![]`, so no per-loan fields to populate there.

7. **Fix all 9 `compute_loan_book(...)` call sites** in `packages/api/tests/loan_book.rs` (lines 133, 150, 166, 325, 520, 646, 661, 676, 692) to pass a 7th argument — `&HashMap::new()` for tests that don't exercise watchlist timing, or a purpose-built map (see Test Strategy) for the new watchlist-specific tests.

## Test Strategy

All in `packages/api/tests/loan_book.rs` (pure compute-layer tests, no HTTP/DB, matching the file's existing convention):

- **`original_senior_tranche`**: assert it equals the fixture's senior-tranche input (in `usdc()` units) and is distinct from `senior_outstanding` once a partial repayment is simulated (reuse/extend an existing repayment fixture, e.g. wherever `senior_principal_repaid` is already set non-zero for the CCR/LTV tests).
- **`repaid_to_date`**: a fixture with non-zero `offtaker_received` in `RepaymentSnapshot` (extend `zero_repayment()` usage at one call site, or add a small helper `repayment_with(offtaker_received: i64)`), assert the field matches `base6_to_decimal_string`.
- **`disbursed`**: reuse the existing disbursement fixtures/tests around the `Disbursing` status (`disbursement_by_loan` map already has `true`/`false`/absent-key coverage per `display_status`'s doc comment) — add assertions that `disbursed` mirrors `off_ramp_complete` for at least one `true` and one `false`/absent case.
- **`days_on_watchlist`**:
  - Loan with `status == "WatchList"` and a `watchlist_entry_by_loan` entry → assert `days_on_watchlist == Some((to - entered_at) / DAY)`.
  - Loan with `status == "WatchList"` but **no** entry in `watchlist_entry_by_loan` → assert `None` (documented fallback).
  - Loan with `status == "Performing"` (or any non-WatchList status) **and** a stale `watchlist_entry_by_loan` entry (simulating a loan that *previously* was watchlisted) → assert `None` (the field must not leak a stale watchlist age once the loan has left `WatchList`).
- Add one `empty_registry_returns_empty_book`-style regression check that the new 7th parameter doesn't change empty-book behavior (the two existing empty-book tests at lines 325/520 just need the extra `&HashMap::new()` argument — no new assertions required there).

## Docs to Update

- `docs/product-specs/trustee-dashboard.md` — the "Loans page (`GET /v1/loan-book`)" table row (currently line 172, part of a table already documenting `loans[]` table columns like `senior_outstanding`, `ccr_bps`, `maturity`). Append the four new fields to that row's existing cell text (do **not** add new lines — the file is already at the 200-line doc-lint cap; extend the existing single-line table-row content instead, e.g. append "**original senior tranche** (`original_senior_tranche`), **repaid to date** (`repaid_to_date`), **disbursed** (`disbursed`), **days on watchlist** (`days_on_watchlist`)" to the `loans[]` columns list in that cell).
- No change needed to `docs/product-specs/loans.md` or `loans-data.md` (both already at/near the 200-line cap and the underlying on-chain fields — `originalSeniorTranche`, `offtakerReceived`, `LoanStatusUpdated` — are already documented there; this issue only exposes existing on-chain data through a new API field, it doesn't change on-chain behavior).
- On completion, move this plan to `docs/exec-plans/completed/` (manager step).
