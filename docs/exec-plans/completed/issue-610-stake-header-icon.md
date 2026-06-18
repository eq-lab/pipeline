# Issue #610: Stake header icon differs from Figma

Source: https://github.com/eq-lab/pipeline/issues/610

## Scope

Fix the `/stake` page hero icon (`data-testid="stake-header"`) so its 72×72 circle
and the bar-chart glyph match Figma node `1497-95313`.

Two pixel-level deltas confirmed against Figma:

1. **Circle fill** — App renders `--color-pipeline-surface-muted` = `rgb(56 55 53 / 0.12)`.
   Figma uses `fill-test/primary` = `#bfbdbb1f` = `rgb(191 189 187 / 0.12)`, which is the
   existing `--color-pipeline-fill-muted` token (already defined in `theme.css`, comment:
   "fill/primary-muted — icon bg"). The component is using the wrong muted token.
2. **Glyph weight/colour** — App tints the chart glyph with `--color-pipeline-ink`
   (`#262524`, solid near-black), so it reads heavy/dark. Figma renders the glyph as a
   light muted gray matching `content-test/tertiary` = `#3837354d` = `rgb(56 55 53 / 0.3)`,
   which is the existing `--color-pipeline-ink-subtle` token.

Both deltas live in the shared `HeroIcon` primitive
(`packages/ui/src/components/HeroIcon/HeroIcon.tsx`), which `StakeHeader` consumes via
`<HeroIcon icon="chart" />`.

**In scope**
- `HeroIcon` circle background token → `--color-pipeline-fill-muted`.
- `HeroIcon` chart-glyph tint → `--color-pipeline-ink-subtle` (per-icon, see Step 2).
- Update the `HeroIcon` regression test and JSDoc to reflect the new tokens.

**Out of scope**
- The `NavIcon` "stats" glyph (bottom nav). It inlines its own copies of the bar-chart
  path data and does **not** import `nav-stats.svg`; it must keep `fill="currentColor"`
  driven by IconButton active state. Do not touch `NavIcon`.
- The chart/arrow-clock SVG asset files themselves — no edits to
  `assets/icons/nav-stats.svg` or `assets/icons/arrow-clock.svg`.
- Any layout/typography of the stake header (gap, heading) — already correct.

## Assumptions and Risks

- **Shared primitive, two consumers.** `HeroIcon` is also used by `ActivityHeader`
  (`icon="arrow-clock"`, Activity hero, Figma `1497-94912`). I verified both hero nodes
  use the **same** circle fill (`fill-test/primary` = `#bfbdbb1f`) and the **same** glyph
  tint reference (`content-test/tertiary` = `#3837354d`). So changing the circle token to
  `--color-pipeline-fill-muted` is correct for both — it nudges the QA-verified Activity
  hero circle to the Figma-spec colour (very subtle, both are 0.12 alpha; one is warm-gray
  191/189/187, the other 56/55/53). This is a Figma-correct improvement, not a regression,
  but it is a deliberate side effect of touching the shared component.
