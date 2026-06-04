# Issue #479: Mobile home: cards row overflows the 8px right page margin (Stake card flush to viewport edge)

Source: https://github.com/eq-lab/pipeline/issues/479

Sub-issue of Epic #463 (Home page). Frontend flow, `bug`. Working branch:
`fix/479-cards-row-overflow` (freshly cut from `origin/main`).

This is a visual/layout regression on the **mobile** home page (`/`) in the
**wallet-disconnected** state at a 402px viewport. Figma reference (mobile
disconnected frame): `1989:8292`; the offending row is node `1989:9006`.

## Scope

In scope:

- Constrain the mobile "cards row" (`data-node-id="1989:9006"` in
  `packages/frontend/src/routes/index.tsx`) so it respects the page's 8px right
  padding. Target end state at a 402px viewport:
  - Row width 386px (left edge x=8, right edge x=394).
  - Left column (`StartHereCard` + `EarnedCard` stack) = 189px.
  - 8px gap.
  - Right column (`StakeCard`) = 189px.
  - Row right edge flush with the `ConnectWalletPromoCard` above it (x=394).

Out of scope:

- The desktop (md+) layout — the 7-column grid block must remain visually
  unchanged.
- The connected-wallet states (`PortfolioPlaceholderCard`, balance states A/B/C).
  The row layout is shared across states, so the fix applies to all of them, but
  the bug was reported and must be verified in the disconnected state first; the
  connected states must be spot-checked for no regression (see Test Strategy).
- Any change to the `main` page padding mechanism (`px-2`) — see Open Questions /
  Risks, this is touched by other in-flight issues.

## Root cause analysis

Relevant layout in `packages/frontend/src/routes/index.tsx`:

- `main` is `className="... px-2 ... md:px-8"`. `px-2` = 8px horizontal padding.
  At a 402px viewport the content box is `402 − 8 − 8 = 386px`. The
  `ConnectWalletPromoCard` (a block-level, full-width child of `main`) correctly
  fills this 386px box and ends at x=394 — confirming the content box is 386px.
- The cards row (line ~189) is `<div className="flex gap-2" data-node-id="1989:9006">`
  with two children:
  - Left: `<div className="flex flex-1 flex-col gap-2" data-node-id="1989:9007">`
    wrapping `StartHereCard` (`className="flex-1"`) + `EarnedCard`. This column is
    `flex-1` (`flex: 1 1 0%`).
  - Right: `StakeCard` with inline `style={{ width: 189, flexShrink: 0 }}`.
- `gap-2` = 8px gap. Tailwind preflight applies `box-sizing: border-box`
  globally, so the StakeCard's `width: 189` is a border-box 189px (its `p-6` +
  borders are included) — the right column is exactly 189px. That part is correct.

The defect: the cards row renders **394px** wide (left column 197px, right edge
at x=402), 8px wider than its 386px parent content box. The extra 8px lands
entirely in the `flex-1` left column (197 = 189 + 8), pushing the StakeCard's
right edge flush to the viewport at x=402 and eating the 8px right page margin.

A flex container exceeding its parent's content box is the classic flexbox
**min-content overflow**: flex items default to `min-width: auto`, so the
`flex-1` left column refuses to shrink below the min-content width of its
contents (`StartHereCard` heading/CTA row, `EarnedCard`). Combined with the
fixed 189px + 8px gap right side, the row's min-content width exceeds 386px and
the container overflows to the right rather than shrinking the left column to
189px. (The exact pixel mechanism should be confirmed in-browser — see Test
Strategy — but the fix below is robust to either a min-width overflow or a plain
width-resolution issue.)

## Assumptions and Risks

- Assumption: the reported numbers (row 394px, left col 197px, Stake right edge
  x=402) are from the current checkout. Recent merges (#475–#478, #480) changed
  the row's child components (StartHereCard buttons, StakeCard CTA/copy, promo
  graphic) but did not change the row container's flex sizing in `index.tsx`, so
  the overflow mechanism is unchanged. The coder must reproduce against the
  current branch before fixing.
- Risk — shared padding mechanism: issues #474 (parked, "padding mechanism
  question"), #481, and #482 are in flight and touch mobile header/page padding.
  The fix here must be **local to the cards row** and must NOT alter the `main`
  `px-2`/`md:px-8` page padding, to avoid colliding with that work. If a merge
  from those issues changes `main`'s padding before this lands, re-verify the
  386px content-box assumption.
