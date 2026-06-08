# User Stories — Issue #523: Mobile Activity page: with-data state

Parent epic: [#522 Activity page](https://github.com/eq-lab/pipeline/issues/522)
Issue: [#523](https://github.com/eq-lab/pipeline/issues/523)
Figma (mobile): node 1993-9592 | Figma (desktop): node 1497-94912

---

## Story 1 — Mobile heading is left-aligned with no arrow-clock icon

**As a** mobile user on the `/transactions` page,
**I want** to see the "Activity" heading left-aligned without the arrow-clock icon,
**so that** the page header matches the mobile Figma layout.

### Acceptance criteria

- At a viewport width narrower than 768 px the arrow-clock icon is **not visible**.
- The heading is **left-aligned** (flush with the 8 px page margin).
- The heading text reads "Activity".
- The heading uses the `heading-m` type scale (28 px / 36 px line-height).
- The heading weight is Regular (400), rendered in Besley.

---

## Story 2 — Desktop heading remains centered with arrow-clock icon

**As a** desktop user on the `/transactions` page,
**I want** to see the arrow-clock icon stacked above a centered heading,
**so that** the page header matches the desktop Figma layout.

### Acceptance criteria

- At a viewport width of 768 px or wider the arrow-clock icon is **visible** and
  centered above the heading.
- The heading is **centered**.
- The heading uses the `heading-m` type scale (28 px / 36 px line-height).
- The heading weight is Regular (400), rendered in Besley.

---

## Story 3 — Mobile page has 8 px side margins

**As a** mobile user on the `/transactions` page,
**I want** the activity list to have 8 px margins on each side,
**so that** the content does not touch the screen edges.

### Acceptance criteria

- At a viewport width narrower than 768 px there is an 8 px horizontal margin
  on each side of the content column (matching the `px-2` Tailwind utility).
- The desktop layout's effective content width (capped at 480 px) is visually
  unchanged — the `px-2` class is present at all widths, and `max-w-[480px]`
  keeps the desktop column centered.

---

## Story 4 — Activity rows render correctly at mobile width

**As a** mobile user on the `/transactions` page with completed transactions,
**I want** to see each transaction row showing status icon, type, timestamp on
the left and the amount on the right,
**so that** I can scan my transaction history on a small screen.

### Acceptance criteria

- At 402 px viewport width, each `ActivityRow` renders without horizontal
  overflow or text truncation.
- Completed Buy (Deposit) rows show a positive USDC amount formatted as
  `+N,NNN.NN USDC` on the right.
- In-flight (pending) rows show the "Pending" secondary line beneath the
  amount.
- Stake/Unstake rows show two-line amounts (PLUSD and sPLUSD).
- The "Buy" tab is active by default; tabs Buy / Sell / Stake / Unstake are
  present; no "All" tab is shown.

---

## Story 5 — Single semantic heading on all viewports

**As a** screen-reader user,
**I want** the Activity page to have exactly one `<h2>` heading for the activity section,
**so that** the heading hierarchy is unambiguous.

### Acceptance criteria

- There is exactly one `<h2>` element containing the "Activity" heading text at
  every viewport width (no duplicate headings introduced by the responsive
  implementation).
