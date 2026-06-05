# User Stories — #474 Mobile home: card interior padding

Epic: [#463 Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#474](https://github.com/eq-lab/pipeline/issues/474)
Status: Initial

---

## Story 1 — ConnectWalletPromoCard has 16 px interior padding at 402 px mobile viewport

**Given** the home page is rendered at a 402 px wide viewport (mobile breakpoint, below Tailwind `md` = 768 px) with the wallet disconnected
**When** a QA agent inspects the computed padding of the ConnectWalletPromoCard (data-node-id `1497:94566`, `data-variant="yellow"`) inside the `md:hidden` mobile block
**Then** the computed padding is **16 px** on all four sides, matching Figma frame `1989:8292` node `1989:9173` (`p-[var(--size-16,16px)]`).

---

## Story 2 — StartHereCard has 8 px interior padding at 402 px mobile viewport

**Given** the home page is rendered at a 402 px wide viewport with the wallet disconnected
**When** a QA agent inspects the computed padding of the StartHereCard (data-node-id `1497:94676`, `data-variant="white"`) inside the `md:hidden` mobile block
**Then** the computed padding is **8 px** on all four sides, matching Figma frame `1989:8292` node `1989:9008` (`p-[var(--size-8,8px)]`).

---

## Story 3 — EarnedCard has 8 px interior padding at 402 px mobile viewport

**Given** the home page is rendered at a 402 px wide viewport
**When** a QA agent inspects the computed padding of the EarnedCard (data-node-id `1497:94691`, `data-variant="white"`) inside the `md:hidden` mobile block
**Then** the computed padding is **8 px** on all four sides, matching Figma frame `1989:8292` node `1989:9023`.

---

## Story 4 — StakeCard has 8 px interior padding at 402 px mobile viewport

**Given** the home page is rendered at a 402 px wide viewport
**When** a QA agent inspects the computed padding of the StakeCard (data-node-id `1497:94702`, `data-variant="white"`) inside the `md:hidden` mobile block
**Then** the computed padding is **8 px** on all four sides, matching Figma frame `1989:8292` node `1989:9032`.

---

## Story 5 — All four cards restore 24 px padding at desktop (≥ 768 px)

**Given** the home page is rendered at a viewport width of 768 px or wider
**When** a QA agent inspects the computed padding of any of the four home cards in the desktop grid (`hidden md:block` section)
**Then** each card has a computed padding of **24 px** on all four sides, matching the desktop Figma spec and preserving the existing layout.

---

## Story 6 — Desktop outer card wrapper padding is unaffected

**Given** the home page is rendered at a viewport width of 768 px or wider
**When** a QA agent inspects the computed padding of the outer white Card wrapper (data-node-id `1497:94565`, `data-variant="white"`, `hidden p-8 md:block`)
**Then** the computed padding is **32 px** on all four sides (no regression from the `p-8` override).

---

## Out of scope

- Card heading type scale — tracked in #473.
- Card heights — consequence of padding + #473 heading scale; not a pass/fail gate here.
- Connected mobile states — padding is identical to the disconnected state since the same component instances render; verified by the `padding` prop being unconditional.
