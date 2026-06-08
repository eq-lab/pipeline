# Issue #523: [FE] Mobile Activity page: with-data state (responsive layout + rows)

Source: https://github.com/eq-lab/pipeline/issues/523

## Scope

Adapt the existing Activity page (`/transactions`) so its **populated** state renders per the mobile Figma frame (`1993-9592`, 402×874). The desktop layout already exists and must keep working; this task adds responsive behaviour at the `md` (768 px) breakpoint.

Two concrete changes:

1. **Header** — `ActivityHeader` (`packages/ui/src/components/ActivityHeader/ActivityHeader.tsx`) becomes responsive: left-aligned heading with the HeroIcon hidden on mobile, reverting to the current centred icon+heading at `md+`. This mirrors the established `DepositHeader` mobile pattern.
2. **Page container** — the `<main>` wrapper in `packages/frontend/src/routes/transactions.tsx` adopts the mobile shell conventions used by `/deposit` and the home page: 8 px side margins on mobile, wider padding at `md+`.

**Row visuals are NOT in scope as new work** — `ActivityRow` / `renderRequestRow` already produce the exact rows shown in the mobile frame (status icon + type + timestamp left; primary amount + optional secondary line right). They are fluid flex rows (`flex-1 min-w-0`) and already adapt to the 386 px content width. Verify they render correctly at the mobile breakpoint; do not redesign them.

### Out of scope

