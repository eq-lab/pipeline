# Issue #1626: Trustee: dates in local time, waterfall as_of at midnight, CCR trend start, compact formatter and other display fixes

Source: https://github.com/eq-lab/pipeline/issues/1626

Parent epic: #1521. Branch: `fix/1626-trustee-display-fixes`. Labels: `bug`, `frontend`.
No Figma reference: no visual verification step. Frontend-only (`packages/trustee`): no
backend change is planned here (see Open Questions for the two places a backend field would
make the fix exact).

## Scope

Seven trustee-app items from the 2026-10-22 calculations review. Acceptance: each item fixed or
explicitly marked as intended, with tests for items 1, 3 and 4.

### In scope

1. **Dates in UTC.** `packages/trustee/src/utils/formatDate.ts`: `formatMaturityDate`,
   `formatEpochDate` and `formatSubmittedDate` format in the runner's local time zone. Maturity,
   origination and next-payment values are entered as UTC midnight, so a US browser shows
   `15 Dec` as `14 Dec`. All three switch to `timeZone: "UTC"`. This matches the rest of the
   trustee date formatters (`formatIsoDateUtc`, `formatAuditTimestamp`, `formatIsoDateTimeUtc`),
   which already render in UTC. `formatSubmittedDate` is included on purpose, so that a
   "Submitted"/"Approved" day and a maturity day on the same row use the same calendar. Call
   sites stay unchanged.
2. **Waterfall `as_of`. Decision: not intended. Use now.** `-record-coupon.ts` and
   `-record-repayment.ts` build `as_of` from `todayDateInput()` + `T00:00:00Z`. The evidence:
   - #916 made the "Date received" field a read-only display of today, and its body says
     "`as_of` sent to `/waterfall` is today". That means the payment is not backdated. Nothing
     says it must be midnight. Midnight is left over from the old editable date-picker
     conversion.
   - The backend's own default for a missing `as_of` is `now`
     (`packages/api/src/routes/waterfall.rs:279`). Its accrual is "origination → `as_of`"
     (`docs/product-specs/trustee-dashboard.md` flow note A). It returns 400 when `as_of`
     precedes origination (`waterfall.rs:381`), which midnight triggers for a loan drawn
     earlier the same day.
   - Midnight under-accrues up to about a day of interest and fees, and `close_loan` waives that
     remainder. No spec asks for it.

   Fix: stop deriving `as_of` from the date input. Pass `null` to `useLoanWaterfall`, which
   omits `as_of`, so the server uses its own `now`. That avoids client-clock skew and matches
   the endpoint's documented default. The "Date received" display (`dateInput`) stays as it is.
3. **CCR trend start.** `-useLoanDetail.ts:723` and `-risk-council-escalate.ts:249` each compute
   `ccrFrom = maturity − duration_days·86400`. Since #1633 (`dec64862`, merged 2026-10-22,
   after the review), the served `duration_days` is the **current, rollover-aware** term
   `floor((current_maturity − origination) / 1 day)` (`shared/src/book_weighting.rs`
   `current_tenor_days`, `docs/product-specs/book-rate-weighting.md`). The rollover gap the
   issue describes (the series starting at `current_maturity − original_term`) is therefore
   already closed on the backend. `maturity − duration_days·86400` now equals the origination
   instant, rounded up to less than one day because of the floor. That is within one step of
   the daily `/ccr-history` grid. The loan-book entry serves no raw `origination_date` (see
   Open Questions).

   Fix:
   - Replace the two copies with one exported pure helper, `ccrSeriesFrom(entry)`, that
     derives origination from the rollover-aware term.
   - Correct the stale `duration_days` doc on the trustee `LoanBookEntry`
     ("Original loan term" → current full term, rollover-aware).
   - Add a rollover test.
4. **Compact formatter.** `formatCompactUsd` / `formatCompactUsd2dp`
   (`packages/trustee/src/utils/formatUsd.ts`) choose the unit before rounding, so `999,999`
   becomes `999.999K`, which rounds to `"$1000K"` / `"$1000.00K"`. The same happens at the
   K boundary: `999.999` gives `"$1000"`. Fix: round first, then promote to the next unit when
   the rounded mantissa reaches 1000. `999,999` → `"$1M"` (`formatCompactUsd`) /
   `"$1.00M"` (`formatCompactUsd2dp`), and `999.999` → `"$1K"` / `"$1.00K"`. M stays the top
   unit (no B).
