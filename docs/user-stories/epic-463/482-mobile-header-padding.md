# User stories — #482 Mobile header height/padding

Epic: [#463 Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#482 Mobile header height — TopBar padding](https://github.com/eq-lab/pipeline/issues/482)
Figma: node `1989:9052` in frame `1989-8292`

---

## Context

The TopBar component previously used 16px padding on all sides, making the
header 73px tall at a 402px viewport. The Figma mobile spec requires 8px
padding around the 32px logo / 40px hamburger button, giving a total header
height of 56px. Desktop spacing (16px) is unchanged.

---

## Stories

### S-1 — Mobile header height is 56px

**Given** I open the app on a mobile viewport (≤ 402px wide)
**When** the page loads
**Then** the TopBar `<header>` element is 56px tall (8px top + 40px content + 8px bottom)

_Verification: measure `header.getBoundingClientRect().height` in DevTools or a
Playwright assertion at a 402px viewport._

### S-2 — Desktop header height is unchanged

**Given** I open the app on a desktop viewport (≥ 768px wide, i.e. `md` breakpoint)
**When** the page loads
**Then** the TopBar `<header>` element is 72px tall (16px top + 40px content + 16px bottom)

_Verification: measure `header.getBoundingClientRect().height` at ≥ 768px._

### S-3 — Responsive padding classes are present

**Given** the TopBar component is rendered
**Then** the `<header>` element's `className` contains both `p-2` and `md:p-4`

_Verification: unit test in `TopBar.test.tsx` — "header element has `p-2` …
classes"._

### S-4 — Logo and hamburger button are vertically centred in the mobile header

**Given** a 402px viewport
**When** the page loads
**Then** the Pipeline logo and the hamburger icon button are vertically centred
within the 56px header (no visible clipping or misalignment)

_Verification: visual inspection or screenshot comparison against Figma node
`1989:9052`._
