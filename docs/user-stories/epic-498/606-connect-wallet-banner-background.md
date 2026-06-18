# User story: #606 — Fix connect-wallet banner background color to #F8FCE9

**Epic:** #498 — Deposit/withdraw page
**Issue:** https://github.com/eq-lab/pipeline/issues/606
**Status:** Initial

---

## Overview

The `--color-pipeline-promo` design token was `rgb(211 235 117 / 0.16)` (16% alpha),
which on the page background rendered as a washed-out greenish tint. The Figma design
specifies a solid `#F8FCE9`. The token has been updated to the solid value; this fix
applies to every component that uses `Card variant="yellow"`: the connect-wallet banner
on `/deposit` and `/stake`, plus the `ConnectWalletPromoCard` and
`PortfolioPlaceholderCard` on the home page.

Visual fidelity is verified by the QA agent's Figma comparison (Figma node 1994-7226).

---

## Story 1 — Connect-wallet banner on `/deposit` has the correct pale-yellow background

**Given** the user visits `/deposit` (or `/deposit?direction=withdraw`) without a
connected wallet

**When** the page renders

**Then:**

- The "Connect your wallet first" banner card has a solid pale-yellow background
  (`#F8FCE9`), not a washed-out translucent green
- The banner text and "Connect" button are clearly readable against the background

---

## Story 2 — Connect-wallet banner on `/stake` has the correct pale-yellow background

**Given** the user visits `/stake` without a connected wallet

**When** the page renders

**Then:**

- The "Connect your wallet first" banner card has a solid pale-yellow background
  (`#F8FCE9`), matching the deposit page banner

---

## Story 3 — Home page promo cards are not visually regressed

**Given** the user visits `/` (home) without a connected wallet

**When** the page renders

**Then:**

- The `ConnectWalletPromoCard` (left dashboard column) renders with the same
  pale-yellow `#F8FCE9` background — no visible change in hue compared to
  the previous semi-transparent token on a white card background
- The `PortfolioPlaceholderCard` likewise retains its pale-yellow surface