- **Empty state** — sibling task #524.
- **The "All" tab** — intentionally absent (deliberately removed; see the comment in `transactions.tsx` and #257). The mobile Figma frame shows a leading "All" tab; ignore it. Default tab stays **Buy**; tabs stay **Buy / Sell / Stake / Unstake**.
- The global app top bar (logo + menu button, Figma node `1993:9620`) — that is the existing shell, not this page.
- Any API / data-fetching changes.

## Assumptions and Risks

- **Assumption:** "mirror the mobile header pattern used on `/deposit`" means making `ActivityHeader` itself responsive (icon `hidden md:block`, root `items-start md:items-center`, heading `text-left md:text-center`), exactly as `DepositHeader` does. The alternative — a separate mobile component — would duplicate logic; the responsive-component approach matches the established codebase convention.
- **Risk — shared component:** `ActivityHeader` is a `@pipeline/ui` primitive. Search confirms `/transactions` is its only app consumer (plus its Storybook story). Making it responsive does not regress any other call site, but the change must be verified against desktop (`md+`) to confirm the centred icon+heading treatment is preserved.
- **Assumption:** The mobile "Activity" heading uses the same `heading-m` (28 px / 36 px) scale as the current desktop heading. The Figma `Top` frame is 36 px tall (line-height 36), consistent with `heading-m`. The desktop heading currently uses `font-weight-bold` (700); `DepositHeader` mobile uses Besley Regular (400). See Open Questions on weight.
- **Risk — page padding parity:** `/deposit` uses `px-2 py-12 md:px-4` and home uses `px-2 ... md:px-8`. The current `/transactions` uses `py-8` with **no** horizontal padding and `max-w-[480px]`. The plan standardises on `px-2` (8 px) mobile margins per the issue; the `md+` desktop padding/width must be chosen so the desktop build is visually unchanged (see Implementation Steps).
- **Risk — vertical rhythm:** the Figma frame shows ~16 px gaps between rows (56 px row height, 72 px stride). `ActivityRow` already renders its own separators/spacing; confirm the list stride matches without adding row-level overrides.

## Open Questions

- **Heading font weight on mobile.** The current desktop `ActivityHeader` renders the "Activity" heading in **Besley Bold (700)**. The mobile frame's rendered screenshot shows a lighter serif weight, and the sibling `DepositHeader` mobile/desktop both use **Besley Regular (400)** (a human override on a prior issue). Should the mobile (and/or desktop) Activity heading switch to Regular (400) to match `DepositHeader`, or stay Bold (700)? Recommendation: match `DepositHeader` (Regular 400) at both breakpoints for cross-page consistency, but this changes the existing desktop weight, so confirm before implementing.

## Implementation Steps

1. **Make `ActivityHeader` responsive** — `packages/ui/src/components/ActivityHeader/ActivityHeader.tsx`:
   - Root container: change `flex flex-col items-center` to `flex flex-col items-start md:items-center` and add `w-full` (so the left-aligned heading fills the row on mobile). Mirror `DepositHeader` `rootClasses`.
   - HeroIcon: add `className="hidden md:block"` so the 72×72 `arrow-clock` icon is hidden below `md` and shown at `md+`.
   - Heading: add `text-left md:text-center` (replacing the unconditional `text-center`).
   - Resolve the weight per Open Questions; if switching to Regular, change `font-[var(--font-weight-bold)]` to `font-normal`.
   - Update the component JSDoc to document the two breakpoint treatments (cite mobile frame `1993-9592` and the existing desktop frame `1497-94912`), matching the `DepositHeader` doc style.
   - Keep the `<h2>` semantics and `aria-hidden` on the icon unchanged.

2. **Update the Storybook story** — `packages/ui/src/components/ActivityHeader/ActivityHeader.stories.tsx`: add (or confirm) a mobile-viewport story variant so the left-aligned, icon-hidden treatment is visible in Storybook. Follow whatever viewport-decorator pattern `DepositHeader.stories.tsx` uses.

3. **Adopt mobile page-shell margins** — `packages/frontend/src/routes/transactions.tsx`, the `<main>` element (currently `mx-auto flex w-full max-w-[480px] flex-col gap-6 py-8`):
   - Add horizontal padding: `px-2 md:px-…` so mobile gets 8 px side margins. Choose the `md:` value (and revisit `max-w`/`py`) so the **desktop** build is visually unchanged from today — i.e. keep the effective desktop content box at its current `max-w-[480px]` with its current padding. Concretely, prefer adding `px-2` and an `md:` horizontal padding that nets to the current desktop spacing rather than altering `max-w-[480px]`.
   - Update the leading block comment in `transactions.tsx` (lines 15–37) to note the responsive treatment and the 8 px mobile margin, referencing mobile frame `1993-9592`.

4. **Verify rows need no changes** — confirm `ActivityRow` (`packages/ui/src/components/ActivityRow/ActivityRow.tsx`) and `renderRequestRow` (`packages/frontend/src/components/activity/renderRequestRow.tsx`) render correctly at 386 px content width: status icon + title + timestamp left, amount block right, "Pending" secondary line on in-flight rows, two-line amounts on Stake/Unstake. Make no row-component edits unless a concrete mobile-width defect is found; if one is found, fix it in the shared component (rows must stay identical between the home card and `/transactions`).

5. **No data/logic changes** — `shouldRenderEmpty`, tab filtering, `TABS`, and the `useRequests` wiring are unchanged. Default tab stays `"buy"`.

## Test Strategy

Token-discipline and responsive layout are CSS-driven (Tailwind `md:` utilities), so the primary verification is visual against Figma; unit tests guard structure and the no-regression contract.

1. **Unit tests — `packages/ui/src/components/ActivityHeader` (add a colocated test if none exists, e.g. `ActivityHeader.test.tsx`):**
   - Renders an `<h2>` with the default title "Activity".
   - The HeroIcon carries the `hidden md:block` responsive classes (assert the class is present on the icon element) so it is hidden on mobile.
   - The root container carries `items-start md:items-center` (left-aligned mobile, centred desktop).
   - Custom `title` prop renders.
2. **Unit tests — `packages/frontend/src/routes/-transactions.test.tsx` (extend existing):**
   - All existing scenarios (default Buy tab, tab switching, "All" tab absent, empty/error/loading, formatting) must continue to pass unchanged.
   - Add an assertion that the `<main>` wrapper carries the mobile horizontal-padding class (`px-2`) so the 8 px margin contract is regression-guarded.
3. **Run the suites:** `npx tsx scripts/lint-docs.ts` for docs, plus the frontend/ui unit suites (vitest) for `ActivityHeader` and `-transactions.test.tsx`. Fix all lint before handing off.
4. **Figma visual verification (manual, by the coder):** run the app, open `/transactions` at 402×874, and populate rows via the `/test` Mocks tab scenarios `history-mixed` and `history-completed` (`packages/frontend/src/routes/test/-scenarios.ts`). Compare against mobile frame `1993-9592`:
   - Left-aligned "Activity" heading, no icon.
   - Tabs Buy / Sell / Stake / Unstake, **no "All"**, Buy active by default.
   - 8 px side margins; rows span the 386 px content width.
   - Completed rows show the dark amount pill; pending rows show the "Pending" secondary line; Stake/Unstake show two-line amounts.
   - Confirm the desktop (`md+`) view at `1497-94912` is visually unchanged (centred icon + heading).

## Docs to Update

- No product-spec change: `docs/product-specs/dashboards.md` already describes the LP transaction history; this task is a pure responsive-layout adaptation with no behaviour change.
- Update component JSDoc in `ActivityHeader.tsx` and the block comment in `transactions.tsx` (covered in Implementation Steps 1 and 3).
- `docs/FRONTEND.md` / `docs/frontend/index.md`: only touch if they enumerate per-page responsive status; otherwise no change. (Coder to check; not expected.)
