# User Stories: #754 — Protocol Dashboard: layout does not match Figma (spacings, font-sizes)

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#754](https://github.com/eq-lab/pipeline/issues/754)
Figma (desktop frame): [node 3283-12101](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-12101&m=dev)
Figma (responsive frame): [node 3283-71053](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-71053&m=dev)

---

## Story 1: Section headings render at 48px (heading-l) on desktop

**Persona:** Any user viewing the Protocol Dashboard on a desktop browser.

**Pre-conditions:** Dev server running at `http://localhost:3000`; viewport width >= 768px.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 1280px viewport width.
2. Inspect the "Loan Book" and "Withdrawal Queue" section headings using browser DevTools.
3. Check the computed font-size of each `<h2>` heading element.

**Expected outcomes:**

- The "Loan Book" section heading (`<h2>`) renders at **48px** (heading-l token) on desktop.
- The "Withdrawal Queue" section heading (`<h2>`) renders at **48px** (heading-l token) on desktop.
- Both headings use Besley (display serif) at font-weight 400 (Regular).
- The line-height is **56px** (heading-l line-height token).

---

## Story 2: Section headings step down to 28px on mobile

**Persona:** Any user viewing the Protocol Dashboard on a mobile device.

**Pre-conditions:** Dev server running; viewport width below 768px.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 375px viewport width.
2. Inspect the "Loan Book" and "Withdrawal Queue" section headings using browser DevTools.
3. Check the computed font-size.

**Expected outcomes:**

- The "Loan Book" and "Withdrawal Queue" section headings render at **28px** (heading-m token) below the `md` breakpoint.
- Line-height is **36px** (heading-m line-height token).
- Font is Besley (display serif), weight 400 (Regular).

---

## Story 3: Heading-to-content gap is 32px per section

**Persona:** Any user viewing the Protocol Dashboard on a desktop browser.

**Pre-conditions:** Dev server running; viewport width >= 768px.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 1280px viewport width.
2. Using browser DevTools, measure the vertical gap between the "Loan Book" `<h2>` heading and the summary cards below it.
3. Repeat for the "Withdrawal Queue" heading and its summary cards.

**Expected outcomes:**

- The gap between each `<h2>` heading (height 56px) and its section body content is **32px** (matching Figma: heading ends at y=56, cards start at y=88 → 32px gap).
- No extra top padding is present on the body wrapper — the 32px comes entirely from the panel container's flex gap.

---

## Story 4: Section-to-section (inter-section) gap is 96px on desktop

**Persona:** Any user viewing the Protocol Dashboard on a desktop browser.

**Pre-conditions:** Dev server running; viewport width >= 768px.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 1280px viewport width.
2. Measure the vertical space between the bottom of the Yield History section and the top of the Balance Sheet section heading.
3. Repeat between Balance Sheet → Loan Book, and Loan Book → Withdrawal Queue.

**Expected outcomes:**

- All inter-section gaps are **96px** (`gap-24` / `gap-xxl`), matching Figma `3283-12098`.

---

## Story 5: Section-to-section gap is 48px on mobile

**Persona:** Any user viewing the Protocol Dashboard on a mobile device.

**Pre-conditions:** Dev server running; viewport width below 768px.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 375px viewport width.
2. Measure the vertical space between dashboard sections.

**Expected outcomes:**

- All inter-section gaps are **48px** (`gap-12`), confirmed from Figma XS frame `3283-71053` (Top→Balance Sheet gap = 48px, all subsequent sections = 48px).

---

## Story 6: Loan Book and Withdrawal Queue table rows are 64px tall (12/12 padding)

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running; at least one active loan and one withdrawal request in API responses.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 1280px viewport width.
2. In the Loan Book table, inspect a body row using browser DevTools.
3. Measure the row's total height and the computed top/bottom padding on the `<td>` elements.
4. Repeat for the Withdrawal Queue table.

**Expected outcomes:**

- Each body `<td>` cell has `py-3` (12px top, 12px bottom) from the table cell only — no additional inner `<span>` vertical padding.
- Row total height is **64px** (12px top padding + 40px content block + 12px bottom padding), matching Figma `.row h=64` (node 3704:1095).
- Body cell text renders at 16px/22px (body token), ink colour.

---

## Story 7: Yield metric cards have 16px gap between them

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 1280px viewport width.
2. Scroll to the Yield History section.
3. Measure the gap between the three metric cards (Current APY, Loan Book Yield, Target Net to sPLUSD).

**Expected outcomes:**

- The inter-card gap is **16px** (`gap-4`), matching Figma `3283-67619` "Second card pair" gap.

---

## Story 8: Yield chart pair and metric card row have 16px vertical gap

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` at 1280px viewport width.
2. Inspect the Yield History section. Measure the vertical gap between the chart card row (Cumulative Yield + TVL placeholder) and the metric cards row.

**Expected outcomes:**

- The gap between the chart row and the metric cards row is **16px** (`gap-4`), matching the Figma XS frame (Charts end y=668, Second card pair y=684 → 16px gap).

---

## Known styling notes

- This issue is a pure visual-fidelity pass — no data, behaviour, or structural changes.
- Balance Sheet panel renders its own `<h2>` at heading-m → `md:heading-l` (bypasses `PanelContainer.title`) — no change needed there.
- Yield History panel passes no `title` to `PanelContainer` (no `<h2>` rendered) — no change needed there.
