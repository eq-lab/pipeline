# Issue #953: Backend: serve per-loan next payment date + days-overdue (nearest-payment feed)

Source: https://github.com/eq-lab/pipeline/issues/953

## Scope

Serve, per loan, two new backend-computed fields so the Trustee UI can render the
**Nearest payment** value (date, or "N days late") without any client-side date math
(project rule: show only backend-served fields, never derive).

**In scope**

- Add to `LoanBookEntry` (`GET /v1/loan-book`, `packages/api/src/routes/loan_book.rs`):
  - `next_payment_timestamp: i64` — Unix seconds of the next scheduled payment. For
    today's **bullet loans** this equals the current rollover-adjusted maturity
    (`snapshot.current_maturity_timestamp` — the same value already served as
    `maturity`). A distinct field future-proofs for any future intra-loan schedule.
  - `days_overdue: Option<i64>` — `null` when not overdue; the whole-day count
    `(now − next_payment_timestamp) / 86_400` when `now > next_payment_timestamp`.
    **Pure date math** — non-null whenever past the next payment date, regardless of
    loan status (Open Question 1, resolved). Computed server-side in the pure compute
    layer, like the existing `days_on_watchlist`.
- Mirror both fields on `GET /v1/loan-book/{loan_id}/financials`
  (`LoanFinancialsResponse`, `packages/api/src/routes/loan_financials.rs`) — the issue
  asks to "ideally mirror," and the endpoint already has the snapshot + `now` in a pure
  assembler, so the marginal cost is tiny.
- Product-spec + field-catalog doc updates (see **Docs to Update**).
- Unit tests in the existing pure compute-layer harnesses.

**Out of scope (deferred — decided)**

- The follow-on cross-rollover **"a coupon was missed while maturity has not yet
  passed"** case (Needs Attention overdue-counter) is **deferred to #961**
  (Open Question 2, resolved). Detecting a missed *prior-epoch* coupon
  while `next_payment_timestamp` is in the future requires per-epoch
  payment-reconstruction from `PaymentRecorded` + economics events and a firm product
  definition of "a coupon was missed" (a rollover is the *normal* re-terming path and
  does not by itself imply a missed payment).
- Any frontend work — #941 is the frontend consumer, kept `blocked` on this issue.

## Assumptions and Risks

- **Bullet-loan assumption.** Every current loan has a single scheduled payment at
  maturity, so `next_payment_timestamp == current_maturity_timestamp == maturity`
  today. The issue states this explicitly. `next_payment_timestamp` is still added as a
  distinct field so a future schedule can diverge without a breaking change.
- **No new DB query needed for the base case.** Unlike `days_on_watchlist` (which
  needed `latest_watchlist_entry_by_chain`), both new fields derive purely from the
  loan snapshot already loaded (`current_maturity_timestamp`, `status`, and — depending
  on the Open-Question-1 outcome — `repayment.offtaker_received` /
  `original_offtaker_price`). The change is confined to the pure compute functions
  (`build_loan_entry`, `build_response`) and the two DTO structs.
- **Schema is auto-derived.** `LoanBookEntry` / `LoanFinancialsResponse` derive
  `utoipa::ToSchema`; adding fields updates the OpenAPI automatically. There is no
  committed OpenAPI snapshot fixture to regenerate (verified: nothing under
  `docs/generated/` references `LoanBookEntry`).
- **`days_overdue` semantics (decided).** Pure date math regardless of status
  (OQ1 = option (c)). Consequence, accepted by product: a terminal loan (`Closed` /
  `Default`) past its maturity will report a non-null `days_overdue`. The frontend
  renders "N days late" only where it shows the Nearest-payment value.
- **Test fixtures.** `make_loan` in `packages/api/tests/loan_book.rs` defaults
  `current_maturity_timestamp` to the original maturity. New overdue tests must set a
  maturity in the past relative to `to`; a small field override may be needed (no
  offtaker-price setup required under the pure-date-math rule).

## Open Questions

_None_ — both resolved by the issue owner:

1. **Gating of `days_overdue`** → **pure date math**: non-null whenever
   `now > next_payment_timestamp`, regardless of loan status.
2. **Cross-rollover missed-coupon detection** → **deferred to a dedicated follow-on
   issue**; ship the base bullet-loan feed in this issue.

## Implementation Steps

_Status: all steps implemented (loan_book.rs + loan_financials.rs DTOs & compute, tests in both `tests/*.rs`, docs updated). Lint/build/test results in the coder report._