- **Glyph tint must be per-icon, not global.** `arrow-clock.svg` bakes
  `fill-opacity="0.3"` into its paths; tinted with full `--color-pipeline-ink` it already
  renders at ~0.3 (matching Figma's subtle glyph). `nav-stats.svg` (chart) has **no** baked
  opacity, so it renders at full ink — that is the bug. If the glyph tint were globally
  switched to `--color-pipeline-ink-subtle`, arrow-clock would compound to ~0.09 (too
  faint). Therefore the tint must be resolved per-icon: `chart` → subtle, `arrow-clock` →
  ink (unchanged). See Step 2.
- Risk: an existing test asserts the arrow-clock glyph `backgroundColor` is
  `var(--color-pipeline-ink)` (`HeroIcon.test.tsx` line ~152). The per-icon approach keeps
  arrow-clock on ink, so that assertion stays valid; only a new chart-tint assertion is
  added.
- No backend, no data flow, no product-behaviour change — pure visual `fix`. No product
  spec update required (confirmed: no `docs/product-specs` or `docs/design-docs` entry
  covers StakeHeader/HeroIcon tokens).
- Parent epic #531 (Stake/unstake page) is open; no dependency on unfinished work.

## Open Questions

_None_

## Implementation Steps

1. **Circle fill token** — `packages/ui/src/components/HeroIcon/HeroIcon.tsx`,
   `circleClasses` array (currently line ~43): replace
   `"bg-[color:var(--color-pipeline-surface-muted)]"` with
   `"bg-[color:var(--color-pipeline-fill-muted)]"`.

2. **Per-icon glyph tint** — same file. The inner `<span>` currently hardcodes
   `backgroundColor: "var(--color-pipeline-ink)"` (line ~87). Introduce a per-icon tint
   resolution so the chart glyph is muted while arrow-clock is unchanged. Recommended:
   add a small map next to `ICON_SRC_MAP`, e.g.
   ```ts
   const ICON_TINT_MAP: Record<HeroIconName, string> = {
     "arrow-clock": "var(--color-pipeline-ink)",   // SVG bakes fill-opacity 0.3
     chart: "var(--color-pipeline-ink-subtle)",     // no baked opacity → tint subtle
   };
   ```
   and set the span `backgroundColor` to `ICON_TINT_MAP[icon]`. Keep it driven by the
   `icon` prop only (no new public prop) to avoid widening the component API.

3. **JSDoc** — update the `HeroIcon` header comment (lines ~5-23): the circle is now
   `--color-pipeline-fill-muted` and the glyph tint is icon-dependent (ink for arrow-clock,
   ink-subtle for chart). Also reconcile the `StakeHeader` JSDoc note if it references the
   icon colour (it currently does not pin a colour token — verify and leave as-is if so).

4. **Lint** — after the TypeScript change run `npx tsx scripts/lint-docs.ts` (per AGENTS.md)
   and the workspace lint. Verify no raw hex/sizes introduced (tokens only).

## Test Strategy

- **Update** `packages/frontend/src/components/HeroIcon.test.tsx`:
  - Add an assertion that the `chart` glyph span `backgroundColor` is
    `var(--color-pipeline-ink-subtle)` (mirror the existing arrow-clock ink assertion at
    line ~147).
  - Keep the existing arrow-clock assertion (`var(--color-pipeline-ink)`) — it remains
    correct under the per-icon approach and guards against accidental global change.
  - (Optional) assert the outer circle `<div>` `className` contains
    `bg-[color:var(--color-pipeline-fill-muted)]` to lock the circle-token fix; only add if
    it can be asserted cleanly via `className` (the div carries the Tailwind class string).
- **Run** the focused suite the same way it is run today:
  `yarn workspace @pipeline/frontend test src/components/HeroIcon.test.tsx`
  (QUALITY_SCORE records this exact invocation, 15 tests). Then the fast suite via the
  `/test-fast` skill (lint + unit + integration) to catch regressions in ActivityHeader /
  StakeHeader tests.
- **Edge cases:** confirm arrow-clock hero still renders muted (no double-opacity) and
  chart hero now renders light/muted; confirm NavIcon "stats" in the bottom nav is
  unchanged (it does not consume `HeroIcon`).
- **Figma verification** (frontend flow): on `/stake`, the `stake-header` hero circle
  computed background must be `rgba(191, 189, 187, 0.12)` and the chart glyph must read as
  a light muted gray (effective ~`rgb(56 55 53 / 0.3)`), matching Figma node `1497-95313`
  (https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95313). Confirm
  the `/transactions` desktop Activity hero (node `1497-94912`) still matches after the
  shared-circle-token change.

## Docs to Update

- None required (no product/behaviour change; no design-doc/product-spec entry covers this
  primitive). The `HeroIcon` JSDoc update in Step 3 is the only documentation touched.
- If during implementation any shortcut or unexpected gap appears, log per AGENTS.md to
  `docs/exec-plans/tech-debt-tracker.md` (do not fix inline).
