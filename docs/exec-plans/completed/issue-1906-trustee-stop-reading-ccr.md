# Issue #1906: Trustee: stop reading CCR (valuations, ccr-history, ccr_bps, initial_ccr) — use SecurityRegistry LTV on Stellar (prerequisite of #1786)

Source: https://github.com/eq-lab/pipeline/issues/1906

## Scope

The Trustee console stops reading every CCR source that backend #1786 will remove. On Stellar it shows LTV, margin-call state and price staleness from the SecurityRegistry. On EVM the CCR UI is removed and nothing replaces it: no row, no column value and no "—" placeholder.

What #1786 removes, and what the Trustee reads today:

| Removed by #1786 | Trustee reader today | After this issue |
|---|---|---|
| `GET /v1/loan-book/{id}/valuations` | `api/useLoanValuation.ts` → `-useLoanDetail.ts` Price & collateral card (a 200 without `inputs` / `missing_inputs` crashes the page) | Hook deleted. The card becomes a **Security** card fed by `/security` (Stellar only) |
| `GET /v1/loan-book/{id}/ccr-history` | `api/useLoanCcrHistory.ts`, `-CcrTrendChart.tsx` (Watchlist loan detail and Risk Council Escalate) | Hook, chart and both chart cards deleted. No replacement (no LTV time series is served) |
| loan-book `ccr_bps`, `collateral`, `ltv`, `spot_price` (and `spot_change_7d`, see Assumptions) | `-useLoansTable.ts` / `loans.index.tsx` (Spot sub-line, Collateral and CCR columns, CCR footnote), `-risk-council-escalate.ts` (Collateral and CCR rows), `-risk-council-reterm.ts` (CCR row), `-useLoanDetail.ts` (spot line) | No longer read. An **LTV** column reads the additive loan-book fields `ltv_bps` / `margin_call_open` / `price_stale` (option (c), see Open Questions). Risk Council pages read `/security` |
| `initial_ccr` in `SubmitLoanRequest` | Already never sent (`-origination-new.ts` drops it on import; tests assert it is absent) | Unchanged. Re-verified by the existing assertions |

New: `api/useLoanSecurity.ts` reads `GET /v1/loan-book/{loan_id}/security?chain_id=<id>` (spec `docs/product-specs/loan-security-state.md`). It runs for Stellar loans only. It hand-mirrors only the fields the Trustee uses. Everything is shown verbatim; the only comparison made in the frontend is the loan's served LTV against that loan's own served terms (`advance_ratio_bps`, `margin_call_ratio_bps`).

Out of scope:

