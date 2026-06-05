# User Stories: #505 — StepsCard mobile: step labels truncate with ellipsis and buttons are 48px tall; Figma wraps labels and uses 32px buttons

Epic: [#498 — Deposit/withdraw page](https://github.com/eq-lab/pipeline/issues/498)
Issue: [#505](https://github.com/eq-lab/pipeline/issues/505)
Figma: [node 1993:7964 in frame 1993-7701](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1993-7701&m=dev)

On mobile (402×874 viewport) the 3-step card's step labels must wrap to two lines when the
text is too wide, matching the Figma spec. The action buttons (Approve / Confirm / Claim)
must be 32 px tall (h-8), not the default 48 px (h-12) used for the primary-dark variant.

---

## Story 1: Long step label wraps to two lines on mobile (no ellipsis)

**Persona:** A mobile user (viewport 402×874) on the `/deposit` page in the `connected-allowance-zero` scenario.

**Pre-conditions:** App running; wallet connected with USDC balance ≥ minDeposit; deposit state requires both Approve and Confirm steps.

**Steps:**

1. Open `/deposit` at 402 px wide.
2. Scroll to the StepsCard (3-step card near the bottom of the deposit form).
3. Read the label of Step 1.

**Expected outcomes:**

- Step 1 label "Allow Pipeline to use USDC" is fully visible, wrapping to a second line if necessary — no ellipsis (`…`) is shown.
- Step 2 label "Confirm USDC transaction" (or equivalent) is similarly fully readable without truncation.
- No label is clipped at the right edge.

---

## Story 2: Action buttons in StepsCard are 32px tall on mobile

**Persona:** A mobile user (viewport 402×874) on the `/deposit` page.

**Pre-conditions:** App running; wallet connected; at least one step is in the idle (active) state so its action button is visible.

**Steps:**

1. Open `/deposit` at 402 px wide.
2. Locate the StepsCard.
3. Inspect the rendered height of the action button (e.g. "Approve").

**Expected outcomes:**

- The action button renders at 32 px tall (matching Figma node 1993:7964).
- The button is not 48 px tall (the primary-dark default).
- Button width remains 88 px.

---

## Story 3: Step number badge and button align to the top of a wrapping label

**Persona:** A mobile user on the `/deposit` page with a long step label that wraps.

**Pre-conditions:** Same as Story 1 — long label causes a two-line wrap.

**Steps:**

1. Open `/deposit` at 402 px wide.
2. Observe the vertical alignment of the numbered badge (e.g. "1") and the action button relative to the label.

**Expected outcomes:**

- Both the numbered badge and the action button are top-aligned with the first line of the step label, not vertically centered relative to the full label height.
