# Issue #395: /deposit: USDC half missing the outer white card (16px radius)

Source: https://github.com/eq-lab/pipeline/issues/395

## Scope

The `/deposit` ConversionCard renders the USDC (input) half as a bare gray panel sitting directly on the page paper background, while Figma node `1498:100136` ("input-sum-inline") shows the gray panel wrapped in a **white outer card** with 16px corner radius and asymmetric padding (`16/16/24/16`, top/right/bottom/left).

**In scope**

- Wrap the USDC `TokenInput` (Card A in `ConversionCard.tsx`) in a white surface that matches Figma:
  - Background: `var(--color-pipeline-surface)` (white).
  - Corner radius: 16px (new token `--radius-pipeline-card-lg`, see below).
  - Padding: `pt-4 pr-4 pb-6 pl-4` (16/16/24/16).
  - No border on the outer card (Figma shows none).
- Introduce a new design token `--radius-pipeline-card-lg: 16px` in `packages/ui/src/styles/theme.css` (both the `:root` block and the `@theme` block), reserved for the input-section outer cards. The existing `--radius-pipeline-card: 4px` stays the default for all other cards.
- Preserve the 2px gap between Card A and Card B, and the swap-button positioning that straddles the seam (must still anchor to the bottom edge of Card A's wrapper).
- Update the existing `ConversionCard.stories.tsx` story baseline expectations only if needed for visual diff.

**Out of scope**

- The PLUSD half's outer card radius (4 → 16) — tracked by #382.
- The USDC gray inner panel needing a 1px border + 8px radius — tracked by #396.
- Swap button styling (size, fill) — tracked by #394.
- Suggestion chip radius + border — tracked by #393.
- Generalising `Card` to accept a `size`/`radius` variant — out of scope for this fix; we apply the new radius locally in `ConversionCard.tsx`.

## Assumptions and Risks

- **Assumption.** TokenInput renders its own gray panel (the "USDC value container", node 1498:100137) and chips. Wrapping `<TokenInput {...input} />` in an additional white div with padding and radius will yield the Figma structure without modifying `TokenInput` itself.
- **Risk.** Adding outer padding will visually offset the swap button. The swap button is positioned with `top-full -translate-y-1/2` relative to Card A's `relative` wrapper, so as long as the new white card *is* Card A's `relative` wrapper, the seam remains in the same place and the button stays centered on the 2px gap.
- **Risk.** Storybook snapshots / visual regressions may flag the new padding. Update story baselines if our CI uses image diffs; otherwise the existing story will simply render correctly.
- **Risk.** PLUSD half (Card B) already uses `Card variant="white"` which today produces `rounded-[4px]` + `p-6`. After this issue lands, the USDC and PLUSD halves will visually differ in radius (16 vs 4) and padding (16/24 vs 24) until #382 closes. The issue body explicitly accepts that asymmetry as a follow-up.
- **Dependency.** None blocking. #382, #393, #394, #396 are siblings that touch the same component but are independent of #395.

## Open Questions

_None_

## Implementation Steps

1. **Add the new radius token.** In `packages/ui/src/styles/theme.css`:
   - In the `:root` "Radii" block (around line 119), add `--radius-pipeline-card-lg: 16px;`.
   - In the `@theme` "Radii" block (around line 197), add `--radius-pipeline-card-lg: 16px; /* radius/radius-l — input-section outer card; Figma 1498:100136 */`.
2. **Wrap the USDC half in `ConversionCard.tsx`** (`packages/ui/src/components/ConversionCard/ConversionCard.tsx`):
   - Replace the existing `<div className="relative">` wrapper around `<TokenInput .../>` and the swap `<button>` with a wrapper that also carries the white-card chrome:
     - `relative` (preserved — swap button anchor).
     - `bg-[var(--color-pipeline-surface)]`.
     - `rounded-[var(--radius-pipeline-card-lg)]`.
     - Padding: `pt-4 pr-4 pb-6 pl-4`.
     - No border class.
   - Do not modify `TokenInput` internals; it continues to render its gray inner panel and chips.
3. **Verify the seam.** Confirm the swap button still straddles the gap between Card A and Card B (it should, since the button's positioning is relative to Card A's wrapper, which now has padding but the same bottom edge as before — the bottom edge of the wrapper is what `top-full` anchors to, and that edge moves outward by `pb-6` = 24px from the inner gray panel, which is the intended Figma layout).
4. **Update the doc-comment** at the top of `ConversionCard.tsx` to reflect that Card A is now an explicit white wrapper around `TokenInput`, and add `--radius-pipeline-card-lg` to the design-tokens list.
5. **Add/extend the Storybook story** in `ConversionCard.stories.tsx` only if the existing default story does not already exercise this state — the default `/deposit` init state already does, so no new story is needed.
6. **Run `npx tsx scripts/lint-docs.ts`** per AGENTS.md to validate doc structure (only required if docs change; theme.css comment counts as a doc-tagged line — run anyway as a safety check).

## Test Strategy

- **Visual / Storybook**: Run Storybook locally and confirm the `ConversionCard` default story renders the USDC half inside a white card with 16px radius and 16/16/24/16 padding, matching Figma node `1498:100136`. Compare side-by-side with the PLUSD half — both should now have a white outer surface (PLUSD radius mismatch tracked by #382).
- **Unit / component tests**: If `ConversionCard` has Vitest tests under `packages/ui/src/components/ConversionCard/`, extend them to assert that the wrapper element of Card A carries the new background, radius, and padding classes. Otherwise no new unit tests are required (this is pure presentational chrome).
- **Manual UX test on `/deposit`** (driven by the `ux-tester` skill, since the issue carries a Figma reference):
  1. Run the app and visit `http://localhost:5173/deposit?direction=deposit`.
  2. Confirm the USDC half now sits inside a white card with rounded 16px corners and the asymmetric padding from Figma.
  3. Confirm the swap button still sits centered on the 2px seam between the USDC and PLUSD halves and stays clickable.
  4. Confirm no regression in the PLUSD half rendering (still uses `Card variant="white"`).
  5. Confirm the page paper background (`#F8F7F6`) is visible around the new white card edges.
- **Lint**:
  - `cargo clippy --all -- -D warnings` — not applicable (no Rust changes).
  - `npx tsx scripts/lint-docs.ts` — must pass.
  - Frontend type-check + lint per project standard (`yarn lint` / `yarn typecheck` in `packages/ui` if defined).

## Docs to Update

- `packages/ui/src/styles/theme.css` — new `--radius-pipeline-card-lg` token with a comment citing Figma node `1498:100136`.
- `packages/ui/src/components/ConversionCard/ConversionCard.tsx` — update the top-of-file doc-comment to describe the explicit white wrapper around Card A and list the new token.
- No product spec change is required — this is a pure visual bug fix; behaviour is unchanged.
- No update to `docs/design-docs/` unless an existing design doc enumerates the radius tokens; if so, add `--radius-pipeline-card-lg` there as well.
