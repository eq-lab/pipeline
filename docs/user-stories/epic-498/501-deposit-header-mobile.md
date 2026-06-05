# User Stories — Issue #501: Mobile /deposit heading responsive fix

Parent epic: [#498 Deposit/withdraw page](https://github.com/eq-lab/pipeline/issues/498)
Issue: [#501](https://github.com/eq-lab/pipeline/issues/501)
Figma (mobile): node 1993:7911 | Figma (desktop): node 1498:100130

---

## Story 1 — Mobile heading is left-aligned with no coin icon

**As a** mobile user on the `/deposit` page,
**I want** to see the "1:1 Conversion" heading left-aligned without the coin icon,
**so that** the page header matches the mobile Figma layout.

### Acceptance criteria

- At a viewport width narrower than 768 px the PLUSD coin icon is **not visible**.
- The heading is **left-aligned** (flush with the page content margin).
- The heading text reads "1:1 Conversion".
- The heading uses the `heading-m` type scale (28 px / 36 px line-height).
- The heading weight is Regular (400), rendered in Besley.

---

## Story 2 — Desktop heading remains centered with coin icon

**As a** desktop user on the `/deposit` page,
**I want** to see the PLUSD coin icon stacked above a centered heading,
**so that** the page header matches the desktop Figma layout.

### Acceptance criteria

- At a viewport width of 768 px or wider the PLUSD coin icon is **visible** and
  centered above the heading.
- The heading is **centered**.
- The heading uses the `heading-m` type scale (28 px / 36 px line-height).
- The heading weight is Regular (400), rendered in Besley.

---

## Story 3 — Single semantic heading on all viewports

**As a** screen-reader user,
**I want** the deposit page to have exactly one `<h2>` heading for the deposit section,
**so that** the heading hierarchy is unambiguous.

### Acceptance criteria

- There is exactly one `<h2>` element containing the deposit heading text at every
  viewport width (no duplicate headings introduced by the responsive implementation).
