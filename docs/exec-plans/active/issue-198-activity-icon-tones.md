# Issue #198: Transactions: ActivityIcon renders every tile as solid ink; Figma uses success-green / warning-yellow / muted-neutral tones

Source: https://github.com/eq-lab/pipeline/issues/198

## Scope

Add tonal variants to `ActivityIcon` so transaction rows convey state at a glance, matching the Figma frame `1497-94912`.

In scope:

- New `tone: "success" | "warning" | "neutral"` prop on `ActivityIcon` (default `"neutral"`).
- New color tokens in `packages/ui/src/styles/theme.css`:
  - `--color-pipeline-success` — green tile fill
  - `--color-pipeline-warning` — amber/gold tile fill
  - (`--color-pipeline-fill-muted` already exists — reuse for the neutral tone)
- Tile background and glyph color driven by `tone`:
  - `success` → success fill, white glyph (keep `brightness(0) invert(1)` filter)
  - `warning` → warning fill, white glyph (keep filter)
  - `neutral` → muted fill, dark/muted glyph (drop the invert filter, render at `--color-pipeline-ink-muted`)
- Update `routes/transactions.tsx` so each row passes the correct `tone`:
  - Row 1 (`check-circle`, completed) → `tone="success"`
  - Row 2 (`clock-pending`, pending) → `tone="warning"`
  - Rows 3-5 (`arrow-up-circle`, `arrow-down-circle`, `exchange`) → `tone="neutral"` (or omit, default).
- Update `ActivityIcon.stories.tsx` to demonstrate all tones (per-tone stories + a tones matrix).

Out of scope:

- Row-level state filtering or dynamic data — the Transactions page remains a static composition per #125.
- Any change to other components that consume `ActivityIcon` (none today besides `ActivityRow` consumers in the Transactions route).
- A product-spec change. This is a styling/visual fidelity bug fix; no user-visible behavior contract changes.

## Assumptions and Risks

- **Token color values.** The Figma `1497-94912` Code Connect output lists `bg-[var(--fill-test/primary,#262524)]` for every tile, so canonical hex values are not directly exposed by Code Connect. The Issue instructs us to treat the rendered Figma screenshot as source of truth. The implementer will sample the success-green and warning-yellow swatches from the Figma node screenshot via the Figma MCP (`get_design_context` / `get_screenshot` of node `1497-94912`) and choose tokens that match within a few units of each channel. If the Figma file exposes named variables for these fills (e.g. `fill/success`, `fill/warning`), prefer those.
- **Glyph rendering for `neutral` tone.** Source SVGs in `packages/ui/src/assets/icons/` are currently inverted with a CSS filter to force white. For `neutral` we need the dark-on-light glyph. The lowest-risk path is to render the `<img>` without the invert filter and apply `filter: brightness(0)` (or a mask + `background-color` token) so the glyph picks up the muted ink color. Risk: filter-based colorization can ignore the token if the underlying SVG paints with `currentColor`. Mitigation: in the coder step, validate by sampling pixel color in the Storybook story and adjust (CSS `mask-image` is the durable fallback).
- **AmountPill / row 1.** `AmountPill` is the green amount chip on the success row but it is independent of the tile color. No change required, but reviewers may ask whether the pill should be re-tinted; current scope keeps it as-is per Issue body.
- **No dark theme yet.** New tokens go into both the `:root` block and the `@theme` block in `theme.css` (matching the existing convention), with identical values; no dark-mode override is in scope.
- **Parent #125** is closed/merged for the static composition; this Issue is a follow-up bug fix and does not depend on any open work.

## Open Questions

_None_

## Implementation Steps

1. **Capture canonical fill colors.** In a one-shot research step, call the Figma MCP `get_design_context`/`get_screenshot` on file `A43rjYYjSwdTmiwwf5cx5n` node `1497-94912` and read the tile fills for rows 1 (success) and 2 (warning). If a named Figma variable is exposed, prefer its value; otherwise sample the rendered pixels. Record the chosen hex/rgba on the PR as a comment for reviewers.
2. **Add tokens.** Edit `/Users/dima/git/pipeline/packages/ui/src/styles/theme.css`:
   - Add `--color-pipeline-success: <hex>;` and `--color-pipeline-on-success: #ffffff;` to the `:root` block and mirror them in the `@theme` block (so Tailwind utilities like `bg-pipeline-success` work).
   - Add `--color-pipeline-warning: <hex>;` and `--color-pipeline-on-warning: #ffffff;` to both blocks.
   - Reuse the existing `--color-pipeline-fill-muted` for the neutral tile fill, and `--color-pipeline-ink-muted` for the neutral glyph color.
   - Add inline comments noting the Figma node id reference, matching the style used by existing tokens.
