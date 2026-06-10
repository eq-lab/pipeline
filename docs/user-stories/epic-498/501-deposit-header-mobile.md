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

---

## Story 4 — CoinIcon inline style does not defeat responsive hide (Issue #547 regression)

**As a** mobile user on the `/deposit` page,
**I want** the PLUSD coin icon to remain hidden below 768 px even after future
refactors of `CoinIcon`,
**so that** the mobile layout matches the Figma spec and is not silently broken by
changes to the component's default display property.

### Acceptance criteria

- `CoinIcon` does **not** set `display` via an inline `style` attribute.  Inline
  styles override Tailwind utility classes (including `hidden`) regardless of
  specificity order, so this must remain absent.
- `CoinIcon` renders with a `block` CSS class by default so standalone usage
  (without explicit `className`) still shows the icon as a block element.
- When `DepositHeader` renders `<CoinIcon className="hidden md:block" …>`, the
  `hidden` class is present on the `<img>` element in the DOM.
- At a viewport narrower than 768 px the coin icon computes `display:none`
  (i.e. `getComputedStyle(icon).display === "none"`).
- At 768 px and wider the coin icon computes `display:block`.

### Automated regression (CoinIcon.test.tsx — Group 5)

The regression is guarded by the "CoinIcon — responsive display (Issue #547
regression)" describe block in
`packages/frontend/src/components/CoinIcon.test.tsx`.
