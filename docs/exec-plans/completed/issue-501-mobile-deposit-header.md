# Issue #501: Mobile /deposit: heading uses desktop treatment (centered bold + coin icon) instead of left-aligned mobile layout

Source: https://github.com/eq-lab/pipeline/issues/501

Parent epic: #498 (Deposit/withdraw page). Frontend flow.

## Scope

Fix the `DepositHeader` component (`packages/ui/src/components/DepositHeader/DepositHeader.tsx`) so the `/deposit` header matches Figma at both breakpoints. Today it renders a single treatment for all viewports: a centered 40px coin icon stacked above a centered `heading-m` (28px) heading at **font-weight 700**. Figma specifies two distinct treatments plus a weight correction.

What the Figma frames actually specify (verified via `get_design_context`, NOT just the issue prose — see Assumptions, the issue body's "36px row / regular weight serif" mobile description is inaccurate):

| | Coin icon | Alignment | Font size / line-height | Weight |
|---|---|---|---|---|
| **Desktop** (node 1498:100130, sub-node `6539:2329`) | shown, 72px in canvas (app renders 40px) | centered | `heading-m` 28px / 36px | **400 / Besley Regular** (`font-normal`, `'Besley:Regular'`) |
| **Mobile** (node 1993:7911, sub-node `6539:2322`) | **hidden** | **left-aligned**, container `px-8px`, `gap-l 32px` | `title` 64px / 64px | **700** (`'Inter_Display:700'` in the raw export, but the project's display face is Besley — see Open Questions Q3) |

In scope:
1. Hide the coin icon below the `md` breakpoint (768px); keep it at `md+`.
2. Left-align the heading below `md`; keep it centered at `md+`.
3. Step the heading size: mobile = `title` (64px/64px); desktop (`md+`) = `heading-m` (28px/36px).
4. Correct the desktop weight from 700 to regular (400) — Figma desktop text style is Besley Regular. (Pending Open Questions Q2 confirmation.)
5. Update the `DepositHeader.stories.tsx` doc comment / story to reflect the responsive behavior, and the component's JSDoc.

Out of scope (separate sub-issues of #498): the `(Min)` quick-amount chip (#502), the below-min banner (#503), the dimmed USDC input (#504), `StepsCard` mobile labels/buttons (#505), network-fee USD conversion (#506), mobile page margins / `px` of the `<main>` wrapper (#507). This plan touches **only the header component**, not `packages/frontend/src/routes/deposit.tsx` (the route passes `title` and a layout wrapper; the responsive logic lives entirely inside `DepositHeader`).

## Assumptions and Risks

- **The issue prose conflicts with the live Figma on two points; the Figma `get_design_context` output is treated as authoritative per the planner contract.** (a) The issue says the mobile heading is a "36px row … regular weight serif"; the Figma mobile node reports the `title` style = **64px/64px, weight 700**. (b) The issue's secondary note ("desktop Figma also shows regular weight, not 700") **is** corroborated by the desktop node, which is `font-normal` / Besley Regular. These discrepancies are surfaced in Open Questions rather than silently resolved.
- Mobile heading (64px) being **larger** than desktop (28px) is unusual but is exactly what the two frames show. The same inverted pattern already exists for the home page `WelcomeHeader` only in reverse (mobile 32px, desktop 64px). If a reviewer expects mobile ≤ desktop, this will look wrong — hence Open Questions Q1.
- `title` token (`--text-pipeline-title` = 64px/64px) already exists in `packages/ui/src/styles/theme.css` (lines 100-101). No new token is needed for the mobile size, and `heading-m` (lines 102-103) already exists for desktop. This avoids the token-vs-raw-value debate that blocked #473.
- `DepositHeader` lives in `packages/ui` (shared lib), so the change rebuilds the UI package; the only consumer is `packages/frontend/src/routes/deposit.tsx`. Low blast radius.
- Existing route tests (`packages/frontend/src/routes/-deposit.test.tsx`) assert the heading only by visible text (`getByText("1:1 Conversion")`, 7 call sites) — they do not assert weight, alignment, or icon presence, so they will not break. jsdom does not evaluate media queries, so the responsive split cannot be unit-tested for computed pixels; visual verification belongs in the browser/Figma step.
- Accessibility: the heading remains a single semantic `<h2>`. To keep one DOM node (avoid duplicate headings for screen readers) the responsive size/alignment should be class-driven on the same element, and the coin icon hidden via `md:`-gated `hidden`/`block` rather than two separate trees.

## Open Questions

- **Q1 (layout intent):** Figma mobile uses the 64px `title` heading while desktop uses the 28px `heading-m` heading — mobile is visibly larger than desktop. Confirm this inversion is intentional and not a stale/mislabeled mobile frame before shipping. If the intended mobile size is actually smaller, provide the correct value.
- **Q2 (desktop weight):** The issue asks to "check heading weight against the Figma text style." The desktop Figma node is Besley **Regular (400)**; the component currently hardcodes weight 700. Confirm the desktop heading should change from 700 → 400 as part of this fix (recommended, since it matches Figma), or whether the 700 is intentional and only mobile should change.
- **Q3 (mobile font family):** The mobile frame's raw export names the family `Inter_Display:700`, whereas the project display token `--font-display` is Besley and the desktop frame uses Besley. This is almost certainly a Figma library inconsistency, not a real intent to switch fonts on mobile. The plan assumes the mobile heading keeps `--font-display` (Besley) and only the size/weight/alignment change. Confirm we should NOT introduce Inter for the mobile heading.

## Implementation Steps

1. Edit `packages/ui/src/components/DepositHeader/DepositHeader.tsx`:
   - **Root container** (`rootClasses`): make alignment responsive. Mobile = left-aligned and full-width; desktop = centered. Replace `"flex flex-col items-center"` with `"flex flex-col items-start md:items-center w-full"`. Keep `gap-3` (or revisit gap, but gap only matters at `md+` where the icon shows — mobile has no icon so the gap is inert).
   - **Coin icon**: gate visibility with `md`. Wrap or add `className="hidden md:block"` on the `<CoinIcon>` so it is removed below `md` and shown at `md+`. (CoinIcon spreads `className` via `...rest` onto the `<img>`, confirmed in `packages/ui/src/components/CoinIcon/CoinIcon.tsx` — no signature change needed.)
   - **Heading** (`headingClasses`): make size + alignment + weight responsive.
     - Size: base (mobile) = `text-[length:var(--text-pipeline-title)]` + `leading-[var(--text-pipeline-title--line-height)]`; `md:` = `text-[length:var(--text-pipeline-heading-m)]` + `leading-[var(--text-pipeline-heading-m--line-height)]`.
     - Alignment: base `text-left`, `md:text-center` (replace the current unconditional `text-center`).
     - Weight (pending Q2): change `font-[var(--font-weight-bold)]` to `font-normal` (matches Figma Besley Regular at both breakpoints — both frames report weight; desktop is Regular, and per Q3 mobile keeps Besley). If Q2 says desktop should stay 700, instead use responsive `font-bold md:font-normal` or vice-versa per the answer. Add `w-full` so left-alignment fills the row on mobile.
   - Keep `font-[family-name:var(--font-display)]`, `text-[color:var(--color-pipeline-ink)]`, and `select-none` unchanged.
2. Update the component JSDoc block (lines ~4-27) to describe the two responsive treatments and reference both Figma nodes (desktop 1498:100130, mobile 1993:7911) instead of only the desktop node.
3. Update `packages/ui/src/components/DepositHeader/DepositHeader.stories.tsx`:
   - Fix the `meta.parameters.docs.description.component` text (currently says "Centered header … large PLUSD coin icon stacked above") to describe the responsive behavior and reference both nodes.
   - Optionally add a `Mobile` story using a Storybook viewport/decorator constrained to ~402px so the left-aligned, icon-less treatment is reviewable, mirroring the existing `AboveCard` story pattern.
4. No change to `packages/frontend/src/routes/deposit.tsx` — verify the `<DepositHeader title="1:1 Conversion" />` call and the `<main className="… max-w-lg … px-4 …">` wrapper still produce the correct left edge on mobile. (Wrapper padding/margins are #507's concern; do not modify here. If the 8px content margin from Figma cannot be achieved without touching the wrapper, note it for #507 rather than fixing inline.)
5. Run lint + type-check + tests (see Test Strategy). Do not commit (manager commits with the label change).

## Test Strategy

- **Unit (existing, must stay green):** `packages/frontend/src/routes/-deposit.test.tsx` — the 7 `getByText("1:1 Conversion")` assertions are text-only and unaffected. Run `yarn workspace @pipeline/frontend test`.
- **Do NOT add jsdom assertions for font-size/alignment/icon-visibility** — jsdom does not evaluate CSS custom properties or `md:` media queries, so any computed-style assertion would be meaningless/flaky (same rationale recorded in the #473 plan). If a lightweight regression guard is wanted, assert on the presence of the responsive class strings (e.g. the `<h2>` className contains `md:text-center` and the icon `<img>` className contains `hidden md:block`) — class-string assertions, not computed styles. This mirrors the `TopBar.test.tsx` convention (`expect(...).toContain("md:hidden")`).
- **Type-check / lint:** `tsc` over `packages/ui` and `packages/frontend`; `npx tsx scripts/lint-docs.ts` (expect 0 errors).
- **Figma-driven visual verification (primary gate):** run the app, navigate to `/deposit`.
  - At a 402px mobile viewport: confirm NO coin icon, heading is left-aligned at the content margin, and computed `font-size: 64px; line-height: 64px` (weight per Q2/Q3 answer). Compare against Figma node 1993:7911.
  - Resize to ≥768px (`md`): confirm the coin icon reappears centered above the heading, heading is centered, computed `font-size: 28px; line-height: 36px`, weight per Q2. Compare against Figma node 1498:100130.
  - Confirm the heading remains a single `<h2>` in the accessibility tree at both sizes (no duplicate headings).

## Docs to Update

- `docs/FRONTEND.md` — the "Responsive behavior" section (lines ~111-135) currently documents `WelcomeHeader` and home-card heading step-downs. Add a one-line note that `DepositHeader` hides the coin icon and left-aligns + enlarges its heading (to `title` 64px) below `md`, restoring the centered icon + `heading-m` treatment at `md+`. No new token is introduced (reuses existing `--text-pipeline-title` and `--text-pipeline-heading-m`), so the token list needs no change.
- No product-spec change required — this is a pure visual `fix/` with no user- or agent-facing behavior change (`docs/product-specs/deposits.md` describes flow, not header styling).
- If Q2 is answered "keep desktop 700" or Q1/Q3 surface a design-system inconsistency that we work around rather than fix, log it in `docs/exec-plans/tech-debt-tracker.md`.
