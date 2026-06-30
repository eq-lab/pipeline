# Issue #727: Loan Book panel — tab labels missing count badges + tab restyle to Figma

Source: https://github.com/eq-lab/pipeline/issues/727

Parent epic: #717 (Loan Book / Deployment Monitor panel — MERGED). Sibling UX-review findings NOT in scope here: #726 (tab/card vertical order), #728 (layout width — owns the dashboard grid), #729 (column header subtitles), #730 (borrower truncation).

## Scope

A frontend `bug` fix on the Loan Book panel tab bar (`packages/frontend/src/components/dashboard/DeploymentMonitorPanel.tsx`). Two parts, both expanded by human direction in the issue's latest comment:

1. **Count badges** — add a count badge to each tab label, matching Figma `Active Loans · 7` / `In Origination · 3`.
   - Active Loans badge: render the live count derived from `loans.length` in the `/v1/loan-book` response.
   - In Origination badge: the API does NOT serve an origination/submissions count (the In-Origination tab is deferred + disabled per the #717 decision). Render NO count for it (or a static placeholder per Open Questions) — do NOT block on the missing endpoint.

2. **Tab styling** — restyle the tab bar to match Figma tabs component **`node-id=3283-14480`**: container, selected/unselected tab states, sizing, padding, radii, colors, and badge styling. Map to existing design tokens wherever they exist; do not inline raw hex (FRONTEND.md §"Design tokens", line 25).

**Out of scope:**
- The dashboard grid / panel width (owned by #728).
- Tab/card vertical ordering (#726), column subtitles (#729), borrower truncation (#730).
- Wiring the In-Origination tab to live data or making it clickable — it stays disabled per #717.
- Any backend/API change. The origination count endpoint is explicitly deferred.

## Figma reference (component `3283:14480`)

Read via Figma MCP (`get_design_context` + `get_variable_defs` + `get_screenshot`). Resolved spec:

**Container** (`tabs`):
- bg `fill-test/primary` = `#bfbdbb1f` (rgba(191,189,187,0.12)) → token `--color-pipeline-fill-muted` (theme comment literally says "segmented tab container").
- padding `2px` (`size-2`).
- radius `radius/radius-xl` = **6px** — see Risks: no exact 6px token exists today.
- tabs laid out in a row, each flex-1, `items-start` on the container.

**Selected tab** (`.tab`, Active Loans):
- bg `fill-test/on-primary` = `#ffffff` → token `--color-pipeline-surface`.
- height `32px`, horizontal padding `6px` (`size-6`), radius `radius/radius-l` = **4px** → token `--radius-pipeline-card` (4px).
- centered content (`justify-center`), min-width 32px.

**Unselected tab** (`.tab`, In Origination):
- transparent bg (no fill), same 32px height / 6px px / 4px radius geometry.

**Tab label text:**
- font `font/text-font-family` = Graphik LC → token `--font-body`.
- size/line-height `caption` = 12px / 16px → token `--text-pipeline-caption`.
- weight: selected = Medium (500) → `--font-weight-medium`; unselected = Regular (400) → `--font-weight-regular`. (Figma "Caption Emphasized" vs "Caption".)
- color: selected `content-test/primary` `#262524` → `--color-pipeline-ink`; unselected `content-test/secondary` `#38373599` → `--color-pipeline-ink-muted`.

**Badge** (right of label, inside each tab):
- bg `fill-test/primary` = `#bfbdbb1f` → `--color-pipeline-fill-muted`.
- radius `radius/radius-l` = 4px → `--radius-pipeline-card`.
- min-width `20px`, padding `4px` horizontal (`size-4`) / `2px` vertical (`size-2`), centered.
- badge text: Graphik LC Regular (400), caption 12px/16px, color `content-test/secondary` `#38373599` → `--color-pipeline-ink-muted`.
- Figma also lists a `BACKGROUND_BLUR` (backdrop-blur ~16px) effect on the badge. This is a cosmetic nicety over an opaque-ish surface; safe to OMIT — it has no visible effect on the flat panel background and there is no blur token. Note in code comment.

Net: this is a compact segmented control (white selected chip on a muted track, 12px caption text, 4–6px radii) — visually quite different from the current pill bar (`rounded-full`, dark `ink` selected bg, 14px body-s text). Expect a full rewrite of the tab class strings, not a tweak.

## Assumptions and Risks

- **Container radius has no 6px token.** Theme has `--radius-pipeline-card` (4px), `--radius-pipeline-card-lg` (16px), `--radius-pipeline-pill` (9999px). The Figma `radius-xl` = 6px maps to none. Options: (a) add a `--radius-pipeline-card-sm: 6px` token to `packages/ui/src/styles/theme.css` (cleanest, follows FRONTEND.md "no inline hex/radius" intent — radii are listed as token-consumed); (b) use a Tailwind arbitrary value `rounded-[6px]` with a token-less literal. Plan recommends (a) so the value is centralized and named, consistent with how every other Figma radius is tokenized. See Open Questions if the team prefers to avoid new tokens for a one-off.
- **In-Origination badge content is undefined by the API.** Per #717 the endpoint is deferred. The plan renders the Active count live and renders NO badge for In Origination (preferred: a disabled tab with no count reads cleaner than a fake number). The Figma mock shows a hardcoded `3`, but that is a static design value, not live data — replicating it would be a lie. See Open Questions.
- **Existing tests assert semantics, not styling.** `packages/frontend/src/routes/-dashboard.test.tsx` (describe "DeploymentMonitorPanel — tab bar") asserts `aria-selected` / `aria-disabled` and the three `data-testid`s. The restyle must preserve all of: `data-testid="loan-book-tab-bar"`, `loan-book-tab-active-loans`, `loan-book-tab-in-origination`, `role="tablist"`/`role="tab"`, `aria-selected`, `aria-disabled`. Keep them.
- **Loan count plumbing.** The view (`DeploymentMonitorPanel`) currently has no access to `loans.length`; the logic hook returns formatted `summary`/`rows` only. The badge count must come through `useDeploymentMonitorPanel` so the view stays JSX-only (FRONTEND.md rule 2). Add an `activeLoansCount` field to the hook's return type.
- **Count in non-ready states.** In loading/error/empty states there is no loan data. The tab bar is only rendered inside the `ready` branch of the panel today (it sits inside `PanelContainer` children, but `PanelContainer` swaps children for loading/error/empty placeholders — confirm). For `ready`, count = `data.loans.length`. If the tab bar were ever shown in empty state, count would be 0. Plan: `activeLoansCount` = `data.loans.length` when data present, else `0`.
- The In-Origination tab remains visually disabled (`opacity`, `cursor-not-allowed`, `aria-disabled`). Figma `3283:14480` shows it enabled-looking; #717's product decision overrides the mock. Keep disabled styling but adopt the new geometry/typography.

## Open Questions

- **In-Origination badge:** render NO badge (recommended), or a static placeholder matching the Figma `3`? The API serves no origination count and #717 deferred the tab. Recommendation: no badge until the endpoint exists. Confirm before implementing a placeholder number.
- **6px container radius:** add a named token `--radius-pipeline-card-sm: 6px` to `theme.css` (recommended, matches the project's tokenize-every-radius convention), or accept a one-off `rounded-[6px]` arbitrary value? Confirm preferred approach.

## Implementation Steps

1. ~~**Expose the active-loan count from the logic hook**~~ ✅ DONE — `packages/frontend/src/components/dashboard/useDeploymentMonitorPanel.ts`:
   - Added `activeLoansCount: number` to the `DeploymentMonitorPanelState` interface.
   - Set `activeLoansCount: 0` in loading/error/empty branches; `activeLoansCount: data.loans.length` in the ready branch.

2. ~~**(If Open Question resolved toward a token) add the 6px radius token**~~ ✅ DONE — `packages/ui/src/styles/theme.css`:
   - Added `--radius-pipeline-card-sm: 6px;` to both the `:root` block and the `@theme` block with a comment referencing Figma `radius/radius-xl` and node `3283:14480`.

3. ~~**Restyle the tab bar**~~ ✅ DONE — `packages/frontend/src/components/dashboard/DeploymentMonitorPanel.tsx`:
   - Full rewrite of the tab bar to segmented-control spec: container uses `--radius-pipeline-card-sm`, selected chip uses `--color-pipeline-surface`, all tabs use caption typography with `--font-body`.
   - Added `LoanBookTabBar` props interface with `activeLoansCount`.
   - Active Loans badge: `data-testid="loan-book-tab-active-loans-count"`, muted fill, caption text.
   - In Origination: no badge, comment explains why.
   - All `data-testid`/`role`/`aria-*` attributes preserved.
   - Backdrop-blur effect omitted with code comment (no blur token, no visible effect).

4. ~~**Wire the count through the view**~~ ✅ DONE — `DeploymentMonitorPanel` destructures `activeLoansCount` from `useDeploymentMonitorPanel()` and passes it to `<LoanBookTabBar activeLoansCount={activeLoansCount} />`.

5. ~~**Lint**~~ ✅ DONE — `npx tsx scripts/lint-docs.ts` passes (0 errors). `tsc --noEmit` passes. Frontend build succeeds.

## Test Strategy

Update/extend `packages/frontend/src/routes/-dashboard.test.tsx`, "DeploymentMonitorPanel — tab bar" describe:

- **Preserve existing assertions** — `aria-selected`/`aria-disabled` on both tabs and presence of the three `data-testid`s must still pass unchanged.
- **New: Active Loans badge shows the live count.** With `FIXTURE_FULL` (2 loans) mocked via the `pipeline.mock.api.GET./v1/loan-book` localStorage key, assert the Active Loans tab renders the badge with text `2` (use the badge `data-testid` to scope, since other `2`s may appear). Confirms `loans.length` plumbing.
- **New: In Origination renders no count badge** (per resolved Open Question — adjust if a placeholder is approved): assert the In-Origination tab contains no count badge element / no numeric badge testid.
- **Edge: empty/zero state.** Optional — assert that in the empty-loans branch the panel shows `PanelEmpty` (already covered) and the tab bar count logic defaults to 0 without throwing. (The tab bar is not rendered in the empty branch via PanelContainer, so this may be a no-op; verify during implementation and only add an assertion if the tab bar is visible.)
- Styling is verified visually against Figma (below), not via class-string assertions (brittle), except where an existing test already checks a class — none do for the tabs.

**Figma verification (manual / ux-tester):** run the app (`http://localhost:5188/dashboard` against the stage API) and compare the rendered tab bar to Figma `3283:14480`: white selected chip on muted track, 12px caption labels, 4–6px radii, the `Active Loans` count badge, and the muted disabled `In Origination` tab. Confirm no horizontal layout shift of the panel (width is #728's concern — do not alter it).

## Docs to Update

- No product-spec change — this is a visual/data-display bug fix, not a behavior change. The loan count is already part of the documented `/v1/loan-book` contract.
- If step 2 adds the `--radius-pipeline-card-sm` token: update `docs/FRONTEND.md` §"Design tokens" (the radii bullet, ~line 22) to list the new radius token and its Figma source.
- No `docs/frontend/*` hook/util doc change (no new hook; `activeLoansCount` is an internal field on an existing hook's return type).
