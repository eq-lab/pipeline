# User Stories: #478 — StakeCard copy fixes

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#478](https://github.com/eq-lab/pipeline/issues/478)

Figma references:
- APY line node: `1989:9039` — "Earn X.XX% p.a."
- Subtitle node: `1989:9042` — "From senior loan coupons and T-bills"

---

## Story 1 — APY line includes "p.a." suffix

**Given** the home page renders the StakeCard (disconnected or connected, any state)
**When** the APY figure is available from the API
**Then** the APY line reads "Earn X.XX% p.a." (with the " p.a." suffix)

### Verification steps

1. Open the app (any viewport).
2. Locate the StakeCard (the white card advertising staking yield).
3. Find the large display-font line showing the APY.
4. Confirm the text ends with "% p.a." — e.g. "Earn 8.42% p.a.".

---

## Story 2 — Subtitle reads "From senior loan coupons and T-bills"

**Given** the home page renders the StakeCard (disconnected or connected, any state except State C)
**When** the card renders
**Then** the caption line reads "From senior loan coupons and T-bills"

### Verification steps

1. Open the app (any viewport, wallet disconnected or State A/B).
2. Locate the StakeCard.
3. Find the small muted caption below the APY line.
4. Confirm the text is "From senior loan coupons and T-bills" (note "senior").

---

## Story 3 — Desktop variant uses the same strings

**Given** the app is viewed at a desktop viewport (>= 768px)
**When** the StakeCard renders
**Then** the APY line reads "Earn X.XX% p.a." and the subtitle reads "From senior loan coupons and T-bills"

### Verification steps

1. Open the app at a 1280px viewport.
2. Locate the StakeCard in the desktop grid.
3. Confirm APY line ends with "% p.a.".
4. Confirm subtitle includes "senior".
