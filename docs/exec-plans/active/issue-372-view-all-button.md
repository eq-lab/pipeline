# Issue #372: Home: Recent activity 'View All' affordance is a small text link; Figma is a button-sized chevron control

Source: https://github.com/eq-lab/pipeline/issues/372

## Scope

Replace the plain `<Link>` "View All →" in `RecentActivityCard` with a Figma-faithful button-shaped link control:

- Anchored bottom-right of the card (unchanged — already `self-end`).
- ~48px tall, horizontal padding `12px`, rounded `8px`.
- Label `View All` rendered in **Body Semi Bold** (`Inter`, `16px / 22px`, `font-weight 600`) — use the existing `--font-weight-emphasized` token.
- Color is **muted ink** — use the existing `--color-pipeline-ink-muted` token (matches `rgba(50,56,55,0.6)` content/secondary).
- A 24×24 right-chevron icon (the `›` shape) after the label, painted with `currentColor`. The icon must be added to the icon set since none exists today.
- Navigation target stays `/transactions`.
- Trailing space inside the visible label per Figma (`"View All "` — a literal trailing space before the icon slot).

Out of scope:
- Empty/disconnected state (no link rendered there — keep current behavior).
- Other home-page cards.
- Touching `renderRequestRow`, `EmptyState`, or `Card`.

## Assumptions and Risks

- Assumption: the existing `--color-pipeline-ink-muted` (`rgb(56 55 53 / 0.6)`) is a close-enough match for the Figma `rgba(50,56,55,0.6)` token. The two differ by 6 in red/green channels but use the same alpha; treating them as equivalent under Pipeline's token aliasing convention.
- Assumption: chevron icon is added as a new inline SVG (matching the `LinkCard` pattern of an inline component painted with `currentColor`) rather than added to `packages/ui/src/assets/icons/` and re-imported, since the icon is local to this affordance. If the team prefers a shared asset, the slug `chevron-right.svg` is reserved.
- Risk: the existing snapshot test asserts the exact text `"View All →"` — this must be updated to `"View All"` (or `/View All/` regex assertions left intact will still match).
- Risk: adding a 48px-tall button may slightly change the card's overall height. `min-h-[564px]` already absorbs growth, so the visual silhouette should remain stable.
- Risk: the link currently has `hover:underline` — the button form should drop underlining and use a subtle hover (e.g. ink darkening) to stay on-brand with other button-shaped controls.

## Open Questions

_None_

## Implementation Steps

1. Edit `packages/frontend/src/components/RecentActivityCard.tsx`:
   - Replace the `<Link to="/transactions">...</Link>` block (current lines 129–141) with a button-shaped `<Link>` rendering:
     - Outer classes: `self-end inline-flex items-center gap-1 h-12 px-3 rounded-lg no-underline transition-colors`.
     - Typography classes: `font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] font-[var(--font-weight-emphasized)]`.
     - Color: `text-[color:var(--color-pipeline-ink-muted)] hover:text-[color:var(--color-pipeline-ink)]`.
     - Children: `<span>View All</span>` followed by an inline `<ChevronRight />` SVG in a `size-6 inline-flex items-center justify-center` wrapper (mirrors `LinkCard`'s icon slot).
   - Add a local `ChevronRight` SVG component at the bottom of the file (above `displayName`):
     - 24×24 viewBox, single `›` path painted with `currentColor`, `aria-hidden="true"`, `focusable="false"`.
     - Standard chevron-right geometry (e.g. `M9 6l6 6-6 6` stroke at 2px, or filled path equivalent). Prefer stroke so it tracks `currentColor` cleanly; set `stroke-linecap="round" stroke-linejoin="round" stroke-width="2"`.
   - Update the JSDoc block (lines 8–49) to describe the button affordance instead of the text link, and bump the Figma reference to node `1497:95216`.

2. Update `packages/frontend/src/components/RecentActivityCard.test.tsx`:
   - Change the assertion `screen.getByText("View All →")` (line 212) to `screen.getByText("View All")`.
   - Change `screen.getByText("View All →").closest("a")` (line 217) to `screen.getByText("View All").closest("a")`.
   - Other assertions (`/View All/` regex on lines 161, 291, 327, 365) continue to work as-is.
   - Optional new assertion: confirm the link has `role="link"`/is an `<a>` (already covered by `closest("a")`).

3. Run `yarn workspace @pipeline/frontend test --run RecentActivityCard` to verify unit tests pass.

4. Run `yarn lint` (or the repo-level lint script) and `npx tsx scripts/lint-docs.ts` per `AGENTS.md`.

## Test Strategy

- **Unit**: Update `RecentActivityCard.test.tsx` per step 2; ensure all six existing scenarios still pass. No new behavior to test beyond the label/icon change — the existing "renders the View All link" / "points to /transactions" cases already cover the affordance.
- **Visual / Figma verification** (manual): `ux-tester` opens `http://localhost:5173/` with a connected wallet that has activity, confirms:
  - The "View All" control sits bottom-right of the Recent Activity card.
  - It reads ~48px tall, padded `12px`, rounded `8px`.
  - Label color is muted (not full primary ink) and renders in Body Semi Bold (visually heavier than surrounding body text).
  - A chevron-right icon appears (not a Unicode `→`).
  - Clicking navigates to `/transactions`.
  - Compare side-by-side with Figma node `1497:95216`.
- **Regression**: run the full frontend test suite (`yarn workspace @pipeline/frontend test --run`) to confirm no other snapshot/component depends on the old `"View All →"` text.

## Docs to Update

- None required. The change is a pure visual / token-faithful tweak to a single component; no product spec or design doc currently documents the Recent Activity card's "View All" affordance at a level that would drift. The component's own JSDoc is updated in step 1.
