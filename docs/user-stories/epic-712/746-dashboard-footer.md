# User Stories: #746 — Protocol Dashboard: global page footer

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#746](https://github.com/eq-lab/pipeline/issues/746)
Figma: [node 3283-13463](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-13463&m=dev)

---

## Story 1: Footer renders on /dashboard below the white content container

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running at `http://localhost:3000`.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard`.
2. Scroll to the bottom of the page.
3. Observe the area below the white content container.

**Expected outcomes:**

- A `<footer>` element is visible below the white rounded content container (`dashboard-content-container`).
- The footer sits on the `#F8F7F6` paper background, not inside the white surface.
- The footer is NOT a descendant of the `dashboard-content-container` element.
- No overlap between the footer and the content container.

---

## Story 2: Footer logo — Pipeline wordmark

**Persona:** Any user.

**Pre-conditions:** Dev server running; user is on any route.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard`.
2. Scroll to the footer.
3. Observe the left side of the top row.

**Expected outcomes:**

- The Pipeline wordmark (Logo SVG) is visible on the left of the footer's top row.
- The logo renders at approximately 232px wide (2× the 116px intrinsic width).
- The logo color matches the primary ink (`#262524`) — it is NOT the default brand navy.

---

## Story 3: Footer nav links — five placeholder links render

**Persona:** Any user.

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard`.
2. Scroll to the footer.
3. Observe the right side of the top row.

**Expected outcomes:**

- Five link labels are visible, in this order: **Docs**, **White Paper**, **GitHub**, **X (Twitter)**, **Telegram**.
- Each label is rendered as an anchor element.
- Clicking any link does NOT navigate the user away — the links are non-navigating placeholders.
- No broken or misleading URLs are shown (hrefs are `#`).
- Links are spaced with 24px gaps between them.

---

## Story 4: Footer divider lines — top and bottom borders on row 1

**Persona:** Any user.

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard`.
2. Scroll to the footer.
3. Observe the row containing the logo and nav links.

**Expected outcomes:**

- A thin horizontal divider line appears at the **top** of the logo/links row.
- A thin horizontal divider line appears at the **bottom** of the logo/links row.
- Both lines use the primary ink color (`#262524` / `--color-pipeline-ink`).
- There is 16px of vertical padding (`py-4`) inside the row, above and below the content.

---

## Story 5: Footer disclaimer — three lines, muted ink

**Persona:** Any user.

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard`.
2. Scroll to the footer.
3. Observe the bottom row, left side.

**Expected outcomes:**

- A paragraph of disclaimer text is visible on the left of the footer's bottom row.
- The text spans three lines (wrapping may vary by viewport):
  - Line 1: "Pipeline is a financial protocol. This interface is provided for informational purposes only and does not constitute financial advice."
  - Line 2: "Past performance is not indicative of future results. Participation involves risk, including possible loss of principal."
  - Line 3: "Always conduct your own due diligence before participating."
- The text color is muted (`--color-pipeline-ink-muted`, approx. `rgb(56 55 53 / 0.6)`).
- The disclaimer has a `max-width` of approximately 480px so it does not span the full footer width.

---

## Story 6: Footer copyright — right-aligned on the same row as the disclaimer

**Persona:** Any user.

**Pre-conditions:** Dev server running; viewport is 768px wide or above.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard`.
2. Scroll to the footer.
3. Observe the bottom row, right side (desktop only).

**Expected outcomes:**

- The text **"© 2026 Pipeline Trust Company"** is visible on the right side of the footer's bottom row.
- The text is right-aligned and stays on a single line (no wrapping).
- The color is muted (`--color-pipeline-ink-muted`), matching the disclaimer text.
- The copyright does not overlap the disclaimer text.

---

## Story 7: Footer appears on other routes (global, not dashboard-only)

**Persona:** Any user.

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/` (home).
2. Scroll to the bottom of the page.
3. Observe whether the footer is present.
4. Repeat for `http://localhost:3000/deposit`, `http://localhost:3000/stake`, `http://localhost:3000/transactions`.

**Expected outcomes:**

- The same footer (logo + nav links + disclaimer + copyright) renders at the bottom of every route.
- The footer appears exactly once per page — no duplicate footer on any route.
- The footer sits below each route's main content, not inside any route-specific content container.

---

## Story 8: Responsive stacking — logo/links row on mobile

**Persona:** Any user on a mobile viewport (< 768px).

**Pre-conditions:** Dev server running; browser viewport width set to 375px (mobile).

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 375px viewport width.
2. Scroll to the footer.
3. Observe the top row (logo + nav links).

**Expected outcomes:**

- The logo and nav links **stack vertically**: logo appears on top, nav links appear below (not side-by-side).
- The nav links do not overflow horizontally — they wrap within the viewport.
- No horizontal page scroll is introduced by the footer.

---

## Story 9: Responsive stacking — disclaimer/copyright row on mobile

**Persona:** Any user on a mobile viewport (< 768px).

**Pre-conditions:** Dev server running; browser viewport width set to 375px.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 375px viewport width.
2. Scroll to the footer.
3. Observe the bottom row (disclaimer + copyright).

**Expected outcomes:**

- The disclaimer text and copyright text **stack vertically**: disclaimer on top, copyright below (not side-by-side).
- Both are left-aligned on mobile.
- No horizontal overflow or clipping.
- Footer outer padding reduces on mobile (approximately 32px) vs desktop (96px).

---

## Story 10: Accessibility — footer landmark

**Persona:** Screen reader user.

**Pre-conditions:** Dev server running; screen reader or accessibility audit tool active.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard`.
2. Use the screen reader or inspect the DOM to find the footer landmark.

**Expected outcomes:**

- A `<footer>` element (implicit `role="contentinfo"`) is present.
- The footer nav has `aria-label="Footer"` so it is distinguishable from the primary nav.
- The Pipeline logo has `aria-label="Pipeline"` so it is announced correctly.
- All nav link anchors are keyboard-focusable and show a focus-visible ring when focused.
