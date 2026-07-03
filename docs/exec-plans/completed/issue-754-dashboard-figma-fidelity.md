# Issue #754: Protocol Dashboard: layout does not match Figma (spacings, font-sizes)

Source: https://github.com/eq-lab/pipeline/issues/754

## Scope

A design-fidelity pass on the **desktop** Protocol Dashboard (`/dashboard`) so that spacing (gaps, paddings, margins) and typography (font-size, weight, line-height) match the Figma full-page frame `3283:12101` (linked node `3283-12101`) exactly, using values pulled from Figma dev-mode metadata + variables rather than eyeballing.

In scope — the following rendered surfaces, all under `packages/frontend/src/components/dashboard/` plus the route:

- Page/route shell — `routes/dashboard.tsx`
- Shared panel chrome — `PanelContainer.tsx`
- Dashboard header (Yield History panel: TVL / Cumulative Yield / metric cards) — `YieldHistoryPanel.tsx`, `YieldBarChart.tsx`
- Balance Sheet ("Statement of Financial Position") — `BalanceSheetPanel.tsx`
- Loan Book — `DeploymentMonitorPanel.tsx`, `LoanBookSummary.tsx`, `LoanBookTable.tsx`
- Withdrawal Queue — `WithdrawalQueuePanel.tsx`, `WithdrawalQueueTable.tsx`

Out of scope:

