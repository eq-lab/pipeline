# User Stories — #475 StartHereCard Buy/Sell button height (mobile)

Epic: [#463 Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#475](https://github.com/eq-lab/pipeline/issues/475)
Status: Initial

---

## Story 1 — Buy and Sell buttons are 40 px tall on a 402 px mobile viewport

**Given** the home page is rendered at a 402 px wide viewport (mobile breakpoint, below `sm` = 640 px)
**When** a QA agent inspects the computed height of the Buy button (data-node-id `1497:94689`) and the Sell button (data-node-id `1497:94690`) inside the StartHereCard
**Then** each button has a computed height of **40 px** (Tailwind `h-10`), matching Figma nodes 1989:9021 / 1989:9022 in frame 1989-8292.

---

## Story 2 — Buy and Sell buttons remain 48 px tall on desktop (≥ 768 px)

**Given** the home page is rendered at a viewport width of 768 px or wider
**When** a QA agent inspects the computed height of the Buy and Sell buttons in the StartHereCard
**Then** each button has a computed height of **48 px** (Tailwind `h-12`), matching the desktop Figma spec.

---

## Story 3 — The promo card Connect button is unaffected

**Given** the home page is rendered at any viewport width
**When** a QA agent inspects the height of the Connect button inside the wallet promo card
**Then** the button height is **48 px** at all breakpoints (no regression).

---

## Out of scope

- Sell button disabled-state opacity — tracked in #476.
- Any other button or card on the page.
