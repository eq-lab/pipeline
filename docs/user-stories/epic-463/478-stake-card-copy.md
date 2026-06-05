# User Stories: #478 — StakeCard copy fixes

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#478](https://github.com/eq-lab/pipeline/issues/478)

Figma references:
- APY line node: `1989:9039` — "Earn X.XX% p.a."
- Subtitle node: `1989:9042` — "From senior loan coupons and T-bills"

---

## Story 1: APY line includes "p.a." suffix

**Persona:** Any user viewing the home page (disconnected or connected, any state).

**Pre-conditions:** App running; the APY figure is available from the API.

**Steps:**

1. Open the app at `/` (any viewport).
2. Locate the StakeCard (the white card advertising staking yield).
3. Read the large display-font line showing the APY.

**Expected outcomes:** The APY line reads "Earn X.XX% p.a." — the text ends with "% p.a." (e.g. "Earn 8.42% p.a.").

---

## Story 2: Subtitle reads "From senior loan coupons and T-bills"

**Persona:** Any user viewing the home page (disconnected or State A/B — any state except State C).

**Pre-conditions:** App running; wallet disconnected or connected without sPLUSD.

**Steps:**

1. Open the app at `/` (any viewport).
2. Locate the StakeCard.
3. Read the small muted caption below the APY line.

**Expected outcomes:** The caption reads exactly "From senior loan coupons and T-bills" (note "senior").

---

## Story 3: Desktop variant uses the same strings

**Persona:** A desktop user (≥ 768px viewport).

**Pre-conditions:** App running; viewport ≥ 768px (e.g. 1280px).

**Steps:**

1. Open the app at `/` at a 1280px viewport.
2. Locate the StakeCard in the desktop grid.
3. Read the APY line and the subtitle.

**Expected outcomes:** The APY line ends with "% p.a." and the subtitle includes "senior" — identical strings to the mobile variant.
