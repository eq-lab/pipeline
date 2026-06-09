# #530 — Activity header icon: arrow-clock glyph centering

**Epic:** #522 Activity page
**Type:** Regression / visual fix
**Component:** `packages/ui/src/assets/icons/arrow-clock.svg`, `HeroIcon`

## Story

As a user viewing the Activity page, the arrow-clock icon inside the hero
circle should appear optically centered so the UI looks polished and matches
the Figma design.

## Acceptance criteria

1. The 72×72 hero circle at the top of `/transactions` renders the arrow-clock
   glyph visually centered — no visible offset to any side.
2. The `chart` variant (`nav-stats.svg`) used in any future hero circle is
   likewise centered.
3. Both SVG assets have square viewBoxes so the CSS-mask slot (`maskSize:
   contain` in a 36×36 square) produces a centered, undistorted render.

## Regression test

- Navigate to `/transactions` on a 390 px wide mobile viewport.
- Confirm the circle above the "Activity" heading contains a centered
  arrow-clock icon with no visible top/bottom or left/right offset.
