# Issue #814: Protocol Dashboard: In-Origination tab — display the Figma field set (frontend-only)

Source: https://github.com/eq-lab/pipeline/issues/814

Sub-issue of Epic #712 (Protocol Dashboard). Frontend flow. Figma reference: node `4116-9155` (the Trustee Origination page frame — the same field set implemented for #813).

## Scope

Re-map the columns of the LP Protocol Dashboard's Loan Book **In Origination** tab to the Figma `4116-9155` field set, so the LP dashboard and the Trustee Origination page (#813) surface the same eight columns from the same `GET /v1/loan-book/submissions` payload:

| Column | Source (`SubmissionView` / `loan_data`) | Formatter |
| --- | --- | --- |
| Originator | `loan_data.originator` (the submitted originator name, **not** the top-level `SubmissionView.originator` submitter address) | `safeString` |
| Commodity | `loan_data.commodity` | `safeString` |
| Facility | `loan_data.economics.original_facility_size` | `formatFullUsd` (fully expanded, e.g. `$3,500,000`) |
| Corridor | `loan_data.corridor` | `safeString` + hyphen→arrow (`PE-CN` → `PE → CN`) |
| Rate | `loan_data.economics.senior_interest_rate_bps` | `formatBpsRate` (e.g. `1400` → `14.0%`) |
| Maturity | `loan_data.economics.original_maturity_date` (Unix seconds) | `formatMaturityDate` (e.g. `15 Dec 2026`) |
| Submitted | `SubmissionView.created_at` (RFC 3339) | `formatSubmittedDate` (e.g. `18 Jun`) |
| Status | `SubmissionView.status` | status label (see decision below) |

