# User Stories: #502 — Deposit suggestion bar: Min chip reads "$1,000.00 (Min)" and chip row overflows the card on mobile

Epic: [#498 — Deposit/withdraw page](https://github.com/eq-lab/pipeline/issues/498)
Issue: [#502](https://github.com/eq-lab/pipeline/issues/502)
Figma: [node 1993:7915 in frame 1993-7701](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1993-7701&m=dev)

The Min chip in the suggestion bar of the deposit conversion card must display whole-dollar
amounts without the `.00` suffix (e.g. `$1,000 (Min)` not `$1,000.00 (Min)`), matching
the Figma spec. Dropping the two decimal digits recovers ~25 px so all four chips
(`$1,000 (Min)`, `$5,000`, `$10,000`, `Max`) fit inside the card on a 402 px mobile viewport
without overflow.

---

## Story 1: Min chip shows no decimal places for a whole-dollar minimum deposit (mobile)

**Persona:** A mobile user (viewport 402×874) on the `/deposit` page.

**Pre-conditions:** App running; wallet connected with USDC balance ≥ minDeposit; minDeposit is an exact whole-dollar amount (e.g. 1,000 USDC at 6 decimals).

**Steps:**

1. Open `/deposit` at 402 px wide.
2. Locate the suggestion-bar chip row inside the USDC input card.
3. Read the label on the first chip.

**Expected outcomes:**

- The first chip reads `$1,000 (Min)` — no `.00` suffix.
- All four chips (`$1,000 (Min)`, `$5,000`, `$10,000`, `Max`) are fully visible within the gray container; none are clipped at the right edge of the 402 px viewport.

---

## Story 2: Clicking the Min chip fills the input with the correct amount

**Persona:** A user on the deposit page with minDeposit = 1,000 USDC.

**Pre-conditions:** App running; wallet connected; minDeposit = 1,000 USDC (1,000,000,000 raw at 6 decimals).

**Steps:**

1. Open `/deposit`.
2. Click the `$1,000 (Min)` chip.
3. Observe the numeric input field value.

**Expected outcomes:**

- The numeric input is populated with the formatted minDeposit value (`1000.00`).
- The chip label itself is `$1,000 (Min)` (no decimal places in the chip label).

---

## Story 3: Min chip label reflects a non-standard whole-dollar minimum (e.g. $250)

**Persona:** A user on a deployment where minDeposit = 250 USDC.

**Pre-conditions:** App running; minDeposit mock set to 250,000,000 (250 USDC at 6 decimals).

**Steps:**

1. Open `/deposit`.
2. Observe the first chip label.

**Expected outcomes:**

- The chip reads `$250 (Min)` — not `$250.00 (Min)`.

---

## Story 4: Min chip label retains cents when minimum has a fractional component

**Persona:** A user on a deployment where minDeposit has a non-zero fractional part (e.g. 1,000.50 USDC).

**Pre-conditions:** App running; minDeposit mock set to 1,000,500,000 (1,000.50 USDC at 6 decimals).

**Steps:**

1. Open `/deposit`.
2. Observe the first chip label.

**Expected outcomes:**

- The chip reads `$1,000.50 (Min)` — fractional cents are retained when the amount is not a whole number.
