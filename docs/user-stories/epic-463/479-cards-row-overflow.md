# User Stories — #479 Cards row overflow fix (mobile)

Epic: [#463 Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#479](https://github.com/eq-lab/pipeline/issues/479)
Status: Initial

---

## Story 1 — Two-column cards row ends at the 8 px right page margin on a 402 px viewport

**Given** the home page is rendered at a 402 px wide viewport (mobile breakpoint, below `sm` = 640 px) with a wallet connected and balances loaded
**When** a QA agent measures the right edge of the two-column cards row (Figma node 1989:9006, containing StakeCard and EarnCard side-by-side)
**Then** the row ends at x = 394 px (i.e. 402 − 8 px right page margin), matching the right edge of the ConnectWallet / StartHere card above it, and no horizontal scrollbar is visible.

---

## Story 2 — Left column is 189 px wide at a 402 px viewport

**Given** the home page is rendered at a 402 px wide viewport
**When** a QA agent measures the computed width of the left card column inside node 1989:9006
**Then** the left column is **189 px** wide, matching the Figma spec for that node at 402 px.

---

## Story 3 — Layout scales fluidly at 360 px and 430 px viewports

**Given** the home page is rendered at 360 px wide and then at 430 px wide (common mobile device widths)
**When** a QA agent checks the two-column cards row at each width
**Then** the row fits within the viewport at both sizes with an 8 px right margin, the columns resize proportionally, and no overflow or horizontal scrollbar appears.

---

## Story 4 — Desktop layout is unaffected

**Given** the home page is rendered at a viewport width of 768 px or wider
**When** a QA agent inspects the cards layout
**Then** the card arrangement matches the desktop Figma spec with no visual regression introduced by the overflow fix.

---

## Out of scope

- Card content correctness (balances, APY values) — tracked in #466.
- ConnectWalletPromoCard graphic size — tracked in #480.
