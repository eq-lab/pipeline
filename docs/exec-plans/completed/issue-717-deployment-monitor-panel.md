# Issue #717: Panel B: Deployment Monitor (loan book) UI

Source: https://github.com/eq-lab/pipeline/issues/717

Sub-issue of epic #712 (Protocol Dashboard). Depends on #716 (route + shell), which is merged: the
`/dashboard` route, the responsive panel grid, and the shared panel primitives
(`PanelContainer`, `PanelLoading`, `PanelError`, `PanelEmpty`) already exist. This issue fills the
body of the existing placeholder `DeploymentMonitorPanel`.

## Scope

In scope — wire the Deployment Monitor panel (Figma calls it "Loan Book", node `3283:14431`) to the
existing `GET /v1/loan-book` endpoint and render:

- **Summary header cards** from `summary`: Total Deployed, Collateral (`total_collateral`), Senior
  Debt Coverage (`senior_debt_coverage`), Yield (`avg_yield`), Average Duration
  (`avg_duration_days`). All five cards from the Figma. Nullable fields degrade to an em-dash `—`.
- **Active-loan table** from `loans[]`: columns Borrower / Commodity, Principal, Collateral, LTV,
  Duration, Rate, Protection — matching the Figma header row. Nullable per-loan fields
  (`collateral`, `ltv`, `protection`) degrade to `—`.
- **Responsive treatment**: desktop renders the table; below `md` (768px) each loan becomes a
  stacked card (label/value pairs). Per `docs/FRONTEND.md` "Responsive behavior".
- **Loading / error / empty** states routed through the existing `PanelContainer` `state` prop
  (`loading` → `PanelLoading`, `error` → `PanelError` with `refetch`, `empty` → `PanelEmpty` when
  `loans` is empty).
- **Polling**: 30s refetch interval, per `docs/FRONTEND.md` "Real-time updates" (protocol dashboard
  panels poll every 30 seconds).
- A new `useLoanBook` hook in `packages/frontend/src/api/`, exported from the `@/api` barrel,
  following the existing `useStats` / `useStatsPrices` pattern (React Query, `apiFetch`, mock layer).

Out of scope (no endpoint / not served yet — confirmed in the epic body and the endpoint's TODO
comments):

- The "In Origination" tab content (Figma shows an `In Origination · 3` tab). `/v1/loan-book`
  returns only active loans; no submissions count is in the read response. See Open Questions.