5. **Bank-deposit rows show the exact amount.** `-useLpBankDeposits.ts:123`
   `mapDepositToRow` uses `formatCompactUsd2dp`. Switch it to the existing exact, string-based
   `formatUsdDecimal` (`"50000.00"` → `"$50,000.00"`). The served `amount` is a plain 2-dp
   dollar string. This reverses the #1453 "Amount uses the Loans-table formatter" note in
   `docs/frontend/trustee-flows.md`. The issue is newer and gives the reason: the trustee
   reconciles this figure against the wire before minting. `amountRaw` and the mint path are
   unchanged.
6. **Principal prefill dust.** `-record-repayment.ts:310` prefills with
   `formatUsdInputValue(String(parseFloat(offtaker_outstanding)))`, a float round-trip.
   Fix: prefill from the served string exactly. Validate it with `economicsUsdDecimal`, trim
   trailing fractional zeros so `"6150000.000000"` stays `"6,150,000"`, then group with
   `formatUsdInputValue`. The remaining dust of up to 9 raw units (about 7.0e-7 USDC, at
   most $0.0000009) comes from the backend: `/financials` serves `offtaker_outstanding` at
   6 dp with `RoundingMode::Down` (`api/src/formatting.rs` `base6_to_decimal_string`), while
   Soroban USDC has 7 dp. The frontend cannot recover the 7th digit. With the default below,
   this residue is recorded as accepted. The served value then reads `0.000000`, so the
   fully-paid gate opens and `close_loan` waives the residue. See Open Questions.
7. **Escalate page days on watchlist.** `-risk-council-escalate.ts:302` renders
   `MOCK_DAYS_ON_WATCHLIST = "18"`. The loan-book entry now serves `days_on_watchlist`, which
   the loan-detail page already uses (`-useLoanDetail.ts:613`). Use
   `entry.days_on_watchlist` and render `"—"` when it is `null`. Delete the mock constant.

### Out of scope

- Any backend change: a raw `origination_date` on `LoanBookEntry`, or a 7-dp raw
  `offtaker_outstanding`. Each would be a separate `backend` issue if the user wants one.
- The LP frontend (`packages/frontend`) date and compact formatters.
- The rollover/submit forms' date inputs. They already convert to UTC.
- The other Escalate-page mocks (`MOCK_AT_RISK_PROJECTED_PCT` and the proposal builder).

## Assumptions and Risks

- **#1633 is merged** (`dec64862` is on this branch), so the served `duration_days` is
  rollover-aware. Item 3's helper relies on that, and the rollover test pins the contract.
- **Item 2 timing.** With `as_of` omitted, the server's `now` is taken when the preview is
  fetched. The on-chain `recordPayment` lands a little later. Accrual is monotonic in time, so
  the preview can only under-state by the seconds between preview and confirm. That is far
  smaller than today's up-to-a-day gap. The query key becomes
  `[…, amount, null]`, so a re-typed identical amount can serve a cached preview. React
  Query's default `staleTime: 0` refetches on mount and focus, and the page's debounce already
  refetches on each amount change. This is acceptable and needs no extra polling.
- **Item 1 tests must not depend on the CI time zone.** CI may run in UTC, where the old code
  also passes. The new tests must force a non-UTC zone (see Test Strategy) and must fail
  against the current implementation.
- **Item 5 spec reversal.** It deliberately overrides the #1453 design note. The row may wrap
  at the 16% Amount column width for 9-digit amounts. Check the `min-w-[820px]` table: if the
  column wraps, widen Amount (for example to 20%) and narrow Payment reference to match.
- **Comment rules.** `packages/trustee/src/utils/formatDate.ts` is in
  `scripts/lint-comments.baseline.json` (line 910). Touching it means shrinking it to a single
  2–3-line spec-pointer header and shrinking the baseline entry. Edited test files that are in
  the baseline (`-record-*.test.ts`, `-risk-council-escalate*.test.*`,
  `-useLoanDetail.test.ts`) must not gain new comments, and their baseline entries shrink if
  comments are removed.

## Open Questions

