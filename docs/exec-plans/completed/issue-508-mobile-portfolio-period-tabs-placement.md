# Issue #508: Mobile home: Portfolio card period tabs render top-right; Figma places them left-aligned below the balance

Source: https://github.com/eq-lab/pipeline/issues/508

## Scope

Fix the mobile layout of the segmented period tabs (`7D / 1M / 3M / 1Y / All`) inside
`PortfolioPlaceholderCard`. On mobile (< `md`, 768px) the tabs must be **left-aligned and
stacked below** the "Total Balance / $X / CTA" block, matching Figma frame `1987:7990`
where the `tabs` instance (`1987:7995`) sits at `x=0, y=84`.

In scope:
- `packages/frontend/src/components/PortfolioPlaceholderCard.tsx` — make the header row
  responsive: stacked (tabs below the balance/CTA block, left-aligned) below `md`, and the
  current row layout (tabs top-right) at `md` and above.
- Update / extend `PortfolioPlaceholderCard.test.tsx` to assert the responsive layout
  classes (and keep existing behavior assertions green).

Out of scope:
- The **desktop** placement (top-right, per #250 Story 2) must remain byte-for-byte
  unchanged — it is correct and matches the desktop design.
- Chart rendering, hover/tooltip behavior, balance values, CTA copy/links, and all other
  card content — untouched.
- No changes to the shared `SegmentedTabs` primitive (`packages/ui`) — the layout change
  is confined to how `PortfolioPlaceholderCard` arranges its header.
- No product-spec change: this is a pure mobile-layout `fix/` with no behavior change.

## Assumptions and Risks

- **Single shared component, two render sites.** `PortfolioPlaceholderCard` is rendered
  twice in `packages/frontend/src/routes/index.tsx`:
  - mobile block (line ~176) inside `<div className="flex flex-col gap-2 md:hidden">`,
    always with `mobileHomeState` set;
  - desktop block (line ~249) inside `<div className="hidden ... md:block">`, never with
    `mobileHomeState`.
  Because the two sites are already gated by `md:hidden` / `hidden md:block`, the cleanest
  fix is **responsive Tailwind classes inside the component** (mobile-first default =
  stacked; `md:` = row). This keeps desktop unchanged regardless of which instance renders
  it, and avoids branching on `mobileHomeState` for layout (which would couple layout to
  the balance-state discriminator). Confirm this approach with the responsive-class
  strategy below.
- **Risk — desktop regression.** Any change to the header container classes could shift
  the desktop top-right layout. Mitigate by making the default (no-prefix) classes the
  mobile/stacked layout and re-applying the existing row classes under `md:` so the
  computed desktop result is identical to today.
- **Risk — tab width.** The issue specifies the mobile tabs instance is **224px wide**.
  The `floating` SegmentedTabs variant currently sizes intrinsically (sum of pill widths).
  Whether the 224px is a hard requirement or just the natural rendered width of the five
  pills is uncertain — see Open Questions.
- The card itself is full-width on mobile (`w-full`), wider than 224px at a 402px viewport,
  so left-aligning the tabs places them flush-left below the balance/CTA block with the
  remaining card width to their right (matches Figma `x=0`).

## Open Questions

- Is the **224px width** of the mobile tabs (`1987:7995`) a hard layout requirement, or is
  it just the intrinsic rendered width of the five `floating` pills at the Figma frame's
  scale? If it must be exactly 224px, the coder should constrain the tabs container width
  on mobile (e.g. `w-[224px] md:w-auto`); if it is incidental, leave the `floating` variant
  intrinsic and only change alignment/stacking. Recommend confirming against the Figma
  frame before deciding whether to pin the width.

## Implementation Steps

1. In `packages/frontend/src/components/PortfolioPlaceholderCard.tsx`, change the header
   wrapper (currently `<div className="flex items-start justify-between gap-4">`, ~line
   191) to a mobile-first **stacked** layout that becomes the existing row layout at `md`:
   - Default (mobile): `flex flex-col items-start gap-4` (or `gap-3`/`gap-4` to match the
     Figma `y=84` offset — the balance/CTA block then the tabs below it, both left-aligned).
   - At `md`+: restore the current arrangement → `md:flex-row md:items-start
     md:justify-between md:gap-4`.
   This makes the tabs naturally fall below the `<header>` block and left-align on mobile,
   while keeping the desktop row + `justify-between` (tabs top-right) intact.
2. On the `SegmentedTabs` instance (~line 274), drop reliance on `justify-between` for its
   desktop right-alignment (still provided by the parent `md:justify-between`) and ensure it
   does not stretch on mobile. Keep `className="shrink-0"`; if Open Question resolves to a
   pinned width, add `w-[224px] md:w-auto` (mobile 224px, intrinsic on desktop). If width is
   incidental, leave as-is so the floating pills stay intrinsic and left-aligned.
3. Verify the `<header>` block keeps `flex flex-col gap-1` unchanged (balance label /
   value / earning caption / CTA stack is not affected by the header-row change).
4. Do not touch the desktop render site or the mobile render site in
   `packages/frontend/src/routes/index.tsx` — the responsive classes inside the component
   handle both. Confirm the desktop block (`hidden md:block`) renders the unchanged
   top-right layout and the mobile block (`md:hidden`) renders the stacked layout.
5. Run lint and the doc linter (`npx tsx scripts/lint-docs.ts`) and the frontend unit
   tests; fix any failures.

## Test Strategy

- **Unit (`PortfolioPlaceholderCard.test.tsx`):**
  - Keep all existing assertions green (eyebrow, `$0.00`, CTA link, tab semantics, chart
    structure, hover) — these are layout-agnostic and must not regress.
  - Add a test asserting the header wrapper carries the mobile-stacked + `md:`-row
    responsive classes (query the wrapper element and assert it has `flex-col` by default
    and `md:flex-row` / `md:justify-between`). This pins the fix so a future change can't
    silently revert to the row-only layout.
  - If the 224px width is pinned (per Open Question), add an assertion that the tablist
    container has the `w-[224px]` (mobile) class and `md:w-auto`.
- **Edge cases:** verify the tab semantics tests still pass with the new wrapper (clicking
  `1M`, earning caption updates) — the `SegmentedTabs` instance and its handlers are
  unchanged, so these should be unaffected.
- **Figma-driven verification (manual / ux pass):** Per the Figma reference in the issue
  (`1987:7990`, tabs `1987:7995` at `x=0, y=84`, width 224px; cross-check State A
  `1988:7074` and State C `1886:46777`), load `/` at a mobile viewport (≤ 402px) with a
  connected wallet seeded per
  `docs/user-stories/epic-463/466-mobile-home-balance-states.md` and confirm the tabs sit
  left-aligned below the balance/CTA block. Also load a 1440px desktop viewport and confirm
  the tabs remain top-right (no #250 regression).

## Docs to Update

- None required. This is a `fix/` with no behavior or product change; the user-stories doc
  `docs/user-stories/epic-463/466-mobile-home-balance-states.md` already describes the
  intended mobile portfolio card and does not need editing (it does not over-specify tab
  placement). If the coder pins the 224px width as a deliberate decision, add a one-line
  note to the component's layout doc comment in `PortfolioPlaceholderCard.tsx` only.
