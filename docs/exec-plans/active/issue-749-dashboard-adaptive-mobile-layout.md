# Issue #749: Protocol Dashboard: adaptive (mobile) layout does not match Figma

Source: https://github.com/eq-lab/pipeline/issues/749

Parent epic: #712 (Protocol Dashboard). Type: `bug` / `frontend`.

Figma mobile frame (authoritative for this issue): `3283-71053` ("Dashboard — XS", 402px viewport)
https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-71053&m=dev

## Scope

Presentational / responsive only. Bring the `/dashboard` page's rendering at mobile widths (~375–430px) into line with the Figma XS frame `3283-71053`. No data, hook, endpoint, or formatting-logic changes. No changes to the desktop (`md+`) layout beyond what is strictly required to introduce a mobile branch.

**In scope**

- `packages/frontend/src/routes/dashboard.tsx` — page/content-container padding + section gaps at mobile.
- `packages/frontend/src/components/dashboard/YieldHistoryPanel.tsx` — metric-card grid behaviour at mobile.
- `packages/frontend/src/components/dashboard/LoanBookSummary.tsx` — Loan Book stat-card layout at mobile.
- `packages/frontend/src/components/dashboard/WithdrawalQueuePanel.tsx` — Withdrawal Queue stat-card layout at mobile.
- `packages/frontend/src/components/dashboard/LoanBookTable.tsx` — mobile table treatment (see Open Questions Q1).
- `packages/frontend/src/components/dashboard/WithdrawalQueueTable.tsx` — mobile table treatment (see Open Questions Q1).
- Regression test additions in `packages/frontend/src/routes/-dashboard.test.tsx` (bug DoD, ISSUE_PROTOCOL §3).

**Out of scope (do NOT touch)**

- **Balance Sheet / Statement of Financial Position content.** `BalanceSheetPanel.tsx` is still a "Coming soon" placeholder; the Figma frame shows the full Assets/Liabilities section, but building that content is the job of the separate OPEN, currently `blocked` sub-issue **#718 (Panel A: Balance Sheet & Reconciliation UI)**, which depends on a backend endpoint. #749 must NOT implement the balance-sheet body. It only ensures the placeholder participates correctly in the mobile stack.
- **Yield "TVL" area chart.** The Figma frame's first Yield chart card is a TVL area chart; the current panel intentionally omits TVL / by-source series pending backend **#738** (documented in `YieldHistoryPanel.tsx`). Per resolved Q2: render a **sized "Coming soon" placeholder** matching the Figma chart-card footprint now; the real chart is a follow-up once #738 lands.
- Global `TopBar` and `Footer` — provided by `packages/frontend/src/routes/__root.tsx`; the footer shipped in #746. The Figma frame's header/footer are already covered.
- Desktop (`md+`) layout, data hooks, API, number formatting.
- Product-spec changes (`docs/product-specs/dashboards.md` has no responsive section and no behaviour change occurs).

## Current state vs Figma — concrete gaps

Breakpoint context: existing dashboard code switches layouts at Tailwind `md` (768px), which is the project-wide mobile/desktop boundary (`docs/FRONTEND.md` §Responsive behavior). Below `md` the tables already branch to a mobile variant; the gaps below are about **whether that mobile variant matches Figma XS `3283-71053`**.

Figma frame geometry (from `get_metadata` on `3283:71053`): 402px frame, 370px inner content width, 16px page gutters.

1. **Content-container padding.** `dashboard.tsx` uses `p-4` (16px) on the white content container below `md`. Figma XS: content sits at x=16 inside a 402px frame with the container itself starting at x=0 and inner sections at 16px → effective 16px. This is close; verify the title/content gutter and the `py-8` page padding read correctly at 375–430px (no double gutter, no horizontal page scroll).