3. **Extend `ActivityIcon`** at `/Users/dima/git/pipeline/packages/ui/src/components/ActivityIcon/ActivityIcon.tsx`:
   - Export `ActivityIconTone = "success" | "warning" | "neutral"`.
   - Add `tone?: ActivityIconTone` to `ActivityIconProps`, default `"neutral"`.
   - Replace the static `tileClasses` constant with a `TILE_CLASSES_BY_TONE: Record<ActivityIconTone, string[]>` lookup whose entries set the `bg-[var(...)]` token. Compose with the shared base classes (`inline-flex items-center justify-center`, `size-10 shrink-0`, `rounded-[var(--radius-pipeline-card)]`).
   - Replace the inline `style={{ filter: "brightness(0) invert(1)" }}` with a per-tone style:
     - `success`, `warning` → `filter: "brightness(0) invert(1)"` (white glyph)
     - `neutral` → omit `invert(1)` so the glyph renders as a black silhouette; set color via `filter: brightness(0)` and visually verify it matches `--color-pipeline-ink-muted`. If the visual check fails, switch the implementation to a `mask-image` approach where the `<img>` is replaced by a `<span>` with `mask-image: url(<src>)`, `mask-size: 20px 20px`, `background-color: var(--color-pipeline-ink-muted)`.
   - Update the JSDoc block at the top of the file to describe the three tones.
4. **Wire tones in the Transactions route** at `/Users/dima/git/pipeline/packages/frontend/src/routes/transactions.tsx`:
   - The `ActivityRow` component accepts `icon` and forwards it to `ActivityIcon`. Inspect `/Users/dima/git/pipeline/packages/ui/src/components/ActivityRow/ActivityRow.tsx` to confirm; add a `tone` passthrough prop on `ActivityRow` so the route can pass `tone="success"|"warning"|"neutral"` without bypassing the component boundary. (If `ActivityRow` currently builds `<ActivityIcon icon={icon} />` internally, extend its prop surface with `tone?: ActivityIconTone` and forward it.)
   - Pass `tone` for each of the five rows per the table in the Issue body.
5. **Stories.** Update `/Users/dima/git/pipeline/packages/ui/src/components/ActivityIcon/ActivityIcon.stories.tsx`:
   - Add a `tone` control (`select` with `success | warning | neutral`).
   - Add per-tone stories (e.g. `SuccessCompleted`, `WarningPending`, `NeutralExchange`).
   - Update the `AllVariants` story so each tile renders in its canonical tone; or add a second `AllTones` story that displays the same icon (`check-circle`) in all three tones for a side-by-side tonal reference.
6. **ActivityRow story.** If `ActivityRow` has a Storybook entry, extend it so the `tone` prop is exercised. Otherwise skip.
7. **Lint and validate.**
   - `yarn workspace @pipeline/ui build && yarn workspace @pipeline/ui lint` (or repo-level equivalents).
   - `yarn workspace @pipeline/frontend build && yarn workspace @pipeline/frontend lint`.
   - `npx tsx scripts/lint-docs.ts` per AGENTS.md.

## Test Strategy

- **Unit / component:** add a Vitest test next to `ActivityIcon.tsx` (or extend the existing one if present) that renders each tone and asserts the rendered `<div>` carries the expected token class (`bg-[var(--color-pipeline-success)]` etc.) and the `<img>`/`<span>` glyph has the expected filter or mask color. Cover the default-tone case to lock in `neutral` as the default.
- **Storybook visual:** confirm the new stories render the three tones distinctly (manual eyeball through `yarn storybook` is acceptable since Storybook is the design verification surface here).
- **UX-tester pass:** the Issue has a Figma URL, so the manager will route this to `ux-tester` after implementation. Test pass should verify at `http://localhost:5173/transactions`:
  - Row 1 tile is green, glyph white.
  - Row 2 tile is amber/gold, glyph white.
  - Rows 3-5 tiles are muted gray, glyphs dark-muted (not white).
  - All other rendered content unchanged vs. the previous build.
- **Lint guard:** `npx tsx scripts/lint-docs.ts` and the per-package `lint`/`build` commands listed in step 7 must pass.
- **Edge cases:**
  - Passing an unknown tone is a type error at compile time; no runtime branch needed.
  - `aria-label` / `aria-hidden` behavior is unchanged across tones — re-assert it in the unit test for at least one tone.

## Docs to Update

- No product spec change (visual bug fix; no behavior contract change).
- `docs/FRONTEND.md` — if it lists `ActivityIcon` props or tokens, add the new `tone` prop and the `--color-pipeline-success` / `--color-pipeline-warning` tokens. Grep first; skip if no such reference exists.
- No `docs/design-docs/` change required unless the catalog lists ActivityIcon variants explicitly — in which case add the three tones.
- Storybook docstrings (in `ActivityIcon.tsx` JSDoc and `ActivityIcon.stories.tsx` component description) are the primary documentation surface and are updated as part of the implementation steps above.