- The full read-only security state on the loan detail (records, inspections, cure period, marks, consents). That is #1767; this issue's Security card is the summary #1767 will extend.
- Security writes (#1856, #1858, #1859).
- The LP frontend's `initial_ccr` type in `packages/frontend/src/api/useLoanSubmissions.ts`. It is a separate app; see Assumptions.
- Backend changes. The additive loan-book LTV fields belong to #1786's first phase.

## Assumptions and Risks

- **Deploy order.** This issue merges and deploys first. Every removed field must be read as optional, so the console keeps working both before and after #1786 lands: the tests run with the CCR fields present and absent.
- **Loans-table LTV fields may not exist yet.** The additive fields come from #1786's first phase, which lands after this issue. Before then the keys are missing; after it they are always present. Either way the frontend reads them with `?? null`. The LTV column shows only when at least one row has a non-null `ltv_bps` or `margin_call_open === true`, so it stays hidden before #1786 and on books with no Stellar snapshot. EVM rows are decided by chain kind (`isStellarTarget(chain_id)`), never by whether a key is present, and are always blank.
- **Field shape for option (c), confirmed by the #1786 planner (via the manager).** These are flat fields on every `loans[]` entry:
  - `ltv_bps: number | null`: verbatim from the stored snapshot. `null` = no snapshot. `4294967295` = the `u32::MAX` "no value" sentinel, passed through.
  - `margin_call_open: boolean | null`: `security_terms.margin_call_at != 0`. `null` when there is no terms row or it cannot be decoded. It can be a boolean before any snapshot exists.
  - `price_stale: boolean | null`: the contract's snapshot flag. `null` when there is no snapshot.
  - On EVM rows and on Stellar chains without the SecurityRegistry key, the keys are always present and serialised as `null`, never left out. So key presence cannot separate "not configured" from "no snapshot".
  - #1786 offered to also inline `advance_ratio_bps` / `margin_call_ratio_bps`. Declined: the table colours only on the served `margin_call_open` flag and shows no per-loan bands, so the ratios are not needed in the list. Ratios are shown on the per-loan pages from `/security`.
- **The spot price has no source left.** #1786 removes `spot_price` and, in its second phase, `spot_change_7d` (confirmed by the #1786 planner). The plan stops reading both: the Spot sub-line in the table, the spot line on the loan detail, and the "(commodity −x% 7d)" collateral label on Escalate.
- **`/security` 404 = not configured.** An unknown loan answers `200` with `terms: null`, so any `404` means `security_registry_not_configured`. The card and rows are then hidden, as on EVM. Other errors show an inline error in the card only and never break the page.
- **Defensive parsing.** The `/valuations` crash happened because a field the code read unconditionally was missing from the response. Every `/security` read goes through optional chaining and a type check (`typeof x === "number"`, `=== true`). A partial 200 renders "—" rows and never throws. Tests cover `{}`, `terms: null`, `valuation: null` and `margin_call: null`.
- **The `ltv_bps` sentinel.** `4294967295` means debt with no counted value. It is shown as "No security value", not as a percentage.
- **The `initial_ccr` acceptance grep conflicts with legacy-tolerance tests.** Five test fixtures carry `initial_ccr` to prove the console tolerates legacy `loan_data` and never sends the key (`-origination-new.test.ts`, `-origination-new-page.test.tsx`, `-useOriginationTable.test.ts`, `-origination-detail.test.ts`, `-useOriginationReview.test.ts`). Old submissions are still served verbatim with that key. See Open Questions.
- **LP frontend.** `packages/frontend` still types `initial_ccr` in `useLoanSubmissions.ts`. No LP follow-up issue was found, and #1786 asks for one. This is flagged for the manager, not done here.
- **Overlap with #1767 (blocked).** #1767 will rewrite the same card. Keeping this card to a small, served-only row set limits rework.

## Open Questions

Resolved by the product owner (Issue comment, 2026-11-12):

1. **Loans-table LTV column: option (c) confirmed.** Flat `ltv_bps` / `margin_call_open` / `price_stale` are inline in `GET /v1/loan-book` `loans[]` (#1786 phase 1), always present and `null` on EVM, unconfigured chains and no snapshot. The frontend also works when the keys are absent (pre-backend). Per-loan `advance_ratio_bps` / `margin_call_ratio_bps` are not added to the list.
2. **Collateral column: dropped, no replacement** (no "Security value" column). `spot_change_7d` is removed backend-side in #1786 phase 2 together with `spot_price`.
3. **`initial_ccr` legacy-fixture tests: kept** as an accepted exception to the `rg -iw initial_ccr` check, next to `LoanCCRUpdated`.

Also from the same comment: the LP app will show `ltv_bps` (follow-up #1907, prerequisite of #1786 phase 2); the loan-book summary aggregates (`total_collateral`, `senior_debt_coverage`, `at_risk_wl_and_default_pct`) are kept for now, so the Trustee `LoanBookSummary` type and fixtures are unchanged. Order: #1786 phase 1, #1906, #1907, #1786 phase 2.

Deviations during implementation:

- `LTV_NO_VALUE_SENTINEL` lives in `routes/-loanSecurity.ts`, not `api/useLoanSecurity.ts`, so tests that mock the hook module keep the presenter working.
- `formatLtvLine` takes the `UseLoanSecurityResult` (not the bare response) so it can reuse `buildSecurityCard`'s state.
- `SecurityCardView` carries `refreshPending` separately from `notes`; `useLoanSecurity` sets `retry: false`.
- `LabelValueRow` was removed; the card uses `SecurityRow` from `-loanSecurity.ts`.

## Implementation Steps

Follow `docs/FRONTEND.md` rule 2: `.tsx` files hold JSX only, and presenters own mapping. Comment rules: at most one 2–3-line spec-pointer header per touched file, and no other comments. Shrink `scripts/lint-comments.baseline.json` for every touched file, and delete the entries of deleted files.

1. **Security data hook** (done) — new `packages/trustee/src/api/useLoanSecurity.ts`:
   - `useLoanSecurity(chainId: number, loanId: string)` → `{ data, isLoading, error, notConfigured, refetch }`.
   - It calls `apiFetch<LoanSecurityResponse>(`/v1/loan-book/${encodeURIComponent(loanId)}/security?chain_id=${chainId}`)`.
   - Query key `["loan-security", chainId, loanId]`. `refetchInterval: 30_000`.
   - `enabled: isStellarTarget(chainId) && /^\d+$/.test(loanId)`.
   - `notConfigured` = the error is an `ApiError` with `status === 404`. When `!enabled`, return `notConfigured: true` and do not fetch.
   - `LoanSecurityResponse` mirrors a subset of `packages/api/src/security_state.rs`, with every field optional:
     - `refresh_pending?: boolean`
     - `terms?: { advance_ratio_bps?: number; margin_call_ratio_bps?: number } | null`
     - `valuation?: { value?: string | null; debt?: string | null; ltv_bps?: number; price_stale?: boolean } | null`
     - `margin_call?: { open?: boolean | null; opened_at?: string | null; cure_by?: string | null; cure_overdue?: boolean | null; ltv_above_ratio_no_onchain_call?: boolean | null } | null`
     - `prices?: { price_stale?: boolean | null } | null`
   - Add `LTV_NO_VALUE_SENTINEL = 4294967295`.
   - Header: `// spec: docs/frontend/trustee-flows.md#security-card` (new anchor, step 9).

2. **Shared security presenter** (done) — new `packages/trustee/src/routes/-loanSecurity.ts`, with pure functions only:
   - `formatLtvBps(bps: unknown): string`: non-finite or missing → `"—"`; the sentinel → `"No security value"`; else one decimal with a trailing `.0` trimmed (`8123` → `"81.2%"`, `8000` → `"80%"`). It is also used for the ratio values.
   - `ltvTone(sec): "negative" | "attention" | "neutral"`:
     - `negative` when `margin_call.open === true` or `margin_call.ltv_above_ratio_no_onchain_call === true`;
     - `attention` when both `valuation.ltv_bps` and `terms.advance_ratio_bps` are finite numbers, the LTV is not the sentinel, and LTV > advance ratio;
     - else `neutral`.
   - `formatMarginCall(mc): string`:
     - `open === true` → `"Open since {date}"`, then `" · cure by {date}"` when `cure_by` is served, then `" (overdue)"` when `cure_overdue === true`;
     - `open === false` → `"None"`;
     - otherwise `"—"`.
     - Dates are unix-second strings → `formatMaturityDate(Number(s))`; an unparseable string → `"—"`.
   - `priceStale(sec): boolean` = `valuation.price_stale === true || prices.price_stale === true`.
   - `buildSecurityCard(result: UseLoanSecurityResult): SecurityCardView`, where `state: "hidden" | "loading" | "error" | "no-terms" | "ready"`:
     - `notConfigured` → `hidden`; loading → `loading`;
     - any other error → `error` via `toUserError(err, "Failed to load the loan security.")`;
     - `terms == null` → `no-terms` with the note "No security terms are set for this loan.";
     - else `ready` with these rows:
       - LTV (`formatLtvBps`, plus `ltvTone`);
       - Advance ratio and Margin-call ratio (from `terms`);
       - Security value (`formatFullUsd(valuation.value)`);
       - Amount owed (`formatFullUsd(valuation.debt)`);
       - Margin call (`formatMarginCall`).
     - Notes:
       - `valuation == null` → "No valuation yet." (the LTV, value and owed rows show "—");
       - `priceStale` → a "Price stale" flag;
       - `refresh_pending === true` → "Updating from chain…".
   - `formatLtvLine(sec): string | null` for Risk Council:
     - `null` when the data is not ready or there are no terms (the caller omits the row);
     - otherwise `"{ltv}"`, plus `" — margin call open"` when open, `" — above the {mc} margin-call ratio"` when `ltv_above_ratio_no_onchain_call`, else `" — margin call at {mc}"` when `margin_call_ratio_bps` is served.
   - Header: `// spec: docs/frontend/trustee-flows.md#security-card`.

3. **Loan detail presenter** (done) — `packages/trustee/src/routes/-useLoanDetail.ts`:
   - Remove the `useLoanValuation` / `useLoanCcrHistory` imports and calls.
   - Remove `CcrThreshold`, `CcrTrend`, `CCR_TREND_THRESHOLDS`, `PriceCollateralView`, `SpotView`, `buildPriceCollateral`, `buildPriceCollateralState`, `placeholderPc`, `parseSpotChange`, `formatCcrPct`, `formatHaircutClause`, `formatQuantity`, `formatPrice` (only if it has no other user), `ccrSeriesFrom` and `buildCcrTrend`.
   - Add `const security = useLoanSecurity(chainId, loanId);` and `security: buildSecurityCard(security)` to `UseLoanDetailResult`.
   - Replace `priceCollateral` and `ccrTrend` with that field.
   - Keep `LabelValueRow` if the Security card reuses it.
   - Drop the `LoanBookEntry` reads of `spot_change_7d`.
   - Trim the file header to a single spec pointer.

4. **Loan detail view** (done) — `packages/trustee/src/routes/loans.$id.tsx`:
   - Delete `PriceCollateralCard`, `CcrTrendCard` and the `CcrTrendChart` import.
   - Add `SecurityCard({ card }: { card: SecurityCardView })`. It renders nothing when `card.state === "hidden"`. It uses the same `CARD_CLASS` / `cardStyle()` / `CardTitle` ("Security") / `KeyValueRow` styling as the old card.
     - The LTV value is coloured by tone: `NEGATIVE_RED` / `ATTENTION_AMBER` / `INK`.
     - A "Price stale" chip uses `chipStyle("attention")`.
     - Notes are muted.
     - Test ids: `loan-detail-security`, `-loading`, `-error`, `-no-terms`, `loan-detail-security-ltv`, `loan-detail-security-price-stale`, `loan-detail-security-refresh`.
   - Layouts:
     - performing/disbursing: `SecurityCard` beside `RegistryCard`. When hidden, `RegistryCard` fills the row.
     - watchlist: the row holds only `SecurityCard`; render the row wrapper only when not hidden. The CCR trend card is gone.
     - matured: `SecurityCard` beside the rollover card.
   - Update the inline JSX comments that mention CCR or Price & collateral, or remove them (comment lint).

5. **Delete the CCR modules** (done):
   - `packages/trustee/src/api/useLoanValuation.ts` and `-useLoanValuation.test.tsx`;
   - `packages/trustee/src/api/useLoanCcrHistory.ts` and `-useLoanCcrHistory.test.tsx`;
   - `packages/trustee/src/routes/-CcrTrendChart.tsx`.
   - Fix the stale header mention in `api/useLoanWaterfall.ts` ("Mirrors `useLoanFinancials` / `useLoanCcrHistory`" → `useLoanFinancials` only).
   - Replace the `"loan-valuation"` invalidation key with `"loan-security"` in `api/useCompleteDisbursement.ts`, `api/useRollover.ts` (and its header comment), `api/useUpdateLifecycle.ts` and `api/useDisburse.ts`.

6. **Loan book type and loans table** (done):
   - `packages/trustee/src/api/useLoanBook.ts`:
     - Make `spot_price`, `spot_change_7d`, `collateral`, `ltv`, `ccr_bps`, `total_collateral` and `senior_debt_coverage` optional, or delete them where nothing reads them. Preferred: delete `ccr_bps`, `ltv`, `collateral`, `spot_price` and `spot_change_7d` from `LoanBookEntry`, and `total_collateral` / `senior_debt_coverage` from `LoanBookSummary`, because nothing will read them. Extra JSON keys are harmless.
     - Add `ltv_bps?: number | null`, `margin_call_open?: boolean | null` and `price_stale?: boolean | null`.
     - Remove the stale `useLoanValuation` mention in the `loan_id` doc and the field JSDoc that describes the removed fields (comment lint).
   - `packages/trustee/src/routes/-useLoansTable.ts`:
     - Delete `MAINTENANCE_MARGIN_BPS`, `HEALTHY_MARGIN_BPS`, `HARD_MARGIN_CALL_BPS`, `CcrBand`, `CcrCell`, `classifyCcr`, `SpotLine`, `formatSpot`, and the row fields `spot`, `collateral` and `ccr`.
     - Add `ltv: LtvCell | null` with `LtvCell = { text: string; marginCallOpen: boolean; priceStale: boolean }`, built by `mapLtvCell(entry)`:
       - `null` (blank cell) when `!isStellarTarget(entry.chain_id)`, decided by chain kind and never by key presence;
       - else `{ text: formatLtvBps(entry.ltv_bps ?? null), marginCallOpen: entry.margin_call_open === true, priceStale: entry.price_stale === true }`, so a Stellar `null` shows "—".
     - Add `showLtvColumn: boolean` to `buildLoansView` / `UseLoansTableResult`: `data.loans.some((e) => isStellarTarget(e.chain_id) && ((e.ltv_bps ?? null) !== null || e.margin_call_open === true))`.
     - Keep `CONCENTRATION_LIMIT_PCT`.
   - `packages/trustee/src/routes/loans.index.tsx`:
     - Columns become Originator, Chain, Commodity, Senior outst., [LTV], Nearest payment, Stage. Use two `GRID_TEMPLATE_COLUMNS` constants (with and without LTV), chosen by `showLtvColumn`, and redistribute the freed fractions.
     - The Commodity header drops "· spot", and `CommodityCell` drops the spot sub-line.
     - Delete `ccrBandColor`, `CcrCellView` and `CcrFootnote`.
     - Add `LtvCellView`:
       - the value in `Bold 16.5px`, `NEGATIVE_RED` when `marginCallOpen`, else ink;
       - a sub-line in `12.5px`: "Margin call" (red) and/or "Price stale" (`ATTENTION_AMBER`);
       - test ids `loans-ltv`, `data-margin-call`, `data-price-stale`;
       - an empty cell when `row.ltv == null`.
     - Add `LtvFootnote` (test id `loans-footnote`), rendered only when `showLtvColumn`: "LTV = amount owed (outstanding principal plus accrued interest) / security value, from the Stellar security registry. A margin call opens above the loan's margin-call ratio. Stellar loans only."
     - Remove `ATTENTION_AMBER` / `MARGIN_CALL_ORANGE` / `POSITIVE_GREEN` if they become unused.

7. **Risk Council Escalate** (done):
   - `packages/trustee/src/routes/-risk-council-escalate.ts`:
     - Delete `nextCcrAlertPct`, `formatCcrLine`, `formatChangeFragment`, `buildCollateralLabel`, `MARGIN_CALL_PCT` / `MAINTENANCE_MARGIN_PCT` / `HEALTHY_MARGIN_PCT`, the `useLoanCcrHistory` call and `ccrTrend`.
     - Add `const security = useLoanSecurity(chainId, loanId)`.
     - In `LedgerView`, replace `collateralLabel`, `collateralValue`, `ccrLine` and `ccrBand` with `security: { value: string; ltvLine: string; ltvTone: "negative" | "attention" | "neutral"; ratios: string; priceStale: boolean } | null`.
       - It is `null` when `buildSecurityCard(security).state` is `hidden` or `no-terms`, so the rows are omitted (EVM, or not configured).
       - Loading or error → value `"—"`.
       - `ratios` = `"{advance} / {margin call}"`.
   - `packages/trustee/src/routes/risk-council.escalate.$id.tsx`:
     - Delete `ccrBandColor`, the `CcrBand` / `CcrTrend` imports, the "CCR trend — thresholds 130 / 120 / 110%" section and the chart.
     - When `ledger.security` is set, render the rows "Security value" (`risk-council-escalate-security-value`), "LTV" (`risk-council-escalate-ltv`, coloured by tone) and "Advance / margin-call ratio" (`risk-council-escalate-ratios`). Add "Price stale" (`risk-council-escalate-price-stale`) only when true.
     - Days on watchlist and the Portfolio section are unchanged.

8. **Risk Council Amend economics** (done):
   - `packages/trustee/src/routes/-risk-council-reterm.ts`:
     - Delete `formatCcrPct`.
     - Replace `ccr: string` in `RetermCurrentTerms` with `ltv: string | null`, from `formatLtvLine` on `useLoanSecurity(chainId, loanIdParam)` (`null` → row omitted).
   - `packages/trustee/src/routes/risk-council.reterm.$id.tsx`: replace `<Row label="CCR" …/>` with `{current.ltv != null && <Row label="LTV" value={current.ltv} testId="risk-council-reterm-ltv" />}`.

9. **Static copy and fixtures** (done):
   - `packages/trustee/src/routes/-loanDetailStatic.ts`:
     - Header: drop "CCR history" from the list.
     - `WATCHLIST_CURRENT_STAGE.body` (not rendered, #938) → "A margin call is open or the LTV is above the margin-call ratio. If the loan is past recovery on the active path, escalate it to the Risk Council."
   - `packages/trustee/src/routes/-riskCouncilFixtures.ts`:
     - Drop `spot_price`, `spot_change_7d`, `collateral`, `ltv` and `ccr_bps` from `loanEntry`, and `total_collateral` / `senior_debt_coverage` from `loanBook`.
     - Add a `securityResult(overrides)` helper returning a `UseLoanSecurityResult` (Stellar loan: terms 8000/8500, `ltv_bps` 8123, no margin call).

10. **Origination (`initial_ccr`)** (done): no source change is expected. Verify that `rg -n initial_ccr packages/trustee/src --glob '!*.test.*'` returns nothing and that `api/useSubmitLoan.ts` / `api/useLoanSubmissions.ts` have no such field. Handle the legacy test fixtures per Open Question 3.

11. **Lint and housekeeping** (done):
    - Run `npx tsx scripts/lint-comments.ts` and shrink the baseline entries of touched files. Delete the entries of `-CcrTrendChart.tsx`, `useLoanCcrHistory.ts`, `-useLoanCcrHistory.test.tsx` and `-useLoanValuation.test.tsx`.
    - Run `npx tsx scripts/lint-docs.ts`.
    - Run Trustee lint, typecheck and vitest (`yarn workspace @pipeline/trustee lint`, `… tsc --noEmit` or `build`, `… test`; use the package's scripts).
    - Run the acceptance greps: `rg -iw 'ccr|ccr_bps|initial_ccr' packages/trustee/src` and `rg 'ccr_|CcrTrend|useLoanCcrHistory|useLoanValuation' packages/trustee/src`. They should hit only the exceptions accepted in Open Question 3.

## Test Strategy

The tests are vitest files next to the existing ones in `packages/trustee/src/{api,routes}/`. They "simulate removal" by using loan-book fixtures with no CCR, spot or collateral keys, and by asserting that the removed endpoints are never fetched.

- **`api/-useLoanSecurity.test.tsx`** (new, same fetch-mock and QueryClient setup as `-useLoanFinancials.test.tsx`):
  - a Stellar loan fetches `/v1/loan-book/7/security?chain_id=<stellar>`;
  - an EVM chain id or a non-numeric loan id makes no fetch and gives `notConfigured: true`;
  - a 404 gives `notConfigured: true`, while a 500 gives an `error`.
- **`routes/-loanSecurity.test.ts`** (new):
  - `formatLtvBps`: 8123 → `81.2%`, 8000 → `80%`, the sentinel → "No security value", `null` / `undefined` / `NaN` → `—`;
  - `ltvTone`: margin call open → negative, `ltv_above_ratio_no_onchain_call` → negative, LTV > advance → attention, LTV ≤ advance → neutral, the sentinel with no terms → neutral;
  - `formatMarginCall`: open with and without cure-by, overdue, closed, missing;
  - `buildSecurityCard`: hidden, loading, error, `terms: null` → no-terms, `valuation: null` → rows "—" plus the note, `refresh_pending`, price stale through either flag. A partial 200 `{}` must not throw.
  - `formatLtvLine` variants.
- **`routes/-useLoanDetail.test.ts` / `-useLoanDetail-hook.test.ts`**:
  - Remove the `buildPriceCollateral*`, `buildCcrTrend` and `ccrSeriesFrom` suites, and the `useLoanValuation` / `useLoanCcrHistory` mocks.
  - Mock `useLoanSecurity`, and assert `security` for Stellar ready and EVM hidden.
  - Add a fetch-level test: render `useLoanDetail` with a `fetch` spy and assert that no requested URL contains `/valuations` or `/ccr-history`.
  - Loan-book fixtures carry none of the removed keys.
- **`routes/-loans.$id.test.tsx`**:
  - The Security card renders the LTV, ratios, margin-call and price-stale chip on Stellar.
  - No `loan-detail-security` and no `loan-detail-price-collateral` / `loan-detail-ccr-trend` appear on an EVM loan or a hidden card, and no "—" placeholder row.
  - The watchlist layout has no CCR trend.
  - The error state is inline and the rest of the page still renders.
- **`routes/-useLoansTable.test.ts` / `-loans.index.test.tsx`**:
  - Fixtures have no `ccr_bps`, `collateral`, `ltv`, `spot_price` or `spot_change_7d`.
  - The rows render with no Spot, Collateral or CCR column.
  - The LTV column is hidden in two cases: no entry has the keys (pre-#1786), and every entry has them as `null` (the post-#1786 shape on an unconfigured or EVM-only book).
  - With a mixed fixture (Stellar `ltv_bps: 8123, margin_call_open: true, price_stale: true`; Stellar with all three `null`; Stellar `ltv_bps: null, margin_call_open: true`; EVM with all three `null`):
    - the LTV header shows;
    - the cells read `81.2%` plus "Margin call" / "Price stale"; `—`; `—` plus "Margin call"; and blank (EVM).
  - The footnote shows only with the column.
- **`routes/-risk-council-escalate.test.ts` / `-risk-council-escalate-page.test.tsx`**:
  - Drop the `useLoanCcrHistory` mock and the CCR tests.
  - Stellar: the security rows show (value, LTV line with tone, ratios, price stale).
  - EVM, a 404 or `terms: null`: there are no `risk-council-escalate-ltv` / `-security-value` rows and no CCR trend section.
  - The rest of the ledger is unchanged.
- **`routes/-risk-council-reterm.test.ts` / `-risk-council-reterm-page.test.tsx`**: replace the `formatCcrPct` tests. The LTV row shows on Stellar and is absent on EVM.
- **Invalidation tests** (`-useCompleteDisbursement.test.tsx`, `-useUpdateLifecycle.test.tsx`, `-useRollover.test.tsx`, `-useDisburse.test.tsx`): expect `loan-security`, not `loan-valuation`.
- **Fixture-only updates** (drop the removed keys): `-record-coupon-page.test.tsx`, `-record-repayment-page.test.tsx`, `components/-useNeedsAttention.test.ts`, `api/-useLoanBook.test.tsx`, `-riskCouncilFixtures.ts`.
- **Origination**: the existing "never sends `initial_ccr`" assertions stay green, handled per Open Question 3.
- **Gates**: Trustee lint, typecheck and vitest pass; `lint-comments` and `lint-docs` pass; the acceptance greps are clean apart from the accepted exceptions.

## Docs to Update

- **`docs/frontend/trustee-flows.md`**:
  - **Loan book & tables**:
    - Rewrite "Data scale" (drop the `ccr_bps` / `ltv` paragraph).
    - Mark "Resolved Open Questions" item 1 (CCR as served) as retired by #1906.
    - In "Never-fabricate defaults", drop the Spot and CCR bullets and add the LTV blank / "—" rule.
    - Rename "CCR classification & tab mapping" to "LTV column & tab mapping": the option (c) fields, Stellar-only, hidden column, EVM blank, sentinel, flags, no frontend bands.
    - Figma mapping: replace the CCR band colours and the CCR footnote with the LTV cell and footnote styling.
    - Update the column list.
  - **Loan detail**:
    - Sources: drop `-CcrTrendChart.tsx`, add `-loanSecurity.ts`.
    - Data sources: `/security` (`useLoanSecurity`, Stellar only) replaces `/valuations`, and the per-loan hook list loses `useLoanValuation` / `useLoanCcrHistory`.
    - Never-fabricate: rewrite.
    - Replace "Price & collateral card" with a new "Security card" section (`#security-card`): rows, states, 404 = hidden, EVM = no card, tone rule against the loan's own served terms, sentinel, refresh note, the #1767 extension point.
    - Status-conditional layout: no CCR trend; card placement per variant.
    - Delete "CCR-trend chart (Watchlist variant …)".
  - **Disburse**: in the invalidation list, `loan-valuation` → `loan-security`.
  - **Risk Council actions → Pages**:
    - Escalate: security value, LTV line and ratios on Stellar; omitted on EVM; no CCR rows or trend. Remove "the CCR rows stay as they are, #1767".
    - Amend economics: an LTV row from `/security` instead of CCR from the loan book.
    - The EVM subsection notes that the LTV rows are omitted.
- **`docs/product-specs/trustee-risk-watchlist.md`**:
  - Replace item 2 and "CCR color bands" with LTV: the served LTV against the loan's advance and margin-call ratios; margin call open → red; price stale → flag; EVM shows none.
  - Update the Watchlist trigger list ("CCR fell below 130%" → "a margin call opened or the LTV rose above the margin-call ratio").
  - In Escalation, "CCR trend" → "LTV and margin-call state".
- **`docs/product-specs/trustee-dashboard.md`**:
  - Flow 10 "Data presented": "CCR trend" → "LTV and margin-call state (Stellar)".
  - The Loans page row: drop the spot, collateral and CCR columns and add the LTV column (option (c) fields).
- **`docs/FRONTEND.md`** line 171: "Price feed / CCR" → "Security LTV (Stellar): display as of the last API poll; `refresh_pending` shown".
- **`docs/exec-plans/tech-debt-tracker.md`** TD-42: replace the `useLoanValuation` hand-mirror pair with `useLoanSecurity` (`LoanSecurityResponse` subset vs `packages/api/src/security_state.rs`).
- **`docs/user-stories/epic-1775/1906-trustee-stop-reading-ccr.md`** (new). Stories:
  1. A Stellar loan detail shows the Security card.
  2. An EVM loan detail shows no CCR, security or "—" row.
  3. The loans table shows the LTV column only when served, with EVM blank.
  4. Risk Council Escalate and Amend show LTV on Stellar and nothing on EVM.
  5. After #1786 removes `/valuations`, `/ccr-history` and `ccr_bps`, every page still loads.