The current In Origination tab (built in #755) reuses the shared `LoanBookTable` (Active Loans columns: Borrower/Commodity · Principal · Collateral · LTV · Duration · Rate · Protection + a `showStatus` Status column). Those columns are being **replaced** for this tab.

**In scope**
- A new dedicated In-Origination table component + a testable `SubmissionView → row` extraction/formatting layer for the LP frontend, mirroring the trustee's `-useOriginationTable.ts` (`mapSubmissionToRow`).
- Adding the three formatters the frontend does not yet have (`formatFullUsd`, `formatMaturityDate`, `formatSubmittedDate`) — mirrored from the trustee, not shared (see Assumptions).
- Rewiring `DeploymentMonitorPanel`'s In-Origination tab body to render the new component. The panel's existing `useLoanSubmissions` wiring for the tab **count badge** and per-tab loading/error/empty/ready state (from #755) is preserved.
- Updating/adding unit tests.

**Out of scope**
- Any backend / endpoint change — `GET /v1/loan-book/submissions`, `SubmissionView`, and the verbatim `loan_data` payload are unchanged.
- The **Active Loans** tab — it keeps `LoanBookTable` and its 7-column layout untouched.
- The Loan Book summary cards, tab bar, count badges, and panel chrome.
- No client-side derived/computed metrics (per `no-frontend-computed-metrics` memory) — every column maps to a directly-served field; missing/malformed → `—`.

## Assumptions and Risks

- **Data is already available.** `packages/frontend/src/api/useLoanSubmissions.ts` returns `SubmissionView[]` with the verbatim `loan_data` (`SubmitLoanRequest`) object, which carries every field above. No new fetch is needed. `loan_data` is `serde_json::Value` on the wire, so nested access must be defensive (guard each field, render `—` rather than throw) — mirror the trustee's `safeString`/`safeNumber` helpers.
- **Mirror, don't share (decision).** `formatBpsRate` and `formatCompactUsd` already exist in `packages/frontend/src/utils/formatCompactUsd.ts`, but `formatFullUsd`, `formatMaturityDate`, and `formatSubmittedDate` do not. They exist in the trustee app (`packages/trustee/src/utils/formatUsd.ts`, `.../formatDate.ts`). Per epic #775 (the two apps stay separate; trustee cannot import `@pipeline/frontend` and vice versa) and the precedent in TD-42/TD-38, add these formatters to the LP frontend as hand-mirrored copies rather than introducing a shared package. Keep behaviour byte-for-byte identical to the trustee versions so the two surfaces do not drift. **This widens the TD-42 duplication** — update that entry to note the LP side now also carries the mirrored extractor + formatters.
- **Facility uses fully-expanded dollars** (`formatFullUsd` → `$3,500,000`), matching the trustee/Figma reference — not the dashboard's usual compact `$3.5M` (`formatCompactUsd`). This is an intra-panel formatting difference from the Active Loans tab; it is intentional to match the referenced Figma field set. Flagged in Open Questions.
- **Facility base-6 string convention.** `original_facility_size` is a base-6 decimal string already in human units (e.g. `"3500000.000000"`); `formatFullUsd` calls `parseFloat` on it directly — do **not** run it through `parseUnits`/`formatUsdc`.
- **Risk — divergent column sets.** `LoanBookTable` is shared by both tabs and is tightly coupled to the Active Loans column geometry. Rather than overload it with a second schema, this plan adds a dedicated component for the In-Origination tab. Low risk; the Active Loans path is unchanged.
- **Risk — test churn.** `-dashboard.test.tsx` currently asserts the tab bar, count badge, and table presence for In Origination but does not deeply assert the old column values, so churn is limited. New column-level assertions go in a focused unit test for the extraction layer.
- **Dependency.** #755 (In-Origination tab) and #813 (trustee reference) are both complete/merged; no blocking dependency.

## Open Questions

- **Valuation sub-line — omit (recommended, mirror #813) or is there a source?** Confirmed there is **no** valuation-mode field in `SubmissionView`/`loan_data` (`SubmitLoanRequest` has `to, metadata_uri, originator, borrower_id, commodity, corridor, governing_law, economics, initial_ccr, initial_location, protection, secondary_metadata_uri` — no valuation mode). `ValuationMode` lives on-chain in `loan_collateral_valuations`, keyed by a `loan_id` that pre-mint submissions don't have. #813 resolved (human) to OMIT the "Commodity · valuation" sub-line and not infer it from the commodity name. **Recommendation: omit on the dashboard too, for consistency.** The issue body lists "Commodity · valuation" as a target, so please confirm omission is acceptable (or point to a source).
- **Status column presentation — simple label vs. the trustee's pill/action treatment?** The dashboard today renders status as color-coded text (`Approved` green / `Rejected` red / `InReview` amber / else muted, via `statusColorClass`). The Figma `4116-9155` frame (trustee) shows a green "Approved & minted · <date>" pill, a blue **Review** button on `InReview`, and a red "Rejected" pill with the reason on hover. **Recommendation: keep the LP dashboard's simple status label** — the LP app is read-only for submissions and has no review route or origination-detail page (Review navigation is a trustee-only feature, #821), so a "Review" action does not belong here. Please confirm the dashboard should NOT adopt the pill/Review treatment, or specify which pieces (e.g. the Approved pill styling) it should.
- **Table visual styling — keep the dashboard's existing table look or adopt the trustee grid?** There is no LP-dashboard-specific Figma frame for the new column set; `4116-9155` is the trustee page. **Recommendation: keep the dashboard Loan Book table's existing visual language** (Figma `3283-14552` tokens: 12px caption headers, ~64px rows, `border-collapse`, `overflow-x-auto`) and only swap the columns — do not restyle to the trustee's 80px grid rows. Please confirm.

## Implementation Steps

1. **[DONE] Add the missing frontend formatters (mirrored from trustee, behaviour-identical).**
   - Added `formatFullUsd` to `packages/frontend/src/utils/formatCompactUsd.ts` — `Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })`, `$`-prefixed, `—` for null/non-numeric — byte-for-byte mirror of `packages/trustee/src/utils/formatUsd.ts`.
   - Created `packages/frontend/src/utils/formatDate.ts` with `formatMaturityDate` (Unix seconds → `en-GB` `"15 Dec 2026"`) and `formatSubmittedDate` (RFC 3339 → `en-GB` `"18 Jun"`), copied verbatim from `packages/trustee/src/utils/formatDate.ts`, `—` for missing/unparseable.
   - Added unit tests: extended `formatCompactUsd.test.ts` with a `formatFullUsd` describe block, and created `formatDate.test.ts`.

2. **[DONE] Added the extraction/formatting layer** in `packages/frontend/src/components/dashboard/originationRow.ts` (mirrors `packages/trustee/src/routes/-useOriginationTable.ts`, minus the trustee-only router-nav `submission` threading and Review action):
   - `OriginationTableRow` — `{ id, originator, commodity, facility, corridor, rate, maturity, submitted, status }`, `status` is the raw `SubmissionView["status"]` string.
   - `mapSubmissionToRow(submission: SubmissionView): OriginationTableRow` — defensive `safeString`/`safeNumber` helpers; corridor hyphen→` → ` arrow; `formatFullUsd`/`formatBpsRate`/`formatMaturityDate`/`formatSubmittedDate`. Every nested access guarded so a malformed submission renders `—`, never throws.

3. **[DONE] Created the presentational component** `packages/frontend/src/components/dashboard/OriginationTable.tsx`:
   - An 8-column table reusing the dashboard Loan Book table's visual tokens — `headerCellClasses`/`bodyCellClasses`/`bodyCellInnerClasses`/`firstBodyCellClasses`/`firstBodyCellInnerClasses` were exported from `LoanBookTable.tsx` and imported here — `table-fixed`, `border-collapse`, wrapped in `overflow-x-auto`.
   - Column headers: `Originator · Commodity · Facility · Corridor · Rate · Maturity · Submitted · Status`.
   - Status cell keeps a local `statusColorClass` color-coded text implementation (Open Question #2 resolved: simple label, no pill/Review). Missing status → `—`.
   - `data-testid="origination-table"` (+ `origination-table-desktop`) for tests/QA.

4. **[DONE] Rewired the panel** in `packages/frontend/src/components/dashboard/DeploymentMonitorPanel.tsx`:
   - `OriginationTabBody` `ready` case now renders `<OriginationTable rows={rows} />` instead of `<LoanBookTable rows={rows} showStatus />`.
   - Loading/error/empty states and the `refetchOrigination` retry wiring are unchanged.

5. **[DONE] Updated the panel hook** `packages/frontend/src/components/dashboard/useDeploymentMonitorPanel.ts`:
   - `originationRows` is now typed `OriginationTableRow[]`; the old `formatSubmissionRow` was removed and replaced by `mapSubmissionToRow` from step 2.
   - The Active Loans path (`formatRow`, `LoanBookRow`, summary, header aggregates) and the `inOriginationCount` / `originationState` / `originationErrorMessage` wiring are untouched.

6. **[DONE] Cleaned up the shared table** `packages/frontend/src/components/dashboard/LoanBookTable.tsx`:
   - Removed the `showStatus` prop, the Status `<col>`/`<th>`/`<td>`, `statusColorClass`, and the `status?` field on `LoanBookRow` — grepped first and confirmed nothing else consumed them (an unrelated local `statusColorClass` in `WithdrawalQueueTable.tsx` is untouched). Active Loans behavior is unchanged.

7. **[DONE] Lint & typecheck.** `npx tsx scripts/lint-docs.ts` (0 errors, pre-existing warnings only), `eslint .` (clean), `tsc -b` (clean), `vite build` (succeeds), `prettier --check .` (clean on all touched files).

## Test Strategy

- **[DONE] Unit — extraction layer** (`originationRow.test.ts`, mirroring `packages/trustee/src/routes/-useOriginationTable.test.ts`): each column maps from the right field; corridor `PE-CN` → `PE → CN`; `formatFullUsd`/`formatBpsRate`/date formatting; missing/malformed `loan_data`, `economics`, and each field → `—` (never throws); originator uses `loan_data.originator` not the submitter address.
- **[DONE] Unit — formatters**: `formatFullUsd` (`"3500000.000000"` → `"$3,500,000"`, `null`/non-numeric → `"—"`); `formatMaturityDate` / `formatSubmittedDate` shapes and `—` fallbacks.
- **[DONE] Component/panel**: extended `packages/frontend/src/routes/-dashboard.test.tsx` and `packages/frontend/src/components/dashboard/DeploymentMonitorPanel.test.tsx` — selecting the In Origination tab renders the new columns and formatted values; the old columns (`Principal`/`Collateral`/`LTV`/`Duration`/`Protection`/`Borrower / Commodity`) are absent from this tab; loading/error/empty states still render; the Active Loans tab is unchanged. Updated `useDeploymentMonitorPanel.test.tsx`'s In-Origination assertions to the new row shape.
- **Figma verification**: pending — the user reviews the rendered In Origination tab live against Figma node `4116-9155` (pixel/token-exact); hard-refresh to pick up HMR.

## Docs to Update

- **[DONE]** `docs/exec-plans/tech-debt-tracker.md` — extended **TD-42** to record that the LP side now also carries the hand-mirrored `loan_data` extractor (`originationRow.ts`'s `mapSubmissionToRow`) and the mirrored `formatFullUsd`/`formatMaturityDate`/`formatSubmittedDate` formatters (previously only the trustee copy existed), and reinforced the "extract a shared package now that a second consumer exists" suggestion.
- **[DONE]** No product-spec change — this is a presentational field re-mapping of an already-specified tab (behaviour surface is unchanged; same endpoint, same data). Confirmed `docs/frontend/index.md` does not document the In-Origination tab column set, so no update needed there.
- **[DONE]** Added `docs/user-stories/epic-712/814-origination-figma-field-set.md` and linked it from `docs/user-stories/index.md` (ISSUE_PROTOCOL §6 requirement).
- No user-docs / design-doc change beyond the above.
