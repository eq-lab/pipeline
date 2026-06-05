# User Stories: #389 — Home Portfolio chart: stacked-bars monotonic-growth + hover tooltip

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#389](https://github.com/eq-lab/pipeline/issues/389)
Plan: `docs/exec-plans/completed/issue-389-portfolio-stacked-bars-chart.md`

> Migrated from `docs/STORIES.md` (S-389). The issue predates epic #463 — desktop home
> page work built under the old workflow.

---

## Story 1 (TC-389-1): Connected — chart renders 100 green stacked bars with earning caption

**Persona:** User / QA.

**Pre-conditions:** Dev server running; mock wallet connected (same localStorage setup as #250 Story 2: `pipeline.mock.wallet.isConnected` + `address`).

**Steps:**

1. Navigate to `http://localhost:3000/`
2. Observe the top-left Portfolio card

**Expected outcomes:**

- The card body shows 100 stacked bars in `--color-pipeline-chart-positive` (`#2D7B1F`) forming a monotonic-growth curve.
- Below the `$0.00` balance, the earning caption reads `+$42.80 earning` (default 7D period).
- The "7D" tab is active in the tab control.

---

## Story 2 (TC-389-2): Period switch — chart and caption update, no network call

**Persona:** User (connected via mock).

**Pre-conditions:** Story 1 completed; DevTools Network panel open.

**Steps:**

1. Click the "1M" tab — confirm earning caption shows `+$92.80 earning`
2. Click "3M" — confirm `+$192.80 earning`
3. Click "1Y" — confirm `+$542.80 earning`
4. Click "All" — confirm `+$842.80 earning`
5. Observe the DevTools Network panel throughout

**Expected outcomes:**

- Each tab switch updates the earning caption to the value listed above.
- The chart visually re-renders (curve spans differ).
- No network request fires for any tab switch.

---

## Story 3 (TC-389-3): Hover — vertical cursor + tooltip appear

**Persona:** User (connected via mock).

**Pre-conditions:** Story 1 completed.

**Steps:**

1. Slowly move the mouse across the chart body left-to-right
2. Pause near the left edge, then near the right edge

**Expected outcomes:**

- A vertical cursor line appears at the hovered position and snaps to the nearest bar slot.
- A tooltip floats above the cursor showing a balance (`$1,XXX.XX`) and a period-appropriate timestamp.
- At the left edge: the tooltip is clamped to stay within chart bounds; the cursor line is not clamped.
- At the right edge: same clamping behaviour (tooltip stays inside; cursor may reach the rightmost slot).

---

## Story 4 (TC-389-4): Mouse leave — cursor and tooltip disappear

**Persona:** User (connected via mock).

**Pre-conditions:** Story 3 completed (tooltip visible).

**Steps:**

1. Move the mouse out of the chart area

**Expected outcomes:**

- The vertical cursor line and tooltip both disappear immediately.
- The `+$42.80 earning` caption and chart bars remain unchanged.

---

## Story 5 (TC-389-5): Card grid does not reflow on tab switch or hover

**Persona:** User (connected via mock).

**Pre-conditions:** Story 1 completed.

**Steps:**

1. Switch through all 5 period tabs
2. Hover the chart and move the mouse around
3. Inspect the card height via DevTools

**Expected outcomes:**

- The card maintains its `min-height: 274px` throughout — no layout shift on tab switch or hover.
- Other cards in the home grid are not displaced.
