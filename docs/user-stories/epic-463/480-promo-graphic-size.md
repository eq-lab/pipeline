# User Stories — #480 ConnectWalletPromoCard decorative graphic size/position (mobile)

Epic: [#463 Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#480](https://github.com/eq-lab/pipeline/issues/480)
Status: Initial

---

## Story 1 — WalletIllustration is ~235 px wide on a 402 px mobile viewport

**Given** the home page is rendered at a 402 px wide viewport (mobile breakpoint, below `md` = 768 px)
**When** a QA agent inspects the computed width of the WalletIllustration inside the ConnectWalletPromoCard
**Then** the illustration wrapper has a computed width of approximately **235 px**, matching Figma node 1989:9179 in frame 1989-8292.

---

## Story 2 — WalletIllustration is anchored to the lower-right of the card on mobile

**Given** the home page is rendered at a 402 px wide viewport
**When** a QA agent inspects the position of the WalletIllustration wrapper inside the ConnectWalletPromoCard
**Then** the wrapper's top offset is approximately **117 px** (placing the centre of the 150 px-tall illustration near the lower half of the 274 px card), and the illustration bleeds off the right card edge — matching the Figma lower-right anchor.

---

## Story 3 — WalletIllustration remains ~314 px wide on desktop (≥ 768 px)

**Given** the home page is rendered at a viewport width of 768 px or wider
**When** a QA agent inspects the computed width of the WalletIllustration inside the ConnectWalletPromoCard
**Then** the illustration wrapper has a computed width of approximately **314 px** and uses the original percentage-based vertical position (`top: 70%`), with no regression to desktop layout.

---

## Out of scope

- Desktop card layout or other card variants.
- Any other illustration or card on the page.
