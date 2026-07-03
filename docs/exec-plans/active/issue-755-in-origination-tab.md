# Issue #755: Loan Book — implement "In Origination" tab data via /v1/loan-book/submissions (list_submissions)

Source: https://github.com/eq-lab/pipeline/issues/755

## Scope

Wire the Loan Book panel's **In Origination** tab (currently hardcoded disabled) to the now-public
`GET /v1/loan-book/submissions` endpoint, filtered to in-origination submissions, and make the tab bar
interactive so users can switch between **Active Loans** and **In Origination**.

In scope:

- New API hook `useLoanSubmissions` (mirrors `useLoanBook`) calling `GET /v1/loan-book/submissions?status=InReview`.
- Hand-written TypeScript types for `SubmissionView` + its `loan_data` payload (`SubmitLoanRequest` / `EconomicsInput` / `LocationInput`), following the existing hand-authored-interface pattern in `src/api/*`.
- Make the tab bar in `DeploymentMonitorPanel.tsx` interactive (selectable), enable the In Origination tab, and add its count badge (`In Origination · N`) — completing the deferred half of #727.
- Extend `useDeploymentMonitorPanel.ts` to fetch submissions, format them into `LoanBookRow`s, expose per-tab rows/counts/state, and manage the selected-tab state.
- Render the selected tab's rows in the existing `LoanBookTable` (same 7-column layout — see Open Questions), with the origination tab handling its own loading / empty / error inside the table area.

Out of scope:

