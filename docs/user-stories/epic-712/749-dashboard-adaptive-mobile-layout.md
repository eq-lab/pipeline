# User Stories: #749 — Protocol Dashboard: adaptive (mobile) layout

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#749](https://github.com/eq-lab/pipeline/issues/749)
Figma (mobile XS frame): [node 3283-71053](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-71053&m=dev)

---

## Story 1: Loan Book table horizontally scrolls on mobile — no stacked cards

**Persona:** Any user viewing the Protocol Dashboard on a mobile device.

**Pre-conditions:** Dev server running at `http://localhost:3000`; at least one active loan in the API response.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` with browser viewport width set to 375px (mobile).
2. Scroll to the Loan Book (Panel B) section.
3. Observe the table area.

**Expected outcomes:**

- The full 7-column table (Borrower/Commodity, Principal, Collateral, LTV, Duration, Rate, Protection) is visible.
- The table scrolls horizontally inside the Loan Book section — the section itself does NOT scroll the page body horizontally.
- No "stacked card" layout (label + value pairs per row) is shown.
- The table header row is visible and shows all 7 column labels.
- Column header aggregates (e.g. "Principal · $31.6M") still render in the header row.

---

## Story 2: Withdrawal Queue table shows 3 columns on mobile — no stacked cards

**Persona:** Any user viewing the Protocol Dashboard on a mobile device.

**Pre-conditions:** Dev server running; at least one withdrawal request in the API response.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 375px viewport width.
2. Scroll to the Withdrawal Queue (Panel C) section.
3. Observe the table area.

**Expected outcomes:**

- A real 3-column table (Holder / Amount / Status) is visible.
- The Status column renders colored status text (e.g. "Processing" or "Queued") — not a stacked label/value card.
- No "stacked card" mobile layout is rendered.
- The table fits within the 370px section width without triggering horizontal page scroll.

---

## Story 3: Loan Book summary cards display in a 2-column grid on mobile

**Persona:** Any user viewing the Protocol Dashboard on a mobile device.

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 375px viewport width.
2. Scroll to the Loan Book (Panel B) section.
3. Observe the five summary cards above the table (Total Deployed, Collateral, Senior Debt Coverage, Yield, Average Duration).

**Expected outcomes:**

- The summary cards are arranged in a 2-column grid (2 cards side-by-side per row).
- Cards fill the available width — they are NOT fixed-width (180px) with horizontal overflow scroll.
- No horizontal scroll is triggered by the summary cards row.
- All five cards are reachable (the fifth card wraps onto a second row in the 2-up grid).

---

## Story 4: Withdrawal Queue summary cards display in a 2-column grid on mobile

**Persona:** Any user viewing the Protocol Dashboard on a mobile device.

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 375px viewport width.
2. Scroll to the Withdrawal Queue (Panel C) section.
3. Observe the four summary cards (In Queue, Requests, Estimated wait, Liquid Cover).

**Expected outcomes:**

- The summary cards are arranged in a 2-column grid (2 cards per row, 2 rows).
- Cards fill the available width — NOT fixed-width (160px) scrolling strip.
- No horizontal scroll is triggered by the summary cards row.
- All four cards are visible without scrolling.

---

## Story 5: All three Yield metric cards are visible on mobile

**Persona:** Any user viewing the Protocol Dashboard on a mobile device.

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 375px viewport width.
2. Scroll to the Yield History (Panel D) section.
3. Observe the metric cards below the chart (Current APY, Loan Book Yield, Target Net to sPLUSD).

**Expected outcomes:**

- All three metric cards are visible — none are hidden on mobile.
- The metric cards are arranged in a horizontal row that scrolls horizontally if needed (overflow-x scroll within the cards area).
- The "Target Net to sPLUSD" card (the third card, static value "8–12%") is NOT hidden or removed on mobile.
- No vertical stacking of metric cards (they remain in a flex-row).

---

## Story 6: TVL area chart "Coming soon" placeholder renders (seam for #738)

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at any viewport width.
2. Scroll to the Yield History (Panel D) section.
3. Observe the chart card area.

**Expected outcomes:**

- A second chart card is visible alongside the Cumulative Yield card.
- The card shows the text "TVL chart — Coming soon" (or similar placeholder text) to indicate the TVL area chart will land once backend issue #738 is resolved.
- The placeholder card has the same visual treatment (border, radius, padding) as the Cumulative Yield card.
- On desktop, the two chart cards sit side-by-side. On mobile, they stack vertically.

**Known seam:** The real TVL area chart cannot be built until backend #738 delivers the endpoint. This placeholder is intentional.

---

## Story 7: Mobile page padding is 16px (no horizontal overflow)

**Persona:** Any user viewing the Protocol Dashboard on a mobile device.

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 375px and 402px viewport widths.
2. Observe whether any content overflows horizontally (causes a horizontal scrollbar on the page body).

**Expected outcomes:**

- No horizontal page scrollbar is present at 375px or 402px.
- The white content container has approximately 16px inner padding on mobile.
- The page outer gutter is approximately 16px on mobile (matching the Figma XS frame's 16px gutter at 402px).

---

## Story 8: Desktop layout is unchanged (regression guard)

**Persona:** Any user viewing the Protocol Dashboard on a desktop browser.

**Pre-conditions:** Dev server running; viewport width >= 768px.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 1280px viewport width.
2. Inspect the Loan Book summary cards, Withdrawal Queue summary cards, Loan Book table, and Yield metric cards.

**Expected outcomes:**

- Loan Book summary cards: 5-column grid (all five cards in one row).
- Withdrawal Queue summary cards: 4-column grid (all four cards in one row).
- Loan Book table: full 7-column table displayed without horizontal scroll.
- Withdrawal Queue table: full 3-column table displayed.
- All three Yield metric cards displayed side-by-side in a flex-row.
- No visual regression from the desktop Figma frame `3283-12098`.

---

## Known divergences from Figma XS frame `3283-71053`

These divergences are intentional and owned by separate issues:

1. **Balance Sheet body** — Figma XS shows the full Statement of Financial Position (Assets / Liabilities). This is owned by issue #718 (Panel A: Balance Sheet & Reconciliation UI) which is currently blocked pending a backend endpoint. The "Coming soon" placeholder remains.
2. **TVL area chart real data** — The Figma XS shows a real TVL area chart. This is a seam for backend issue #738. A "Coming soon" placeholder is rendered in its place until #738 lands.
