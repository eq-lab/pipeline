# User Stories — Issue #576: Mobile Activity header: arrow-clock hero circle hidden at mobile width

Parent epic: [#522 Activity page](https://github.com/eq-lab/pipeline/issues/522)
Issue: [#576](https://github.com/eq-lab/pipeline/issues/576)
Figma (mobile): node 1993-9592 | heading node 1993-9808

---

## Story 1 — Arrow-clock hero circle is hidden at mobile width

**As a** mobile user on the `/transactions` page,
**I want** the arrow-clock icon circle to be absent from the header,
**so that** the layout matches the mobile Figma design (heading only, no icon).

### Acceptance criteria

- At a viewport narrower than 768 px the arrow-clock hero circle is **not rendered / not visible** (display: none on the wrapper).
- The "Activity" heading is still visible and left-aligned.
- At ≥ 768 px the hero circle is visible (desktop behavior unchanged).

### Steps

1. Open `/transactions` at a viewport width < 768 px (e.g. 375 px).
2. Inspect or observe the page header above the "Activity" heading.

**Expected:** no 72×72 arrow-clock circle is visible; only the heading text appears.
**Previously broken:** `HeroIcon`'s own `inline-flex` utility overrode the `hidden` class passed by the consumer, so the circle rendered at mobile width.