- **Item 3, exact origination:** is a CCR series that starts up to one day after origination
  acceptable? With `duration_days` now rollover-aware (#1633), this is the best the
  frontend-only fix can do, and it never skips more than one daily grid point. The
  alternative is a follow-up `backend` issue to serve a raw `origination_date` on
  `GET /v1/loan-book` entries, which the trustee would then use directly.
  Default if unanswered: accept, and do not file a backend issue.
- **Item 6, Stellar dust:** should the residue of up to 9 raw units be marked as intended?
  It is at most $0.0000009, comes from `/financials` serving 6-dp truncated values against
  7-dp SAC amounts, and is waived at `close_loan`. The alternative is a follow-up `backend`
  issue to serve the raw on-chain `offtaker_outstanding` for the prefill.
  Default if unanswered: mark it intended in the spec, and do not file a backend issue.

Item 2 (waterfall `as_of`) is **not** open. The specs and the backend default answer it (see
Scope item 2).

## Implementation Steps

1. **Dates in UTC:** `packages/trustee/src/utils/formatDate.ts`
   - Add `timeZone: "UTC"` to the `DAY_MONTH_YEAR` and `DAY_MONTH` option objects, or create
     `…_UTC` variants and drop the now-redundant spreads. `formatMaturityDate`,
     `formatSubmittedDate`, `formatEpochDate`, `formatIsoDateUtc` and `formatAuditTimestamp`
     then all format in UTC.
   - Remove the "exact day depends on TZ" wording and the other narrative JSDoc. Keep one
     2–3-line spec-pointer header (`docs/frontend/trustee-flows.md`). Shrink this file's entry
     in `scripts/lint-comments.baseline.json`.
2. **Waterfall `as_of`:** `packages/trustee/src/routes/-record-coupon.ts` and
   `-record-repayment.ts`
   - Delete the `asOfSeconds` `useMemo` and call
     `useLoanWaterfall(chainId, loanId, amountBaseUnits, null)`.
   - Keep `todayDateInput()` and `dateInput`. The read-only field still shows today.
   - Check that `useMemo` is still imported only where it is used.
   - `packages/trustee/src/api/useLoanWaterfall.ts` already omits `&as_of` for `null`, so it
     needs no change.
3. **CCR start:** `packages/trustee/src/routes/-useLoanDetail.ts`
   - Export `ccrSeriesFrom(entry: Pick<LoanBookEntry, "maturity" | "duration_days"> | undefined): number | null`.
     It returns `null` for a missing entry, otherwise
     `entry.maturity − entry.duration_days * 86_400`.
   - Use it at line 723 and in `-risk-council-escalate.ts:249`, which already imports from
     `./-useLoanDetail`.
   - Remove the duplicated inline comments.
   - In `packages/trustee/src/api/useLoanBook.ts`, change the `duration_days` doc to "Current
     full loan term in days (`current_maturity − origination`, rollover-aware)".
4. **Compact formatter:** `packages/trustee/src/utils/formatUsd.ts`
   - Add a private `compactParts(abs, decimals)` helper. It picks K or M, rounds the mantissa
     to 2 dp, and if the rounded value is `>= 1000`, promotes to the next unit (bare → K,
     K → M) and recomputes. M is the cap.
   - `formatCompactUsd` keeps trailing-zero trimming (`trimDecimals`). `formatCompactUsd2dp`
     keeps fixed `toFixed(2)`.
   - Existing outputs (`$96M`, `$8.4M`, `$500K`, `$2.10M`, `$500.00K`, `$0`, `$0.00`, `—`)
     must not change.
5. **Bank-deposit amount:** `packages/trustee/src/routes/-useLpBankDeposits.ts`
   - In `mapDepositToRow`, set `amount: formatUsdDecimal(deposit.amount)`, and change the
     import from `formatCompactUsd2dp` to `formatUsdDecimal`.
   - Confirm the confirm-mint dialog, if it shows the amount, uses the same exact form.
   - Check the `-LpBankDepositsSection.tsx` Amount column for wrapping at 9-digit amounts, and
     adjust the `<colgroup>` shares only if it wraps.
6. **Principal prefill:** `packages/trustee/src/routes/-record-repayment.ts`
   - Add an exported pure helper `prefillAmountInput(served: string | null | undefined): string | null`.
     It runs `economicsUsdDecimal(served)`, returns `null` when the value is zero or invalid,
     strips trailing fractional zeros and a trailing `.`, then applies `formatUsdInputValue`.
   - The prefill `useEffect` uses this helper on `financials.data?.offtaker_outstanding`
     instead of `String(offtakerOutstandingUsd)`. The `> 0` guard stays.
7. **Days on watchlist:** `packages/trustee/src/routes/-risk-council-escalate.ts`
   - Set `daysOnWatchlist: entry?.days_on_watchlist == null ? "—" : String(entry.days_on_watchlist)`,
     the same mapping as `-useLoanDetail.ts:613`.
   - Delete `MOCK_DAYS_ON_WATCHLIST` and its comment, and remove every import of it.
8. **Docs:** see Docs to Update.
9. **Verification:**
   - `yarn workspace @pipeline/trustee test` (or the repo's trustee vitest command)
   - `yarn build` for trustee
   - `npx tsx scripts/lint-docs.ts`
   - `npx tsx scripts/lint-comments.ts`

## Test Strategy

- **Item 1:** `packages/trustee/src/utils/-formatDate.test.ts`
  - Force a negative-offset zone in a `describe` block: `vi.stubEnv("TZ", "America/New_York")`
    in `beforeAll`, `vi.unstubAllEnvs()` in `afterAll`. If Node does not pick up a runtime TZ
    change in the vitest worker, fall back to a per-file `// @vitest-environment-options` or a
    `process.env.TZ` assignment at the top of a dedicated test file.
  - Under that zone, assert:
    - `formatMaturityDate(1_797_292_800)` (2026-12-15T00:00Z) → `"15 Dec 2026"`
    - `formatEpochDate("2026-12-15T00:00:00Z")` → `"15 Dec 2026"`
    - `formatSubmittedDate("2026-06-18T00:30:00Z")` → `"18 Jun"`
  - Confirm locally that these tests fail on the pre-fix code.
- **Item 3:** `packages/trustee/src/routes/-useLoanDetail.test.ts`
  - `ccrSeriesFrom(undefined)` → `null`.
  - A non-rolled loan (`maturity` = origination + 180 days, `duration_days` 180) → the
    origination.
  - A rolled-over loan: origination T0, original term 90 days, current maturity T0 + 180 days,
    served `duration_days` 180 → T0, not T0 + 90 days.
  - A sub-day origination (T0 at 14:00 UTC, maturity at UTC midnight) → a value at most one
    day after T0 and never before it.
  - Update the escalate-page test only if it asserts the CCR query's `from`.
- **Item 4:** `packages/trustee/src/utils/-formatUsd.test.ts`
  - `formatCompactUsd`: `"999999.000000"` → `"$1M"`; `"999999.999999"` → `"$1M"`;
    `"999.999"` → `"$1K"`; `"999994.000000"` → `"$999.99K"`; negative mirror
    `"-999999.000000"` → `"-$1M"`.
  - `formatCompactUsd2dp`: `"999999.000000"` → `"$1.00M"`; `"999.999"` → `"$1.00K"`;
    `"999994.000000"` → `"$999.99K"`.
  - All existing cases still pass.
- **Item 2:** `-record-coupon-page.test.tsx` / `-record-repayment-page.test.tsx`
  - Assert the `/waterfall` request URL contains **no** `as_of=`, by inspecting the mocked
    `apiFetch`/fetch call.
  - The existing read-only today date-field tests stay.
- **Item 5:** `-useLpBankDeposits` test (or the section test)
  - `mapDepositToRow({ amount: "1234567.89", … }).amount` → `"$1,234,567.89"`.
  - Update any assertion that expected `$1.23M`-style output.
- **Item 6:** `-record-repayment.test.ts`
  - `prefillAmountInput`: `"6150000.000000"` → `"6,150,000"`;
    `"1234567.891234"` → `"1,234,567.891234"`; `"0.000000"` / `null` / `"abc"` → `null`.
  - The existing page test (`toHaveValue("6,150,000")`) still passes.
- **Item 7:** `-risk-council-escalate-page.test.tsx:226`
  - Replace "renders the MOCK Days-on-watchlist tile" with two cases: served
    `days_on_watchlist: 12` → `"12"`, and `null` → `"—"`.

## Docs to Update

All in `docs/frontend/trustee-flows.md`, unless noted:

- Add a short "Dates" convention note: every trustee calendar date renders in UTC via
  `@/utils/formatDate`. Update the line-1193/1194 and line-1339 formatter references if they
  mention local time.
- §"CCR-trend chart" (line 535): the series starts at origination, derived from the
  rollover-aware `maturity − duration_days` (#1633), via `ccrSeriesFrom`. Record the
  sub-day-floor caveat, or a pointer to the backend follow-up if Open Question 1 goes that way.
- §"Waterfall error mapping (#916)" (line ~785): `as_of` is omitted, so the server's `now` is
  used. The read-only date field shows today. Record the #1626 decision that midnight was
  unintended.
- Bank-deposits column plan (lines 1027 and 1033–1037):
  - Amount uses `formatUsdDecimal` (exact, e.g. `$1,234,567.89`), because the trustee
    reconciles it against the wire before minting.
  - Replace the "Amount uses the Loans-table formatter" paragraph.
- §"Escalate to Default", Real vs. mock (line 1498): move "Days on watchlist" to **Real**
  (`entry.days_on_watchlist`, `—` when `null`).
- Record Repayment prefill: the prefill is exact to the served 6-dp `offtaker_outstanding`,
  and Stellar's sub-micro residue is accepted and waived at close (or the follow-up issue,
  per Open Question 2).
- `docs/frontend/utils.md` line 22, the trustee `formatCompactUsd` row: add the boundary rule
  ("rounds before choosing the unit: `999,999` → `$1M`").
- No product-spec (`docs/product-specs/`) change is needed. Items 1, 3, 4, 5 and 7 are display
  fixes, and item 2 aligns the client with the already-specified backend default.
