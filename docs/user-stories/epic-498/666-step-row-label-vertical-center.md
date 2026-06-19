# User story: #666 — Step row labels are vertically centered

**Epic:** #498 — Deposit/withdraw page
**Issue:** https://github.com/eq-lab/pipeline/issues/666
**Status:** Initial

---

## Overview

These stories verify that in the `StepRow` component (rendered inside `StepsCard`
on the deposit page, and shared with the Stake page), the step label text
(e.g. **"Enable PLUSD"**, **"Allow Pipeline to use USDC"**) is vertically
centered within its row — aligned with the numbered step badge on the left and
the trailing action button on the right.

The row uses `flex items-center`: badge, label, and action button share a common
vertical center. When a long label wraps to two lines, the badge and button
align to the **mid-point of the label block**, not its top.

`StepRow` source: `packages/ui/src/components/StepRow/StepRow.tsx`.

---

## Story 1 — Single-line label is centered (deposit page, desktop)

**Persona:** An LP on the deposit page, wallet connected, in a state that shows
the step rows (e.g. "Enable PLUSD" / "Allow Pipeline to use USDC").

**Steps:**

1. Open the deposit page at a desktop width (e.g. 1280px).
2. Reach a state that renders the step rows (approval / deposit steps).
3. Look at a step row whose label fits on a single line.

**Expected:**

- The label text is vertically centered within the row.
- The label's vertical center lines up with the center of the numbered step
  badge (left) and the center of the action button (right).
- No row element sits flush to the top of the row.

---

## Story 2 — Wrapped two-line label stays centered (deposit page, mobile)

**Persona:** An LP on the deposit page on a narrow mobile viewport (~402px),
where a long step label wraps to two lines.

**Steps:**

1. Open the deposit page at ~402px width (mobile).
2. Reach a step-row state with a long label (e.g. "Allow Pipeline to use USDC")
   that wraps to two lines.
3. Observe the badge and action button relative to the two-line label block.

**Expected:**

- The label wraps to two lines (it is not truncated/clipped).
- The numbered badge and the action button align to the **vertical mid-point**
  of the two-line label block.
- The row reads as balanced — no element pinned to the top.

---

## Story 3 — Shared component: Stake page step rows are also centered

**Persona:** A user on the Stake page (#531), which reuses the same `StepRow`
component.

**Steps:**

1. Open the Stake page in a state that shows its step rows.
2. Inspect a step row both at desktop width and at ~402px mobile width.

**Expected:**

- Step row labels are vertically centered, matching the deposit page behavior in
  Stories 1 and 2 — confirming the shared-component fix resolves both pages.

---

## Notes

- This is a CSS-only alignment change (`items-start` → `items-center` on the row
  root). Success state (green check pill) and loading state (spinner) rows must
  also remain vertically centered.