1. **`packages/api/src/routes/loan_book.rs` — extend `LoanBookEntry`.** Add, after the
   existing `maturity` field (keep the doc comments in the module's established style):
   - `pub next_payment_timestamp: i64,` — doc: next scheduled payment (Unix s). Bullet
     loans → current rollover-adjusted maturity; equals `maturity` today, distinct field
     future-proofs intra-loan schedules.
   - `pub days_overdue: Option<i64>,` — doc: whole days past `next_payment_timestamp`;
     `null` when `now <= next_payment_timestamp`. Pure date math (independent of status).
     Server-computed, same precedent as `days_on_watchlist`.
2. **`build_loan_entry` — compute the two values.** From the snapshot `s` and `to`:
   ```rust
   let next_payment_timestamp = s.current_maturity_timestamp;
   // Pure date math (OQ1 resolved): overdue whenever past the next payment date,
   // regardless of loan status.
   let days_overdue =
       (to > next_payment_timestamp).then(|| (to - next_payment_timestamp) / SECS_PER_DAY);
   ```
   Populate both new fields in the `LoanBookEntry { .. }` literal. No signature change to
   `build_loan_entry` / `compute_loan_book` — both values come from the snapshot already
   in hand.
3. **`packages/api/src/routes/loan_financials.rs` — mirror on `LoanFinancialsResponse`.**
   Add `pub next_payment_timestamp: i64,` and `pub days_overdue: Option<i64>,` with
   matching docs, and compute them in `build_response` from `s.current_maturity_timestamp`
   + `now` using the same one-liner as step 2. The expression is trivial (a single
   comparison), so inline it in both places rather than introducing a shared helper.
4. **Verify OpenAPI.** Both structs already derive `ToSchema` and are registered in
   their `#[openapi(components(schemas(...)))]` bundles — no registration change needed;
   confirm the generated schema picks up the fields (build succeeds).
5. **Lint & build.** `cargo clippy --all -- -D warnings` and `cargo build -p api`.

## Test Strategy

Pure compute-layer unit tests (no DB, no clock) — per project rule tests live under
`packages/api/tests/`, never inline in `src/`.

- **`packages/api/tests/loan_book.rs`** (drives `compute_loan_book` → `build_loan_entry`):
  - `next_payment_timestamp` equals the loan's `current_maturity_timestamp` (and equals
    `maturity`) for a normal loan, and reflects a **rollover-adjusted** maturity when
    `current_maturity_timestamp` is overridden away from `original_maturity_date`.
  - `days_overdue` is `null` when `to <= next_payment_timestamp`.
  - `days_overdue == N` when `to` is N whole days past `next_payment_timestamp`.
  - `days_overdue` is **non-null for a terminal loan** (`Closed` / `Default`) past its
    maturity — documents the accepted pure-date-math consequence (status-independent).
  - Add/extend a fixture field-override to set `current_maturity_timestamp` (and status
    for the terminal case), since `make_loan` defaults them.
- **`packages/api/tests/loan_financials.rs`** (drives `build_response`): mirror the
  not-overdue / overdue-N cases and the
  `next_payment_timestamp == current_maturity_timestamp` equality.

Edge cases to assert: exactly at the boundary (`to == next_payment_timestamp` → `null`);
first partial day past (value `0`, consistent with `days_on_watchlist`'s same-day `0`).

## Docs to Update

- **`docs/product-specs/trustee-dashboard.md`** — the `GET /v1/loan-book` field catalog
  (the "Loans page" row, ~line 172) lists every served column. Add
  **nearest payment** (`next_payment_timestamp`, rollover-aware next scheduled payment)
  and **days overdue** (`days_overdue`, whole days past it while outstanding; `null`
  otherwise), alongside the existing `days_on_watchlist` / `maturity` entries. Note both
  are also served on `.../financials`.
- **`docs/product-specs/trustee-risk-watchlist.md`** — under "What the loans table and
  loan card show", add a one-line note that **Nearest payment** is served by the backend
  as `next_payment_timestamp` + `days_overdue` (no client-side derivation), and record
  that the cross-rollover missed-coupon Needs-Attention case is tracked separately in
  #961.
- Run `npx tsx scripts/lint-docs.ts` after doc edits.
- No `docs/generated/` regeneration required (schema is auto-derived; no committed
  OpenAPI fixture references these structs).