- Risk — over-constraining: hard-coding the row to a fixed `386px` width would
  break at viewports other than 402px (e.g. 360px, 430px). The fix must keep the
  row fluid (`w-full` relative to the 386px content box) so it scales with
  viewport width while always honoring the page padding.
- Risk: adding `min-w-0` to the left column lets it shrink below its content's
  min-content width; verify `StartHereCard`/`EarnedCard` contents don't visually
  clip or wrap badly at 189px (they were designed for 189px per Figma, so this
  should be fine, but confirm in-browser).

## Open Questions

_None._

The fix is a self-contained CSS/layout correction with a clear Figma target
(189px + 8px + 189px = 386px, right edge x=394). No product or design decision
is required. The shared-padding collision with #474/#481/#482 is a sequencing
risk noted above, not an open decision — the fix is scoped to not touch page
padding.

## Implementation Steps

All changes in `packages/frontend/src/routes/index.tsx`, in the mobile block
(`<div className="flex flex-col gap-2 md:hidden">`):

1. Constrain the cards row container to its parent content box so it cannot
   overflow to the right. On the row div (`data-node-id="1989:9006"`) change
   `className="flex gap-2"` to `className="flex w-full gap-2"` (and add
   `max-w-full` if needed to defeat min-content overflow). This forces the row to
   resolve against the 386px content box rather than its min-content width.

2. Allow the `flex-1` left column to shrink to the available space (defeat the
   default `min-width: auto`). On the left column div
   (`data-node-id="1989:9007"`) change
   `className="flex flex-1 flex-col gap-2"` to
   `className="flex min-w-0 flex-1 flex-col gap-2"`. With `min-w-0`, the column
   shrinks to `386 − 189 − 8 = 189px` instead of clamping at its content
   min-width (197px+).

3. Leave the `StakeCard` right column unchanged (`style={{ width: 189,
   flexShrink: 0 }}`) — it is already correct at 189px.

4. Do NOT touch the `main` element's `px-2 md:px-8` padding, nor the desktop
   grid block.

5. Reproduce-then-fix order: before editing, load `http://localhost:5173/` at a
   402px viewport (wallet disconnected) and measure the row to confirm 394px /
   197px / x=402. After the edit, re-measure to confirm 386px / 189px / 189px /
   right edge x=394.

Note: steps 1 and 2 are complementary; the coder should apply both, then trim to
the minimal set that achieves the target (verified in-browser). `min-w-0` on the
left column is the load-bearing change for min-content overflow; `w-full` on the
row guards against width-resolution overflow.

## Test Strategy

This is a frontend visual fix (no testing phase in the frontend flow per
`AGENTS.md`), but the change must be verified and must not regress existing
behaviour:

1. **Figma-driven visual verification (primary).** With the dev server at
   `http://localhost:5173/`, emulate a 402px-wide mobile viewport, wallet
   disconnected. Using Chrome DevTools (or `getBoundingClientRect` via
   `evaluate_script`), assert on the row `[data-node-id="1989:9006"]`:
   - `rect.left ≈ 8`, `rect.right ≈ 394`, `rect.width ≈ 386`.
   - Left column `[data-node-id="1989:9007"]` width ≈ 189px.
   - `StakeCard` (the row's second child) width ≈ 189px, right edge ≈ 394.
   - Stake card right edge aligns with the `ConnectWalletPromoCard` right edge
     above it (both ≈ 394). Compare against Figma mobile frame `1989:8292`
     (row node `1989:9006`).

2. **No-regression checks:**
   - Connected states (A empty / B has PLUSD / C has sPLUSD): the row keeps the
     same 386px / 189+189 geometry; cards do not clip or overflow.
   - Other narrow viewports (e.g. 360px, 430px): the row stays within the
     content box (no horizontal scroll, right edge always = viewport − 8px).
   - Desktop (≥768px): the md+ 7-column grid is visually unchanged.

3. **Existing unit tests.** Run the home route tests
   (`packages/frontend/src/routes/-index.test.tsx`) to confirm no breakage; these
   are behavioural/string tests and should be unaffected, but a class-name change
   must not break any test that asserts on the row's structure. Run the
   frontend test suite (lint + unit) before opening the PR.

4. **Lint/build.** `npx tsx scripts/lint-docs.ts` for this plan doc, and the
   frontend lint/build for the code change.

## Docs to Update

None. This is a pure layout fix that does not change product or agent-facing
behaviour, so no `docs/product-specs/` or `docs/design-docs/` update is
required. The exec plan itself is the only doc artifact.