- Mobile / adaptive layout (frame `3283:72387`) — owned by the already-closed #749. Only touch mobile utilities where a desktop fix forces a matching mobile value (call it out in the step).
- Structural / data changes: white container (#744), footer (#746), Withdrawal Queue behaviour (#741/#742), Loan Book columns/data (#726–#730). This issue is spacing + type only; do not add/remove columns, rows, panels, or data fields.
- Any backend or API change.

## Ground-truth values pulled from Figma (`3283:12101`, desktop, content width 1136px)

Container `3283:12101`: 1200px wide, **32px padding** all sides → 1136px content column.

**Top-level section rhythm (page-level):**

- Gap between the four top-level sections (Top/Yield → Balance Sheet → Loan Book → Withdrawal Queue) = **96px** (`gap-xxl`). Measured: Top ends y=492, Balance Sheet at y=588; each subsequent section is +96 from the prior section's bottom. Current route uses `gap-12` (48) mobile / `md:gap-24` (96) desktop — desktop is already correct; only revisit the mobile value under the mobile-scope open question.
- Within a section: **section heading** (h=56) → content gap = **32px** (`gap-l`). Current shared `PanelContainer` uses `gap-4` (16) — **wrong, must be 32px**.

**Section heading typography (the panel titles):**

- Figma nodes `3283:14276` (Balance Sheet), `3283:14432` (Loan Book), `3283:14894` (Withdrawal Queue): **Heading L = 48px / 56px, weight 400 (Regular), Besley (display serif)**, colour ink.
- The shared `PanelContainer` currently renders titles at `heading-m-mobile` (20) → `md:heading-m` (28) — **wrong; desktop must be heading-l 48/56, weight 400**. `BalanceSheetPanel` already renders its own title at responsive heading-m→`md:heading-l` (correct on desktop) and does NOT use `PanelContainer` for the title, so its title is fine; the Loan Book and Withdrawal Queue panels rely on `PanelContainer.title` and are wrong.

**Balance Sheet column internals (`3283:14278`) — already largely correct, verify:**

- Column heading ("Assets"/"Liabilities") = Heading M 28/36. Column-heading → body-card gap = 16px.
- Card body padding = **16px** (`p-4`). Sub-section gap = **32px** (`gap-8`). Sub-section header → list gap = **16px** (`gap-4`).
- Sub-section header ("Liquid") = Heading 20 (20/28, weight 400, display serif) — node `3283:14286`.
- Row (`3283:14288`): `border-t`, `pt-4 pr-4` (16px), label↔amount gap 12px (`gap-3`). Label = Body 16/22 weight 400 **muted/secondary** colour; amount = Body 16/22 weight 400 ink. Current `BalanceSheetPanel` matches these — treat as reference-correct; only adjust if live comparison shows drift.

**Loan Book summary cards (`3283:14434`) & Withdrawal Queue summary cards (`3283:14896`):**

- Card: h=144, **padding 16px** (`p-4`), inter-card gap **16px** (`gap-4`). Current matches.
- Card label ("Total Deployed", `3283:14435`): applied font = Graphik LC (text family), **16px / 20px, weight 400** (`font/title-font-weight` resolves to Regular). Current `font-body font-normal text-[16px] leading-[20px]` matches.
- Card value ("$31.6M", `3283:14436`): "Heading 20" = **20px / 28px, weight 400, Besley (display)**. Current `font-display font-normal text-[20px] leading-[28px]` matches.

**Loan Book table (`3283:14552`) — main spacing defect:**

- Table container: padding 16px (`p-4`); tabs (`3283:14480`, h=36 at y=16) → table gap = **24px** (`gap-6`). Current matches.
- Header row (`3895:8038`): h=24, caption cells vertically centred (`py-[4px]`), **Caption 12/16 weight 400 muted**. Header → first row gap = **8px** (content starts +8 below header). Current header uses `pb-2` (8) which produces the 8px, acceptable.
- Body row (`3895:8061` / `.row` `3283:14512`): `flex items-center px-0 **py-[12px]**`, `border-t`, inter-column cell gap 12px. Cell text = **Body 16/22 weight 400 ink**.
  - **DEFECT:** current `LoanBookTable` cell uses `py-3` (12) **plus** an inner `<span className="block py-2">` (8) = 20px top/bottom, making rows ~64→ taller and misaligned vs Figma's exact 12/12. Fix: drop the inner `py-2` (use plain `block`/`block truncate` with no vertical padding) so the row is exactly `py-3` = 12/12.

**Withdrawal Queue table (`WithdrawalQueueTable`)** — same `py-3` + inner `py-2` double-padding defect as Loan Book; apply the same fix. Header/body typography same tokens as Loan Book (Caption header, Body cells).

**Yield History / dashboard header (`3283:67619` "Top"):**

- Two `card-horizontal` (560px each) with **16px gap** between the pair, then a "Second card pair" row of three metric cards (h=144) with **16px gaps**. Vertical gap between the chart-pair row and the metric-card row = 16px (measured: 428 − 412... verify live). Card padding 16px.
- Cumulative Yield / TVL headline value = heading-m responsive; eyebrow = Caption 12/16 muted. Current `YieldHistoryPanel` uses `gap-6`, `gap-4`, `gap-3` in places — reconcile the metric-card row gap to **16px** (`gap-4`) to match Figma (currently `gap-3` = 12 on the metric row) and verify the chart-pair gap.

## Assumptions and Risks

- **Assumption:** the desktop frame `3283:12101` is the authoritative reference; the issue's linked node is exactly this frame. Confirmed via `get_metadata`/`get_design_context`.
- **Assumption:** token discipline (FRONTEND.md) is preserved — sizes/weights flow through `--text-pipeline-*` / `--font-weight-*` / Tailwind numeric spacing, no raw hex. All required tokens already exist in `packages/ui/src/styles/theme.css` (`heading-l` 48/56, `heading-m` 28/36, `heading-s` 20/28, `body` 16/22, `caption` 12/16). No new token is needed unless the 16px/20px summary-card label (a 16px size with a 20px line-height) needs a token — it currently uses `text-[length:var(--text-pipeline-body)]` + `leading-[20px]`; leave as-is (body is 16/22, so the 20px line-height is an intentional override).
- **Risk — shared `PanelContainer` title change has blast radius.** Changing the title from heading-m to heading-l affects every panel that passes `title`. `BalanceSheetPanel` renders its own title (bypasses `PanelContainer.title`), Yield History passes no title, so only Loan Book + Withdrawal Queue consume it. Verify the `-dashboard.test.tsx` and `DeploymentMonitorPanel.test.tsx` assertions don't pin the old size/classes; update snapshots/expectations if they do.
- **Risk — row-height change alters vertical layout** of both tables; the fixed table-container heights / any `min-h` in tests may need updating. The Figma row is 64px (12+40+12). Confirm the cell content block is 40px tall (single-line 22px line-height + centring), which it is via `items-center`.
- **Risk — "line-height 20 on a 16px body label" (summary-card label)** is a deliberate Figma override, not the body token's 22px. Keep the explicit `leading-[20px]`; do not "correct" it to the body line-height.
- **Dependency:** none blocking. #749 (mobile) and #744 (white container) are closed/merged; this branch (`feat/755-in-origination-tab`) is unrelated — the coder should branch fresh from `main` per AGENTS.md, not stack on #755.

## Open Questions

1. **Font weight on serif headings.** Figma's `Heading L` / `Heading M` / `Heading 20` variable definitions declare `weight: 700`, but every applied text node resolves the weight through `font/title-font-weight` = **Regular (400)** (confirmed in `get_design_context` for nodes `3283:14276`, `3283:14286`, `3283:14436`). The current codebase renders these serif headings at weight 400. The plan assumes **400 (Regular) is correct** because that is the applied value on the frame. Confirm this is intended and we are not meant to render Besley Bold (700) for section/column headings.
2. **Mobile section gap.** Desktop section gap is 96px (already matched by `md:gap-24`). The route uses `gap-12` (48) below `md`. The desktop reference frame does not specify the mobile value and mobile is out of scope (#749, closed). Should the mobile section gap stay at 48px, or is a mobile Figma value expected here too? (Left unchanged unless directed.)

## Implementation Steps

1. ~~**Branch.** From `main`: `git checkout main && git pull && git checkout -b fix/754-dashboard-figma-fidelity`. Do not stack on the current `feat/755-*` branch.~~ ✅ Branch already created: `fix/754-dashboard-figma-spacing-typography`.

2. ✅ **`PanelContainer.tsx` — heading size + heading-to-body gap.**
   - Changed `titleClasses` to Heading L on desktop (`md:text-[length:var(--text-pipeline-heading-l)]` / `md:leading-[var(--text-pipeline-heading-l--line-height)]`), mobile stays `heading-m`. Weight `font-normal` (400) per Open Question 1 resolution.
   - Changed wrapper gap on both `borderless` and `Card` branches from `gap-4` to `gap-8` (32px).
   - Removed `pt-4` from `DeploymentMonitorPanel` and `WithdrawalQueuePanel` body wrappers to avoid double-spacing (was 16+16=32; now 32+0=32, correct).

3. ✅ **`LoanBookTable.tsx` — remove double vertical padding in body cells.**
   - Changed `bodyCellInnerClasses` from `"block py-2"` to `"block"`.
   - Changed `firstBodyCellInnerClasses` from `"block truncate py-2"` to `"block truncate"`.

4. ✅ **`WithdrawalQueueTable.tsx` — same double-padding fix.**
   - Changed `bodyCellInnerClasses` from `"block py-2"` to `"block"`.
   - Changed `firstBodyCellInnerClasses` from `"block truncate py-2"` to `"block truncate"`.

5. ✅ **`YieldHistoryPanel.tsx` — metric-card row + chart-pair gaps.**
   - Changed metric-cards row gap from `gap-3` (12px) to `gap-4` (16px).
   - Changed outer flex column gap from `gap-6` (24px) to `gap-4` (16px): XS frame confirms 16px gap between Charts (ends y=668) and Second card pair (starts y=684) in `3283:71053`.

6. ✅ **`BalanceSheetPanel.tsx`, `LoanBookSummary.tsx`, `WithdrawalQueuePanel.tsx` summary cards — verified.** No changes needed; values already match Figma.

7. ✅ **`routes/dashboard.tsx` — verified section gap.** Desktop `md:gap-24` (96px) already correct. Mobile `gap-12` (48px) confirmed from XS frame `3283:71053`: Top→Balance Sheet gap = 892 - 844 = 48px; all subsequent sections also 48px.

8. ✅ **Token check.** No raw hex/font-name literals introduced; all values use Tailwind numeric spacing or `--text-pipeline-*` / `--font-*` tokens.

9. **Lint + build.** Run `npx tsx scripts/lint-docs.ts` (docs), and the frontend typecheck/lint per project scripts; fix all errors.

## Test Strategy

- **Update existing unit tests** to reflect the new values, not the old ones:
  - `packages/frontend/src/routes/-dashboard.test.tsx`
  - `packages/frontend/src/components/dashboard/DeploymentMonitorPanel.test.tsx`
  - `useBalanceSheetPanel.test.tsx`, `useWithdrawalQueuePanel.test.tsx`, `useYieldHistoryPanel.test.tsx`, `useDeploymentMonitorPanel.test.tsx` (logic hooks — likely unaffected, but run them).
  - Grep these tests for pinned class strings / heading sizes (`heading-m`, `py-2`, `gap-4` on the panel title) and update any assertion that encodes the old spacing/typography.
- **Add/adjust assertions** where cheap and stable: assert `PanelContainer` title carries the heading-l desktop token class; assert table body cells no longer carry the inner `py-2`. Prefer testid/role-based assertions over brittle full-className matches.
- **Visual Figma verification (required — Figma link present).** After the change, run the app and compare `/dashboard` at desktop width (≥1200px, e.g. 1280) against Figma `3283:12101` using Chrome DevTools MCP: verify (a) 96px between sections, (b) 32px between each section heading and its content, (c) section headings render at 48px/56px, (d) table rows are 64px tall with 12/12 padding and body text 16/22, (e) summary-card label 16/20 and value 20/28. Capture before/after screenshots.
- Full run: `yarn` frontend unit tests must pass; there is **no ux-tester phase** for the frontend flow (AGENTS.md) — the planner-gated Figma verification above is the fidelity check.

## Docs to Update

- No product-spec change (pure visual fidelity, no behaviour change) — `docs/product-specs/dashboards.md` unchanged.
- If the `PanelContainer` title type-scale change is generalised, note it in `docs/FRONTEND.md` "Responsive behavior" only if it introduces a new responsive rule; otherwise no doc change.
- On completion, move this plan to `docs/exec-plans/completed/` (manager handles archival with the label change).