2. **Yield metric cards.** `YieldHistoryPanel.tsx` renders the metric cards `flex-col gap-3 sm:flex-row` — i.e. **single-column stacked** below the Tailwind `sm` (640px) breakpoint. Figma XS ("Second card pair", y=684, w=370 with three w=200 cards) shows a **2-up row** for the two live stat cards (`Current NAV / sPLUSD`, `Loan book yield`) as seen in the screenshot. Gap: the code stacks them 1-up on mobile; Figma shows 2-up. Note there are only **two** live metric cards visible in the XS screenshot vs three cards in code (the third, "Target Net to sPLUSD", is the #738 static seam). Per resolved Q3: **show all three cards on mobile — hide nothing** — and allow the row to scroll horizontally (or wrap) so every card stays reachable.

3. **Loan Book summary cards (`LoanBookSummary.tsx`).** Renders a horizontally-scrollable strip of five fixed 180px-wide cards below `md`. Figma XS Loan Book section ("Second card pair", y=64) shows the stat cards as w=200 cards in the 370px section — the screenshot shows the visible pair (`Total Deployed`, `Collateral`) as a **2-up row**, not a horizontally-scrolling strip. Gap: current horizontal-scroll strip vs Figma 2-up wrapping grid.

4. **Withdrawal Queue summary cards (`WithdrawalQueuePanel.tsx`).** Same pattern as (3): current code is a horizontally-scrollable `flex gap-4` strip of fixed 160px cards below `md`; Figma XS ("Second card pair", y=64 under the Withdrawal Queue section) shows the visible pair (`In Queue`, `Requests`) as a **2-up row**.

5. **Loan Book table.** `LoanBookTable.tsx` collapses to `MobileCards` (stacked label/value cards) below `md`. Figma XS keeps the **full 7-column desktop table** inside the section: the `Table container` is **w=1024** (columns 296/112/112/112/96/96/128) sitting in a 370px section → it **horizontally scrolls**. Gap: current stacked-card mobile treatment does not match the Figma horizontally-scrolling wide table. (Resolve direction in Open Questions Q1.)

6. **Withdrawal Queue table.** `WithdrawalQueueTable.tsx` collapses to `MobileCards` below `md`. Figma XS renders a **real 3-column table** (`Table container` w=370, three ~115px `Item` columns Holder/Amount/Status, `.row` h=64 each) that fits the mobile width — matching the screenshot, which shows a Holder/Amount/Status table with the colored `Processing` status. Gap: current stacked-card mobile treatment vs Figma 3-column table. (Resolve direction in Open Questions Q1.)

7. **Section stacking & gaps.** `dashboard.tsx` grid is `grid-cols-1 gap-12 md:gap-24` — already single-column full-width at all widths (correct per Figma). Verify the 48px (`gap-12`) inter-section gap reads correctly against the XS frame's section offsets and that the "Show N more" affordances sit correctly.

8. **Chart sizing.** The Cumulative Yield chart is fixed `h-[120px]`. Figma XS Cumulative Yield chart container is h=144 (chart 144). Verify chart height/overflow at 375–430px so the bars are not clipped or squashed.

## Assumptions and Risks

- **Assumption:** the `md` (768px) breakpoint remains the mobile/desktop boundary (project convention, `docs/FRONTEND.md`). The Figma XS frame is 402px, well inside `< md`, so mobile classes apply. No new breakpoint is introduced unless Q1/Q3 answers require a distinct `sm`↔`md` step.
- **Risk (tables):** Q1 governs the largest change. If Figma's literal "horizontally-scrolling wide loan table + real 3-col withdrawal table" is adopted, the existing `MobileCards` code paths and their tests (`-dashboard.test.tsx` "responsive structure" asserting `md:hidden`/`hidden md:block`) must be revised. If the coordinator prefers keeping the stacked-card mobile UX (arguably better for touch), the change is smaller and the divergence is intentional. This is a real decision, not a planner call — see Q1.
- **Risk (balance sheet):** the Figma XS frame shows the full Statement of Financial Position, but #718 owns that and is `blocked`. The visual gap for that section will remain until #718 lands; #749 must not attempt it. QA/reviewers comparing against the full frame will see the placeholder — call this out in the PR description.
- **Risk (Yield TVL chart):** the XS frame's first chart card (TVL area chart) cannot be built without #738 data. #749 leaves the single Cumulative-Yield card. Same PR-description caveat.
- **Risk (2-up card overflow):** two 200px Figma cards + gap ≈ 416px exceed the 370px content width; the design tolerates slight card compression. Implement the 2-up as a responsive grid (`grid-cols-2`) that shrinks cards to fit rather than a fixed 200px width, to avoid horizontal page scroll (FRONTEND.md wide-content rule).
- **Constraint:** token discipline (FRONTEND.md) — no raw hex/font names; all colors/typography via `@pipeline/ui` primitives and theme tokens. Pixel `min-w`/`h-[...]` layout hints are allowed as sizing (already used across these files).

## Open Questions

_Resolved by human (2026-07-02):_

1. **Mobile table treatment** — RESOLVED: **match Figma exactly.** Render real tables on mobile: the Loan Book as the full 7-column desktop table that **horizontally scrolls** inside the section, and the Withdrawal Queue as a **real 3-column** table (Holder / Amount / Status). Replace the current stacked label/value `MobileCards` treatment for both, and update the existing responsive tests accordingly.
2. **Yield TVL area chart** — RESOLVED: **add a sized placeholder** ("Coming soon", matching the Figma chart-card footprint) so the mobile rhythm matches now; the real TVL area chart is a **follow-up once backend #738 lands**. Note this seam in the PR description.
3. **Third Yield metric card on mobile** — RESOLVED: **show everything, hide nothing.** Keep all three metric cards visible on mobile; do not hide the third. Allow the card row to **scroll horizontally** (or wrap) so all cards remain reachable rather than being dropped.

## Implementation Steps

> Table steps assume Q1 = "match Figma exactly" (resolved): real tables on mobile, not stacked cards.

1. **Reproduce & baseline (no code).** Run the app (`/dashboard`) and inspect at 375px, 402px (Figma XS width), and 430px using Chrome DevTools MCP device emulation. Screenshot each section and diff against `3283-71053`. Confirm the gaps enumerated above and capture any not yet listed. Record findings in the PR description.

2. **Page & content-container padding (`dashboard.tsx`).** Verify/adjust the content container so mobile padding is 16px and there is no horizontal page overflow at 375–430px. Keep the existing `grid-cols-1 gap-12 md:gap-24` section stack (already Figma-correct). Do not change desktop behaviour.

3. **Stat-card grids (2-up on mobile).**
   - `YieldHistoryPanel.tsx`: change the metric-cards container from `flex-col gap-3 sm:flex-row` to a mobile 2-up layout (e.g. `grid grid-cols-2 gap-3 md:flex md:flex-row md:gap-3`), so the two live cards sit side-by-side at mobile and the row layout is restored at `md+`. Resolve Q3 for the third card (hide at `<md` via `hidden md:flex`, or let it wrap onto a second row — pick per Q3 answer).
   - `LoanBookSummary.tsx`: replace the `< md` horizontally-scrollable fixed-180px strip with a 2-up responsive grid (`grid grid-cols-2 gap-4 md:grid-cols-5`), dropping the `min-w-[180px]` fixed width and the outer `overflow-x-auto` at mobile so cards shrink to fit the 370px width instead of scrolling. Keep the `md:grid-cols-5` desktop grid untouched.
   - `WithdrawalQueuePanel.tsx`: same conversion — `grid grid-cols-2 gap-4 md:grid-cols-4`, drop `min-w-[160px]` and mobile `overflow-x-auto`.
   - Preserve card surface tokens (asymmetric depth border, radius, padding) and the fixed 144px card height.

4. **Loan Book table on mobile (gated on Q1 = "match Figma").** In `LoanBookTable.tsx`, render the 7-column desktop `<table>` at mobile inside an `overflow-x-auto` wrapper (it already lives in `overflow-x-auto`), removing the `hidden md:block` / `block md:hidden` split so the wide table shows and horizontally scrolls at all widths. Delete or gate the `MobileCards`/`MobileField` stacked-card path. If Q1 = "keep stacked cards", leave this file unchanged except any spacing fix.

5. **Withdrawal Queue table on mobile (gated on Q1 = "match Figma").** In `WithdrawalQueueTable.tsx`, show the 3-column desktop `<table>` at mobile (it fits 370px per Figma `Item` widths ~115px each) by removing the `hidden md:block` / `block md:hidden` split, and remove/gate `MobileCards`. Keep the status color logic (`statusColorClass`) intact. If Q1 = "keep stacked cards", leave unchanged except spacing.

6. **Chart sizing.** In `YieldHistoryPanel.tsx`, verify the Cumulative Yield chart container height reads correctly at mobile (Figma chart h=144); adjust `h-[120px]` only if the rendered bars are clipped/squashed at 375–430px. Do not alter `YieldBarChart` internals.

7. **Balance Sheet placeholder.** Confirm `BalanceSheetPanel.tsx` (empty "Coming soon") stacks cleanly in the mobile column with correct gaps. Do NOT implement Statement-of-Financial-Position content (#718).

8. **Lint & typecheck.** Run the frontend lint/type checks and `npx tsx scripts/lint-docs.ts` (AGENTS.md). Fix all errors before completion.

9. **Live verification.** Re-run Chrome DevTools MCP at 375/402/430px, screenshot each section, and confirm against `3283-71053`. Attach before/after screenshots to the PR. Note the two known unavoidable divergences (Balance Sheet body #718, Yield TVL chart #738) in the PR description.

## Test Strategy

Bug DoD (ISSUE_PROTOCOL §3): the fix must ship with a regression test. Add/adjust tests in `packages/frontend/src/routes/-dashboard.test.tsx` (Vitest + Testing Library; the file already mocks wagmi/AppKit/env and renders panels).

- **Stat-card grid regression (always):** assert the Yield metric-cards container, `loan-book-summary-cards`, and `withdrawal-queue-summary-cards` carry the mobile 2-up grid classes (`grid-cols-2`) and the correct `md:` desktop classes (`md:grid-cols-5` / `md:grid-cols-4` / `md:flex-row`). Assert no `overflow-x-auto` fixed-width strip remains on mobile for the summary rows (or that fixed `min-w-[...]` is removed), guarding against regression back to the scrolling-strip layout.
- **Table treatment regression (gated on Q1):**
  - If Q1 = "match Figma": update the existing `DeploymentMonitorPanel — responsive structure` test (currently asserts `hidden md:block` / `block md:hidden`) to assert the loan table renders as a single `overflow-x-auto`-wrapped `<table>` at all widths and that the stacked `loan-book-table-mobile` path is gone; add an equivalent assertion for the withdrawal table showing 3 columns at mobile.
  - If Q1 = "keep stacked cards": keep the existing responsive-structure assertions and add a comment documenting the intentional deviation from `3283-71053`.
- **Section stack regression (always):** keep/extend the existing "single-column stack (`grid-cols-1`, no `md:grid-cols-2`)" and panel-order assertions.
- **Placeholder guard:** keep the existing assertion that exactly one "Coming soon" (Balance Sheet) placeholder renders, so #749 does not accidentally alter panel composition.
- Run the full fast frontend suite (`/test-fast`) and ensure green. Live-render verification via Chrome DevTools MCP (step 9) supplements, but the committed regression guard is the Vitest assertions above (JSDOM cannot assert real responsive pixel layout, so tests assert the responsive class contracts).

## Docs to Update

- None required. `docs/product-specs/dashboards.md` has no responsive section and this is a presentational bug fix with no behaviour change. If Q1 resolves to change the mobile table treatment materially, add a one-line note to `docs/FRONTEND.md` §Responsive behavior describing the dashboard's mobile table behaviour (optional, coordinator's call).
