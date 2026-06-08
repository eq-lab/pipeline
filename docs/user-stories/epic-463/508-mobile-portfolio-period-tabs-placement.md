# Issue #508 — Mobile home: Portfolio card period tabs placement

Source: https://github.com/eq-lab/pipeline/issues/508

Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1987-7990

---

## Story 1 — Period tabs stack below the balance block on mobile

**Given** I am on the home page (`/`) at a mobile viewport (width < 768px)
**And** my wallet is connected

**When** the Portfolio placeholder card is visible

**Then** the period tabs (`7D / 1M / 3M / 1Y / All`) appear **below** the "Total Balance /
balance value / CTA" block, left-aligned with the card edge (matching Figma node
`1987:7995` at `x=0, y=84`).

**And** the tabs are NOT positioned to the top-right of the balance block.

---

## Story 2 — Desktop period tabs remain top-right (no regression)

**Given** I am on the home page (`/`) at a desktop viewport (width >= 768px)
**And** my wallet is connected

**When** the Portfolio placeholder card is visible

**Then** the period tabs (`7D / 1M / 3M / 1Y / All`) appear **to the right** of the
"Total Balance / balance value / CTA" block, aligned to the top of the card header row —
unchanged from the pre-#508 layout (per #250 Story 2).