- Any new/changed backend endpoint (endpoint exists and is public).
- Commodity price feed / collateral valuation (TODO #706) — collateral/LTV remain subject to the same limitation as active loans.
- Submission detail view, approve/reject actions (trustee console — separate work).
- Redesigning the summary cards — they continue to reflect the portfolio (active-loan) aggregates per Figma.

## Assumptions and Risks

- **Endpoint shape** (verified against stage OpenAPI, 2026-07-03): `GET /v1/loan-book/submissions` returns `SubmissionView[]`, newest first, optional `?status=` filter. `SubmissionView = { id:int, status:"InReview"|"Approved"|"Rejected", originator:string, created_at, updated_at (RFC3339), reason:string|null, loan_data }`. `loan_data` is the verbatim `SubmitLoanRequest`.
- **`loan_data` fields available for the table** (from `SubmitLoanRequest` / `EconomicsInput`):
  - Borrower → `loan_data.borrower_id`; Commodity → `loan_data.commodity`.
  - Principal → `loan_data.economics.original_facility_size` — base-6 decimal string **already in human units** (same convention as `/v1/loan-book`), so use `formatCompactUsd` (NOT `formatUsdc`/`parseUnits`).
  - Duration (days) → `(economics.original_maturity_date − economics.origination_date) / 86400`, both Unix seconds → `formatDurationDays(days, "compact")`.
  - Rate → `economics.senior_interest_rate_bps / 10000` as a decimal-fraction string → `formatOneDecimalRate`.
  - Protection → `loan_data.protection` (optional) → `"—"` when absent.
  - Collateral → not valued (no price feed) → `"—"`, matching active-loan behavior.
  - LTV → derived from `loan_data.initial_ccr` (1e6-scaled CCR; LTV fraction = 1e6/initial_ccr) via `formatLtv`; origination tab only (resolved).
  - Status → `view.status` (`InReview`/`Approved`/`Rejected`), shown in the added Status column.
- **Risk — panel state coupling.** `PanelContainer` currently wraps the whole panel in a single state derived from the loan-book query. If the submissions query is loading/erroring while active loans are ready, we must not blank the whole panel. Mitigation: keep `PanelContainer`'s state driven by the active-loan query (summary is always the portfolio view); the In Origination tab renders its own loading/empty/error **inside** the table region. Specified in Implementation Steps.
- **Risk — no Figma for the populated origination table** (the loan-book frame only designs the Active Loans state + the tab/badge). See Open Questions; default is to reuse the 7-column layout for visual parity.
- Endpoint is public (confirmed in issue comment) — no auth/JWT handling needed; hook is always enabled like `useLoanBook`.

## Resolved decisions (from issue owner, 2026-07-03)

- **Reuse the original Figma** loan-book table layout — no new design needed.
- **Show a Status column** populated from the backend `status` field (`InReview` / `Approved` / `Rejected`), and **do NOT filter by status** — the In Origination tab lists *all* submissions returned by `GET /v1/loan-book/submissions` (no `?status=` query param). Count badge = total submissions returned.
- **Apply backend data to the reused columns** — map `loan_data` into Borrower/Commodity, Principal, Duration, Rate, Protection; add Status as an additional column.

## Open Questions

1. ~~`loan_data` runtime shape.~~ **RESOLVED (2026-07-03):** backend `SubmissionView.loan_data` is `serde_json::Value` (`packages/api/src/routes/loan_book.rs:214`), serialized inline as a **nested JSON object** = the verbatim `SubmitLoanRequest`. The Swagger `"string"` example is a utoipa artifact for untyped values. Frontend reads `loan_data.borrower_id` / `.commodity` / `.economics.*` / `.protection` / `.initial_ccr` directly — no `JSON.parse`. Endpoint is now public (HTTP 200; returns `[]` on stage — no submissions yet).
2. ~~LTV / Collateral columns.~~ **RESOLVED (2026-07-03):** Collateral renders `"—"` (no price feed, TODO #706). **LTV is derived from `initial_ccr`** — `ltvFraction = 1_000_000 / initial_ccr` (initial_ccr is the 1e6-scaled collateral-coverage ratio; LTV = 1/CCR), formatted via the existing `formatLtv` (4-decimal fraction string). This derivation applies **only on the In Origination tab** (active-loan LTV stays server-driven and null pending #706).

## Implementation Steps

> **Status: ✅ all steps complete (2026-07-03).** Deviation: the panel stays
> `"ready"` when there are zero active loans (rather than showing a panel-level
> empty), so the In Origination tab is always reachable; each tab renders its
> own inline empty state (`loan-book-active-empty` / `loan-book-origination-empty`).
> Existing `-dashboard.test.tsx` expectations were updated accordingly.

1. **Add `packages/frontend/src/api/useLoanSubmissions.ts`** (mirror `useLoanBook.ts`):
   - Hand-written interfaces: `EconomicsInput`, `LocationInput`, `SubmitLoanRequest` (as `loan_data`), `SubmissionView`, `UseLoanSubmissionsResult`.
   - `useQuery` with `queryKey: ["loan-submissions"]`, `queryFn: () => apiFetch<SubmissionView[]>("/v1/loan-book/submissions")` (no status filter — list all), `refetchInterval: 30_000`, always enabled.
   - `loan_data` is a nested object (typed as `SubmitLoanRequest`); no parsing needed. Type it as such on `SubmissionView`.
   - Document the mock key `pipeline.mock.api.GET./v1/loan-book/submissions` and the base-6/human-units convention (copy the data-layer note from `useLoanBook.ts`).
2. **Export** the hook + types from `packages/frontend/src/api/index.ts` (append after the `useLoanBook` block).
3. **Add a Status column to the reused table.** Extend `LoanBookRow` (in `LoanBookTable.tsx`) with an optional `status?: string`, add a `Status` `<th>` + `<td>` and an 8th `<col>` width, rendered only when the row carries a status (active-loan rows leave it undefined → column still renders but empty for the active tab, OR gate the column on the selected tab — decide in code, preferring: Status column present only on the In Origination tab via a `showStatus` prop). Keep token-only styling.
4. **Extend `useDeploymentMonitorPanel.ts`:**
   - Call `useLoanSubmissions()` alongside `useLoanBook()`.
   - Add `formatSubmissionRow(view: SubmissionView): LoanBookRow` implementing the mapping in Assumptions: `status: view.status`, `collateral: "—"`, and `ltv` derived as `formatLtv(String(1_000_000 / loan_data.initial_ccr))` (guard `initial_ccr > 0`; else `"—"`).
   - Add selected-tab state: `const [activeTab, setActiveTab] = useState<"active" | "origination">("active")`.
   - Extend the returned state with: `inOriginationCount` (= total submissions returned), `originationRows`, `originationState` (loading/error/empty/ready from the submissions query), `activeTab`, `setActiveTab`. Keep the top-level `state` bound to the active-loan query (drives `PanelContainer` + summary cards).
5. **Update `DeploymentMonitorPanel.tsx`:**
   - Convert `LoanBookTabBar` to accept `activeTab`, `onSelect`, `activeLoansCount`, `inOriginationCount`; render both tabs as buttons (`role="tab"`, `aria-selected`), applying `activeTabClasses`/an inactive (non-disabled) variant based on selection. Remove `aria-disabled`/`disabledTabClasses`/`cursor-not-allowed` from In Origination and add its count badge (reuse `badgeClasses`, `data-testid="loan-book-tab-in-origination-count"`).
   - Below the tab bar, render the selected tab's content: Active → existing `LoanBookTable` with `rows`/`headerAggregates` (no Status column); Origination → `LoanBookTable` with `originationRows` and `showStatus`, plus inline loading/empty/error handling for `originationState` (reuse `PanelLoading`/`PanelEmpty`/`PanelError` inside the table container, not the whole panel).
   - Preserve existing `data-testid`/`data-node-id` anchors; keep token-only styling (no raw hex/px per FRONTEND.md).
6. **Lint & build:** `npx tsx scripts/lint-docs.ts`, `yarn workspace <frontend> lint`, `tsc`/build, per AGENTS.md.

## Test Strategy

- **New `useDeploymentMonitorPanel.test.tsx`** (none exists today; follow `useWithdrawalQueuePanel.test.tsx` for the apiFetch/query mocking harness):
  - `formatSubmissionRow` mapping: principal via `formatCompactUsd`, duration from maturity−origination seconds → `"…d"`, rate from bps → one-decimal percent, protection fallback `"—"`, collateral `"—"`, LTV per resolved Open Question #2.
  - Tab state machine: `inOriginationCount` = number of `InReview` submissions; origination loading/empty/error states are independent of the active-loan state (active ready + submissions loading must NOT put the panel in `loading`).
- **Component test for `DeploymentMonitorPanel`:** clicking the In Origination tab switches the rendered rows and toggles `aria-selected`; both count badges render; In Origination is no longer `aria-disabled`.
- Include an empty-submissions case (`[]` → origination tab shows empty state, badge `0`).

## Docs to Update

- `docs/product-specs/dashboards.md` — Panel B section: note the In Origination tab is now served by `GET /v1/loan-book/submissions` (remove the "deferred" note if present).
- Update the file header comment in `DeploymentMonitorPanel.tsx` (currently states the In Origination tab is disabled / deferred per #717).
- If either #727 or #717 references the deferral, add a closing note; #727 is already closed (no action required beyond the code comment).
- No design-doc/spec-ref changes beyond the above unless Open Question #1 changes the column set.
