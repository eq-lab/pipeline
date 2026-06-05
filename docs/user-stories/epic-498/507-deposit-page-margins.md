# User Stories: #507 — Mobile /deposit: 16px page margins vs Figma 8px

Epic: [#498 — Deposit/withdraw page](https://github.com/eq-lab/pipeline/issues/498)
Issue: [#507](https://github.com/eq-lab/pipeline/issues/507)
Figma: [frame 1993:7910 in node 1993-7701](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1993-7701&m=dev)

On a 402 px mobile viewport the deposit page content column must sit at x=8 (8 px page
side margins), giving a content width of 386 px. Before this fix the `<main>` used `px-4`
(16 px flat), producing 370 px — 16 px narrower than spec.

---

## Story 1: Content column uses 8px side margins on mobile

**Persona:** A mobile user (viewport 402×874) visiting `/deposit`.

**Pre-conditions:** App running at http://localhost:3000/deposit; DevTools set to 402 px
wide.

**Steps:**

1. Open `/deposit` in a browser set to 402 px viewport width.
2. Inspect the horizontal position and width of the page content (e.g. the ConversionCard).

**Expected outcomes:**

- The content column starts at x=8 (8 px from the left edge).
- The content column ends at x=394 (8 px from the right edge).
- Content width is 386 px.
- No card or element bleeds outside the 8 px side margins.

---

## Story 2: Desktop layout retains wider page margins

**Persona:** A desktop user on the `/deposit` page.

**Pre-conditions:** App running; browser viewport ≥ 768 px wide (md breakpoint).

**Steps:**

1. Open `/deposit` at a viewport ≥ 768 px wide.
2. Observe the horizontal padding around the content column.

**Expected outcomes:**

- The page padding is wider than 8 px (16 px at the md breakpoint).
- The overall layout is not adversely affected by the mobile margin change.