- Closed-loan rows, per-loan event log, location / AIS link, commodity/corridor/originator
  concentration mix (spec "Panel B" lists these but no endpoint serves them — TODO #706 / future).
- Backend changes. `total_collateral`, `senior_debt_coverage`, per-loan `collateral` / `ltv` are
  currently always `null` (TODO #706, no price feed); the UI handles null, it does not compute them.
- Column sorting (Figma header items carry a hidden `arrow-down` affordance — not active in design).

## Assumptions and Risks

- **Endpoint shape is fixed and read-only** (`packages/api/src/routes/loan_book.rs`). Response:
  `{ summary: { total_deployed: string, total_collateral: string|null, senior_debt_coverage:
  string|null, avg_yield: string|null, avg_duration_days: number|null }, loans: LoanBookEntry[] }`
  where `LoanBookEntry = { originator, borrower, commodity, principal, collateral: string|null,
  ltv: string|null, duration_days: number, rate: string, protection: string|null, status }`.
  - `total_deployed`, `principal`, `collateral` are **base-6 USDC decimal strings** (e.g.
    `"8000000.000000"` = 8M USDC). They are *already in human units with a decimal point* — NOT raw
    bigint sub-units. Do **not** run them through `formatUsdc`/`parseUnits` (those expect raw
    sub-unit bigints at 6dp). Format by parsing the decimal string and applying compact `$NN.NM`
    notation (Figma shows `$8.0M`, `$31.6M`). Verify against the handler's `base6_to_decimal_string`
    output before implementing — getting the scale wrong is the highest-risk bug here.
  - `avg_yield`, `rate` are **decimal-fraction strings** (e.g. `"0.112000"` = 11.2%). Reuse the
    `formatApy` helper from `@/api` (`"0.112000"` → `"11.20%"`; null → `"—"`). Figma shows `11.2%`
    (one decimal) — confirm desired precision in Open Questions; `formatApy` gives two decimals.
  - `ltv` is a **4-decimal fraction string** (`"0.8511"`); render as a percentage (`"85%"` in
    Figma). `senior_debt_coverage` is a **2-decimal ratio string** (`"1.50"`); render as `"1.5x"`.
  - `duration_days` / `avg_duration_days` are integers (days). Figma: `"120d"` in table, `"68 days"`
    in the summary card.
- **Compact `$NN.NM` formatting** (`$8.0M`, `$31.6M`) is new — no existing util produces it. It must
  be extracted into a shared util with unit tests (FRONTEND.md code-structure rule 3) because it is
  needed in both the summary cards and the table rows.
- **Mobile loan-book Figma frame not located.** The epic's "responsive" link (`3283-72387`) resolves
  to an unrelated "Requests" heading, not a loan-book mobile frame. The desktop frame (`3283:14431`)
  is verified. The stacked-card mobile treatment will follow the established home/transactions
  pattern (Tailwind `md` breakpoint, label/value rows) absent a confirmed mobile frame. See Open
  Questions — this is the gate item for the frontend flow.
- **No new UI primitive** exists for tables/badges in `@pipeline/ui` (checked the barrel). The table
  and stacked cards are built inline in the panel's component tree with theme-token utilities; no raw
  hex/font names (FRONTEND.md token discipline). The panel surface reuses `PanelContainer`'s `Card`.
- Risk: the `PanelContainer` body has a fixed `min-h-[120px]` and a single title `<h2>`. The Figma
  loan-book section has its own large "Loan Book" title plus the five summary cards *above* the
  table card. Reconcile whether the panel title should read "Deployment Monitor" (current shell /
  test expectation) or "Loan Book" (Figma) — see Open Questions. The existing route test asserts the
  panel contains the text "Deployment Monitor", so changing the title means updating that test too.

## Open Questions

- **Panel title — "Deployment Monitor" vs "Loan Book"?** The shell + route test
  (`packages/frontend/src/routes/-dashboard.test.tsx`) use "Deployment Monitor"; the Figma frame
  titles the section "Loan Book". Which wins, and should the `<h2>` change (with the test updated)?
- **Mobile layout reference.** No loan-book mobile Figma frame was found at the epic's responsive
  node (`3283-72387` → "Requests" heading). Is there a correct node id for the loan-book mobile
  frame, or should the stacked-card treatment follow the existing home/transactions mobile
  conventions until the epic #712 QA pass verifies it?
- **"In Origination" tab.** Figma shows an `Active Loans · 7 / In Origination · 3` tab bar.
  `/v1/loan-book` serves no submissions/origination count and the trustee submissions endpoint is
  auth-gated. Render the tab bar at all (Active-only, In-Origination disabled/empty), or omit it
  this issue and defer to a follow-up?
- **Yield/rate precision.** Figma shows one decimal (`11.2%`); `formatApy` yields two (`11.20%`).
  Match Figma exactly (new formatter) or accept `formatApy`'s two-decimal output?

## Implementation Steps

1. [x] **Add `useLoanBook` hook** — `packages/frontend/src/api/useLoanBook.ts`. Model on `useStats.ts`:
   - Export `LoanBookSummary`, `LoanBookEntry`, `LoanBookResponse`, `UseLoanBookResult` types that
     mirror the Rust DTOs exactly (nullable fields as `string | null` / `number | null`).
   - `useQuery({ queryKey: ["loan-book"], queryFn: () => apiFetch<LoanBookResponse>("/v1/loan-book"),
     refetchInterval: 30_000 })`. Always enabled (protocol-wide, no wallet).
   - Return `{ data, isLoading, error, refetch }`.
2. [x] **Export from the API barrel** — add the hook + its types to
   `packages/frontend/src/api/index.ts`, and document the hook + its `pipeline.mock.api.GET./v1/loan-book`
   mock key in `packages/frontend/src/api/README.md` (mirroring the `useStats` section).
3. [x] **Add a compact-USD formatter util** — `packages/frontend/src/utils/formatCompactUsd.ts`:
   - `formatCompactUsd(base6Decimal: string | null | undefined): string` → `"$31.6M"`, `"$8.0M"`,
     `"$0"`, null → `"—"`. Parses the base-6 decimal string (NOT raw sub-units) and applies
     `Intl.NumberFormat` compact notation. Ship `formatCompactUsd.test.ts` in the same change
     (FRONTEND.md rule 3): cover millions, thousands, sub-thousand, zero, null/undefined, and a
     non-numeric input → `"—"`.
   - Added helpers: `formatOneDecimalRate` (1-decimal %, issue #717 decision), `formatLtv`,
     `formatCoverage`, `formatDurationDays` (compact + long variants). All co-located in
     `formatCompactUsd.ts` with full unit tests (31 passing).
4. [x] **Build the summary cards subcomponent** — `packages/frontend/src/components/dashboard/LoanBookSummary.tsx`
   (+ `LoanBookSummary` is presentational; props are the formatted `summary`). Five cards: Total
   Deployed, Collateral, Senior Debt Coverage, Yield, Average Duration. Responsive: a row/grid on
   desktop, wrapping/stacking on mobile. Token-only styling.
5. [x] **Build the loan table subcomponent** — `packages/frontend/src/components/dashboard/LoanBookTable.tsx`:
   - Desktop (`md+`): a table with header row (Borrower / Commodity, Principal, Collateral, LTV,
     Duration, Rate, Protection) and one row per loan. Wrap in an `overflow-x: auto` container so it
     never forces page horizontal scroll.
   - Mobile (below `md`): each loan rendered as a stacked card of label/value pairs (`hidden md:…`
     toggling per FRONTEND.md responsive convention).
   - Per-loan nullable fields → `—`.
6. [x] **Rewrite `DeploymentMonitorPanel.tsx`** to consume `useLoanBook` via a co-located
   `useDeploymentMonitorPanel.ts` hook (FRONTEND.md rule 2: view = JSX only, logic in the hook):
   - Hook maps `{ isLoading, error, data }` to a `PanelState` (`loading` | `error` | `empty` (when
     `data.loans` is empty) | `ready`) and exposes formatted summary + rows + `refetch`.
   - View renders `PanelContainer` with the resolved `state`, `onRetry={refetch}`, and — in `ready`
     state — `<LoanBookSummary/>` + `<LoanBookTable/>` as children. Keep the existing
     `data-testid="dashboard-panel-deployment-monitor"` and `data-node-id="3283:14431"`.
   - Panel title is **"Loan Book"** per Open Questions resolution. Updated test assertion accordingly.
   - Includes the Active Loans / In Origination tab bar with In Origination visibly disabled.
7. [x] **Update catalogues** — added all utils to `docs/frontend/utils.md`; added `useLoanBook` to
   `docs/frontend/hooks.md`; updated `packages/frontend/src/api/README.md` with hook docs + mock key.
8. [x] **Lint** — `npx tsx scripts/lint-docs.ts`: 0 errors. `npx tsc --noEmit`: 0 errors.

## Test Strategy

Vitest + Testing Library, following `-dashboard.test.tsx` and `useStats.test.tsx` patterns.

- **`useLoanBook` hook test** (`useLoanBook.test.tsx`): mock `apiFetch` (or seed the
  `pipeline.mock.api.GET./v1/loan-book` localStorage key) and assert it returns the parsed response;
  assert it is always enabled (no wallet). Cover an error path → `error` populated.
- **Formatter util tests** (`formatCompactUsd.test.ts` and any sibling helpers): the cases listed in
  step 3 — explicitly assert base-6 decimal strings are read as human units (e.g.
  `formatCompactUsd("8000000.000000") === "$8.0M"`), and null/undefined/garbage → `"—"`. This is the
  guardrail against the scale bug.
- **`DeploymentMonitorPanel` integration test** (extend or add alongside `-dashboard.test.tsx`):
  - Loading → `PanelLoading` ("Loading…") shown.
  - Error → `PanelError` shown; clicking Retry calls the hook's `refetch`.
  - Empty (`loans: []`) → `PanelEmpty` shown.
  - Ready → seed a mock response with at least one fully-populated loan and one with all-null
    optionals (`collateral`/`ltv`/`protection` null, and `total_collateral`/`senior_debt_coverage`
    null in summary); assert: the populated values render formatted, the null fields render `—`, and
    every summary card label appears.
  - Responsive: assert the table container carries the desktop (`md:`) classes and the mobile
    stacked-card wrapper carries its `md:hidden` (or inverse) class, mirroring how `-dashboard.test`
    asserts grid classes.
- **Update the existing `-dashboard.test.tsx`** placeholder assertion: it currently expects four
  "Coming soon" empty panels. After wiring, the Deployment Monitor panel no longer renders "Coming
  soon" by default in tests that provide a mock — adjust the affected assertions (and the title text
  assertion if the title changes per Open Questions).
- Figma verification is deferred to the epic #712 QA pass (no per-issue QA in the frontend flow);
  desktop frame `3283:14431` is the reference, mobile frame pending Open Questions.

## Docs to Update

- `packages/frontend/src/api/README.md` — `useLoanBook` section + `/v1/loan-book` mock-key table.
- `docs/frontend/utils.md` — new compact-USD formatter (and any extracted sibling helpers).
- `docs/frontend/hooks.md` — `useLoanBook` row (shared `@/api` hook).
- No product-spec change required: this is UI for an existing, unchanged endpoint; `docs/product-specs/dashboards.md`
  Panel B already describes the intended content (the out-of-scope items remain accurately marked as
  not-yet-served).
