# Issue #1907: LP app: Deployment Monitor reads ltv_bps instead of loan-book collateral / ltv (prerequisite of #1786 Phase 2)

Source: https://github.com/eq-lab/pipeline/issues/1907

## Scope

The LP app's Protocol Dashboard Loan Book panel (Deployment Monitor) stops reading the per-loan CCR-era fields that #1786 Phase 2 removes from `GET /v1/loan-book` `loans[]`. It reads the per-loan LTV from the flat `ltv_bps` field that #1786 Phase 1 added (already on `main`).

| Today | After this issue |
|---|---|
| `useLoanBook.ts` types `loans[].collateral` and `loans[].ltv` | Both removed from `LoanBookEntry`. `ltv_bps?: number \| null` added. `margin_call_open` / `price_stale` are not typed, because the LP app does not show them (decision 2026-11-12: the LP app shows `ltv_bps` only) |
| Active Loans table: Commodity, Principal, Collateral, LTV, Duration, Rate, Protection | Commodity, Principal, LTV, Duration, Rate, Protection. The Collateral column, its row field and its header aggregate are gone |
| Row LTV = `formatLtv(entry.ltv)` (integer percent from a fraction string) | Row LTV = `formatLtvBps(entry.ltv_bps ?? null)`: `—` when null or absent (EVM, unconfigured chain, no snapshot, pre-Phase-1 response), "No security value" for the sentinel `4294967295`, otherwise one decimal rounded **up** with a trailing `.0` trimmed (the Trustee rule, #1906) |
| LTV header aggregate = `Σ(ltv, null→0) / loans.length` | Mean of the valid `ltv_bps` values only (finite numbers, not the sentinel), rounded up, then formatted with `formatLtvBps`. `undefined` (label only) when no loan has a valid value |
| `useLoanSubmissions.ts` types `initial_ccr: number` | Field removed from `SubmitLoanRequest`. Legacy payloads that still carry the key keep rendering (nothing reads it) |

Unchanged: the summary aggregates `total_collateral`, `senior_debt_coverage` and `at_risk_wl_and_default_pct` stay served (decision 2026-11-12). The LP app keeps reading `total_collateral` (the "Collateral" summary card) and `senior_debt_coverage` (the "Senior Debt Coverage" card). It never read `at_risk_wl_and_default_pct`. The `LoanBookSummary` type is unchanged.

The app must work with both response shapes:

- today's: the legacy `collateral`, `ltv`, `ccr_bps`, `spot_price`, `spot_change_7d` present next to `ltv_bps`;
- Phase 2's: the legacy keys absent, `ltv_bps` present (`null` on EVM).

The legacy keys are never read, so their presence or absence changes nothing. There is no fallback from `ltv_bps` to the legacy `ltv`.

Out of scope:

- `margin_call_open` / `price_stale` on the LP app (not decided; the Trustee shows them).
- The In Origination tab, other than the `initial_ccr` type.
- The Trustee app (#1906, merged) and the backend (#1786).
- Any change to the summary cards.

## Assumptions and Risks

- **Dependency order.** #1786 Phase 1 and #1906 are merged on `main`. This issue must merge **and deploy to pipeline-test** before #1786 Phase 2 merges. Nothing here depends on Phase 2.
- **One chain per response.** The LP dashboard always sends the dashboard chain (`useDashboardChain` → `chainId`), so all rows of one response share a chain kind. Per the #1786 contract `ltv_bps` is always `null` on EVM, so the hook does not branch on chain kind. It reads `ltv_bps ?? null`, which also covers a response with no `ltv_bps` key.
- **SecurityRegistry not deployed yet (epic #1775).** On pipeline-test every `ltv_bps` is `null` today, so the LTV column shows `—` on every row with a label-only header until the contracts team deploys #39. Before this change the column also showed `—` (the legacy `ltv` is null there, and the aggregate read "0%"). After Phase 2 the legacy `ltv` is gone either way. This is accepted by the 2026-11-12 decision.
- **Planner decisions, taken from precedent (not new product decisions):**
  - **EVM and null rows show `—`** and the LTV column always renders. The issue says EVM rows show no LTV and that only the Collateral column goes. `—` is how the LP table already renders a missing LTV. The Trustee hides its column instead, but its table mixes chains while the LP table shows one chain, and the LP Figma (`3283-14552`) has the LTV column.
  - **Sentinel copy "No security value"** and **round-up to one decimal, `.0` trimmed** (`8123` → `81.3%`, `8000` → `80%`, `8001` → `80.1%`). These are the Trustee rules (`docs/frontend/trustee-flows.md` Security card "Rules", `docs/product-specs/trustee-risk-watchlist.md`). The contract rounds LTV up, so a displayed figure must not read lower than the on-chain value, and the same loan reads the same in both apps. This replaces the LP's integer-percent display.
  - **The aggregate is an unweighted mean** of the valid values, as today's formula is. The issue specifies only which values count. `0` (no debt) is a valid value and counts. The sentinel is excluded, as decided.
- **Column width.** "No security value" (16 px body) does not fit the current 112 px LTV column, and body cells are `whitespace-nowrap` with no `overflow-hidden`, so it would spill into Duration. The LTV column widens to 160 px, taking part of the 112 px the Collateral column frees. Fixed columns go from 656 px to 592 px, and the rest goes to the flexible Commodity column. `min-w-[1024px]` stays. This deviates from Figma `3283-14552` (which still shows Collateral). The deviation is recorded in the spec and checked in the browser (Test Strategy).
- **Exact integer mean.** The sum and count of `u32` values are exact in a JS number. The mean in bps is `Math.ceil(sum / count)`. For integers below 2^53, a non-integer quotient can never round to an integer, so the ceiling is exact. `formatLtvBps` then applies `Math.ceil(bps / 10) / 10`, and the two ceilings compose to `ceil(sum / (10·count))`. No float drift adds an extra 0.1%.
- **Acceptance grep vs view-model names.** The issue's `rg -w 'collateral|ltv|…'` check is meant for reads of the API fields. After this change these hits remain and are expected:
  - the view-model/UI names of the LTV column (`LoanBookRow.ltv`, `LoanBookHeaderAggregates.ltv`, the `loan-book-header-ltv-aggregate` test id), which now show `ltv_bps`;
  - one legacy-tolerance fixture per test file that proves legacy keys are ignored (today's response shape, and `initial_ccr` in a submission);
  - the summary card reads of `total_collateral` (`-w` does not match `total_collateral`).
  
  This is the same accepted exception as #1906 Open Question 3 (legacy `initial_ccr` fixtures kept). The final grep is listed in step 9 with its expected hits.
- **`initial_ccr` in typed fixtures.** After the field leaves `SubmitLoanRequest`, object literals typed `SubmissionView` with `initial_ccr` fail the TypeScript excess-property check. Remove the key from the typed fixtures. Legacy tolerance is proven by one test that feeds `initial_ccr` through the untyped localStorage mock JSON.
- **No runtime validation.** `apiFetch` casts. A Phase-2 response simply lacks keys the type no longer declares, so nothing breaks at runtime. The tests below cover both shapes explicitly.
- **Comment rule.** Touched source files go down to a single 2–3-line spec-pointer header with no field JSDoc or body comments (`AGENTS.md`). Any fact that is only in a removed comment moves to the spec first (step 8). This touches several baseline-listed files, so `scripts/lint-comments.baseline.json` shrinks.

## Open Questions

_None_

## Implementation Steps

Follow `docs/FRONTEND.md` rule 2 (`.tsx` = JSX only; mapping/formatting in the hook) and the comment rule (at most one 2–3-line spec-pointer header per touched file, no other comments; shrink `scripts/lint-comments.baseline.json` for touched files and delete entries that reach `header: 0, nodeIds: 0`).

1. **Formatter** — `packages/frontend/src/utils/formatCompactUsd.ts`:
   - Delete `formatLtv`, which has no other caller (`rg -n formatLtv packages/frontend/src` must be empty afterwards, apart from the new name).
   - Add `export const LTV_NO_VALUE_SENTINEL = 4_294_967_295;`.
   - Add `export function formatLtvBps(bps: unknown): string`, the same rule as `packages/trustee/src/routes/-loanSecurity.ts` `formatLtvBps` (the apps do not share code, TD-42):
     - not a finite `number` → `"—"`;
     - `=== LTV_NO_VALUE_SENTINEL` → `"No security value"`;
     - else `const pct = (Math.ceil(bps / 10) / 10).toFixed(1)`, return `` `${pct.endsWith(".0") ? pct.slice(0, -2) : pct}%` ``.
   - Trim the module header to a spec pointer (`// spec: docs/frontend/utils.md`) and drop the per-function JSDoc and section-divider comments. Update its baseline entry (header 28 / nodeIds 1 → removed).

2. **Loan-book type** — `packages/frontend/src/api/useLoanBook.ts`:
   - `LoanBookEntry`: delete `collateral` and `ltv`; add `ltv_bps?: number | null`. Leave the other fields as they are.
   - `LoanBookSummary`: unchanged (`total_collateral`, `senior_debt_coverage` stay).
   - Replace the 27-line header with `// spec: docs/frontend/hooks.md (useLoanBook) — mock key + human-unit amounts in src/api/README.md`, or similar, at most 2–3 lines. Remove the field JSDoc. Keep the hook body. Remove the baseline entry.

3. **Submissions type** — `packages/frontend/src/api/useLoanSubmissions.ts`:
   - Delete `initial_ccr` (and its JSDoc) from `SubmitLoanRequest`. No reader exists (`originationRow.ts` does not read it; verify with `rg -n initial_ccr packages/frontend/src --glob '!*.test.*'`, which must be empty).
   - Trim the 35-line header to a spec pointer (`// spec: docs/frontend/dashboard-components.md#usedeploymentmonitorpanel`). The stale "7-decimal" data-layer note is superseded by #1620 (the fixtures already say human-unit). Make sure `docs/frontend/hooks.md` has a `useLoanSubmissions` row with the mock key and "`loan_data` is the verbatim nested `SubmitLoanRequest`; economics amounts are human-unit strings (#1620)" before deleting the note. Add the row if it is missing. Remove the remaining JSDoc. Remove the baseline entry.

4. **Hook** — `packages/frontend/src/components/dashboard/useDeploymentMonitorPanel.ts`:
   - Imports: replace `formatLtv` with `formatLtvBps, LTV_NO_VALUE_SENTINEL`.
   - `formatRow`: drop `collateral`; `ltv: formatLtvBps(entry.ltv_bps ?? null)`.
   - Add a module-local `averageLtvBps(loans: LoanBookEntry[]): number | null`:
     - `valid = loans.map((l) => l.ltv_bps ?? null).filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v !== LTV_NO_VALUE_SENTINEL)`;
     - `null` when `valid.length === 0`, else `Math.ceil(valid.reduce((a, b) => a + b, 0) / valid.length)`.
   - Replace the `ltvAggregate` block: `const avg = averageLtvBps(loans); const ltvAggregate = avg === null ? undefined : formatLtvBps(avg);`.
   - `headerAggregates` in the ready branch: `{ principal, ltv: ltvAggregate }`. Drop `collateral`.
   - `formatSummary` / `EMPTY_SUMMARY`: unchanged (the `totalCollateral` card stays).
   - Comments: keep the one spec-pointer header (`// spec: docs/frontend/dashboard-components.md#usedeploymentmonitorpanel`). Remove the JSDoc on `DeploymentMonitorPanelState` fields, the section dividers and the inline comments. The file has no baseline entry, so it must lint clean.

5. **Table** — `packages/frontend/src/components/dashboard/LoanBookTable.tsx`:
   - `LoanBookRow`: delete `collateral`. `LoanBookHeaderAggregates`: delete `collateral`.
   - `<colgroup>`: drop one 112 px `<col>` and set the LTV `<col>` to `160px`. Order: flexible, 112 (Principal), 160 (LTV), 96, 96, 128.
   - `<thead>`: delete the Collateral `<th>` (with the `loan-book-header-collateral-aggregate` span). The LTV `<th>` stays as it is.
   - `<tbody>`: delete the collateral `<td>`.
   - Comments: one spec-pointer header (`// spec: docs/frontend/dashboard-components.md#loanbooktable`). Remove the JSDoc, the JSX comments and the class-constant comments. The file has no baseline entry, so it must lint clean.
   - `DeploymentMonitorPanel.tsx` and `LoanBookSummary.tsx` need no change. Confirm with `tsc`.

6. **API README** — `packages/frontend/src/api/README.md` (the `useLoanBook` section): in the monetary-fields sentence, `collateral` → `total_collateral`. Add one line: "`loans[].ltv_bps` is the SecurityRegistry LTV in bps (`null` on EVM / no snapshot; `4294967295` = no security value); display with `formatLtvBps`."

7. **Tests** — see Test Strategy for the cases. Files:
   - `src/utils/formatCompactUsd.test.ts`: replace the `formatLtv` block with `formatLtvBps`.
   - `src/components/dashboard/useDeploymentMonitorPanel.test.tsx`:
     - fixtures drop `collateral` / `ltv` and add `ltv_bps`;
     - the `#906` collateral test becomes a summary-only test (`summary.totalCollateral` still `"$42.0K"`; the row has no `collateral` key; `headerAggregates` has no `collateral` key);
     - the LTV aggregate block is rewritten (cases below);
     - `initial_ccr` is removed from the typed `FIXTURE_SUBMISSIONS`.
   - `src/routes/-dashboard.test.tsx`:
     - fixtures drop `collateral` / `ltv`;
     - `FIXTURE_WITH_COLLATERAL` keeps `total_collateral` and gets `ltv_bps: 8123`;
     - the "Collateral header" tests become "no Collateral column header";
     - the LTV marker test expects `81.3%`;
     - `initial_ccr` is removed from the typed fixture.
   - `src/components/dashboard/DeploymentMonitorPanel.test.tsx`: drop `collateral` from the `baseState` row.
   - `src/api/useLoanBook.test.tsx`: fixtures drop `collateral` / `ltv` and add `ltv_bps: null`.
   - `src/components/dashboard/originationRow.test.ts`: drop `initial_ccr` from `FULL_SUBMISSION`.
   - `src/api/useLoanSubmissions.test.tsx`: add the legacy `initial_ccr` tolerance test (untyped mock JSON).
   - Trim the header comment of each touched test file to ≤3 lines with a spec pointer. Remove the comments in edited regions (for example the `#906 … collateral` notes and the per-line `// → "$8.0K"` remarks inside the edited fixtures). Shrink their baseline entries (`useDeploymentMonitorPanel.test.tsx` 13, `-dashboard.test.tsx` 24/8 → header only, `DeploymentMonitorPanel.test.tsx` 7, `useLoanBook.test.tsx` 9, `originationRow.test.ts` 15, `formatCompactUsd.test.ts` 7). Do not edit the Figma node ids elsewhere in `-dashboard.test.tsx` unless the edited region contains them. Re-run the linter and record the new counts.

8. **Docs** — see Docs to Update. Spec first: write the doc changes before or with the code, and in any case before deleting the comments they replace.

9. **Verification**:
   - `yarn workspace @pipeline/frontend lint`
   - `yarn workspace @pipeline/frontend build` (runs `tsc -b`)
   - `yarn workspace @pipeline/frontend test`
   - `npx tsx scripts/lint-comments.ts` and `npx tsx scripts/lint-docs.ts`
   - Acceptance grep: `rg -n -w 'collateral|ltv|ccr_bps|initial_ccr|spot_price|spot_change_7d' packages/frontend/src`. Expected hits only:
     - `LoanBookRow.ltv` / `LoanBookHeaderAggregates.ltv` / `row.ltv` / `agg.ltv` / `headerAggregates.ltv` and the `loan-book-header-ltv-aggregate` test id (the LTV column, fed by `ltv_bps`);
     - the legacy-shape fixtures in `useDeploymentMonitorPanel.test.tsx` and `-dashboard.test.tsx` (`collateral`, `ltv`, `ccr_bps`, `spot_price`, `spot_change_7d` present and ignored);
     - the legacy `initial_ccr` fixture in `useLoanSubmissions.test.tsx`;
     - the `Collateral` summary card's label (capital C is not matched by `-w collateral`, since `rg` is case-sensitive).
     
     Also: `rg -n 'formatLtv\b' packages/frontend/src` is empty, and `rg -n '\.collateral\b|\.ltv\b' packages/frontend/src/components packages/frontend/src/api --glob '!*.test.*'` hits only `agg.ltv` / `row.ltv` / `headerAggregates.ltv`.
   - Browser check (no Figma link in the Issue; the Figma reference is the existing `3283-14552`): run the LP dev server. Set `pipeline.mock.api.GET./v1/loan-book` to a Stellar-shaped book with rows `ltv_bps` 8123, 4294967295 and `null`. Confirm:
     - six columns; no Collateral column;
     - `81.3%`, "No security value" (no spill into Duration at the 1024 px minimum and at a wide desktop width), `—`;
     - the header reads `LTV · 81.3%`;
     - the Collateral summary card still renders.
     
     Repeat with an all-`null` (EVM) book: `—` everywhere and the plain `LTV` label. Use the Playwright MCP (Chrome DevTools MCP may be unavailable) and attach screenshots to the PR.

## Test Strategy

Vitest only (frontend flow, no QA phase). All loan-book cases go through the existing `pipeline.mock.api.GET./v1/loan-book` localStorage mock, so fixtures are untyped JSON where they carry legacy keys.

`formatCompactUsd.test.ts`, `formatLtvBps`:

- `8123` → `"81.3%"`, `8000` → `"80%"`, `8001` → `"80.1%"`, `0` → `"0%"`, `12500` → `"125%"`;
- `4294967295` → `"No security value"`;
- `null`, `undefined`, `NaN`, `"8123"` (a string) → `"—"`.

`useDeploymentMonitorPanel.test.tsx`, rows and aggregate:

- **Phase-2 shape, Stellar.** Rows with `ltv_bps` `8000`, `9000` and `null`, and no `collateral` / `ltv` / `ccr_bps` / `spot_*` keys:
  - rows read `80%`, `90%`, `—`;
  - aggregate = `ceil(17000 / 2)` = 8500 → `"85%"` (the null row is excluded, not counted as 0);
  - no row object has a `collateral` key.
- **Sentinel.** Rows `8000` and `4294967295`: the rows read `80%` and "No security value"; the aggregate is `"80%"` (sentinel excluded).
- **Round-up mean.** Rows `8001` and `8002`: mean 8001.5 → ceil 8002 → `"80.1%"`.
- **Zero counts.** Rows `0` and `8000` → aggregate `"40%"`.
- **Phase-2 shape, EVM.** Every `ltv_bps: null`: every row `—`; `headerAggregates.ltv` is `undefined`.
- **Today's shape.** Legacy `collateral: "20986.500000"`, `ltv: "0.5718"`, `ccr_bps: 15000`, `spot_price`, `spot_change_7d` present next to `ltv_bps: 8123`:
  - the row LTV reads `81.3%`, not 57%: the legacy `ltv` is ignored;
  - the row has no `collateral` field;
  - the summary `totalCollateral` still formats `total_collateral`.
- **Pre-Phase-1 shape.** No `ltv_bps` key at all: rows `—`, aggregate `undefined`, no throw.
- **No loans.** The aggregate stays `undefined` (existing test, kept).
- **Summary aggregates.** `total_collateral` and `senior_debt_coverage` still drive `summary.totalCollateral` / `seniorDebtCoverage`. `headerAggregates` has only `principal` and `ltv`.

`-dashboard.test.tsx`, rendered panel:

- The header row is exactly Commodity, Principal, LTV, Duration, Rate, Protection.
- `queryByText("Collateral")` inside `loan-book-table` is null. The summary card "Collateral" is still present.
- `loan-book-header-collateral-aggregate` never renders.
- `loan-book-header-ltv-aggregate` reads `81.3%` for a single `ltv_bps: 8123` row, and is absent when every `ltv_bps` is null.
- A sentinel row's cell text is "No security value".

`DeploymentMonitorPanel.test.tsx`: type-only update (no `collateral` in `baseState`). The existing tab tests are unchanged.

`useLoanSubmissions.test.tsx`: the mock JSON for one submission carries `loan_data.initial_ccr: 1500000`. The hook returns it and `mapSubmissionToRow` maps it normally. This is the legacy tolerance; nothing reads the key.

`originationRow.test.ts` / `useLoanBook.test.tsx`: fixture-only updates; their assertions are unchanged.

## Docs to Update

- `docs/frontend/dashboard-components.md`:
  - `#usedeploymentmonitorpanel`:
    - replace the `headerAggregates` bullets: `principal` as before; delete `collateral`; `ltv` = the unweighted mean of the valid `ltv_bps` values (finite, not `4294967295`), rounded up to whole bps, formatted with `formatLtvBps`; `undefined` when none is valid (#1907; replaces the `null → 0` rule from #729/#765);
    - add an "LTV source (#1907)" paragraph: rows read `loans[].ltv_bps ?? null`, never the legacy `ltv` / `collateral` / `ccr_bps` / `spot_*` (removed by #1786 Phase 2); works with and without those keys; `null` (EVM, no SecurityRegistry, no snapshot, key absent) → `—`; sentinel → "No security value"; percentages use the Trustee rounding (one decimal, rounded up, `.0` trimmed, link `trustee-flows.md` Security card rules);
    - delete the "Same-scale rule applies to `formatRow`'s `principal`/`collateral`" sentence's `collateral` part.
  - `#loanbooktable`:
    - 6 columns: Commodity, Principal, LTV, Duration, Rate, Protection;
    - widths: Principal 112, LTV 160, Duration 96, Rate 96, Protection 128 = 592 px fixed;
    - note that the Collateral column (Figma `3704:1079`) was removed by #1907 and LTV was widened for "No security value", a deliberate deviation from `3283-14552`;
    - the `headerAggregates` paragraph mentions Principal and LTV only (drop the `Collateral · —` example).
  - `#loanbooksummary`: one line that the Collateral and Senior Debt Coverage cards keep reading `summary.total_collateral` / `senior_debt_coverage` (kept by the 2026-11-12 decision).
- `docs/frontend/utils.md`: replace the `formatLtv` row with `formatLtvBps` (`@/utils/formatCompactUsd`): bps → one-decimal percent rounded up with `.0` trimmed; `4294967295` → "No security value"; non-number → `—`; mirrors the Trustee `formatLtvBps` (TD-42, no shared code). Mention `LTV_NO_VALUE_SENTINEL`.
- `docs/frontend/hooks.md`: in the `useLoanBook` row, add "`loans[].ltv_bps` (SecurityRegistry LTV, bps, `null` on EVM)". Add or adjust a `useLoanSubmissions` row with the facts moved out of its module header (step 3).
- `docs/product-specs/dashboards.md` "Panel B: Deployment Monitor": in "Per active loan", replace "`ccrBps` with timestamp" with "LTV from the SecurityRegistry (`ltv_bps`, Stellar only; `—` on EVM)". Add a line that the Active Loans table columns are Commodity, Principal, LTV, Duration, Rate, Protection, and that the portfolio collateral figures stay on the summary cards (#1907).
- `docs/user-stories/epic-1775/1907-lp-deployment-monitor-ltv.md` (new, Status: Initial). Stories:
  1. Stellar book with `ltv_bps` 8123 / sentinel / null → `81.3%`, "No security value", `—`; header `LTV · 81.3%`; no Collateral column; the summary Collateral card still shows.
  2. EVM book → `—` rows, plain `LTV` header.
  3. Today's response with the legacy keys → the same rendering as story 1 (legacy `ltv` ignored).
  4. After #1786 Phase 2 deploys → the panel still loads, and the In Origination tab still lists submissions, including old ones that carry `initial_ccr`.
  
  Add its row to `docs/user-stories/index.md` under "Epic #1775".
- `docs/user-stories/epic-712/`: these docs still describe the Collateral column and would fail a QA run.
  - `729-loan-book-header-aggregate-subtitles.md`: mark Stories 2–3 (Collateral header aggregate) as retired by #1907. In Story 1 drop the Collateral header expectation and the `collateral` / `ltv` fixture keys, using `ltv_bps: null`.
  - `730-loan-book-table-column-widths.md`: six columns, the new widths, fixture keys.
  - `749-dashboard-adaptive-mobile-layout.md`: the column list says six columns. The five summary cards are unchanged.
- `docs/exec-plans/active/issue-1786-retire-ccr.md`: no edit. #1786 owns it; the manager can tick the LP prerequisite there when this merges.
