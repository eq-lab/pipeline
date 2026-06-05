# User Stories: #476 — StartHereCard Sell button dimmed style

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#476](https://github.com/eq-lab/pipeline/issues/476)
Figma: [node 1989:9022 in frame 1989-8292](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1989-8292)

On mobile, the Sell button in `StartHereCard` is de-emphasized (32% opacity via the
`secondary` Button variant's `disabled:opacity-[0.32]`) and non-interactive when the
user has nothing to sell — disconnected or zero balances. With a positive PLUSD or
sPLUSD balance, Sell renders at full opacity and is interactive.

---

## Story 1: Wallet disconnected — Sell dimmed and not clickable (mobile)

**Persona:** A mobile visitor (< 768px viewport) without a connected wallet.

**Pre-conditions:** App running; home route loaded; no wallet connected; viewport < 768px.

**Steps:**

1. Load the home page at `/` on a mobile viewport.
2. Locate the StartHereCard ("Start here / Get PLUSD" heading).
3. Inspect the Buy and Sell buttons.

**Expected outcomes:**

- The Buy button is fully opaque and interactive.
- The Sell button is dimmed (`opacity` resolves to approximately 0.32) and not clickable — the `disabled` attribute is present on the button element.

---

## Story 2: Connected, zero balances — Sell dimmed and not clickable (mobile)

**Persona:** A mobile user with a connected wallet holding 0 PLUSD and 0 sPLUSD.

**Pre-conditions:** App running; wallet connected (mock keys set) with zero balances; viewport < 768px.

**Steps:**

1. Load the home page at `/`.
2. Locate the StartHereCard ("Start here / Get PLUSD" heading).
3. Inspect the Sell button.

**Expected outcomes:** The Sell button is dimmed (~32% opacity), not clickable, and carries the `disabled` attribute.

---

## Story 3: Connected, has PLUSD — Sell fully interactive (mobile)

**Persona:** A mobile user with a connected wallet and a positive PLUSD balance.

**Pre-conditions:** App running; wallet connected with PLUSD > 0; viewport < 768px.

**Steps:**

1. Load the home page at `/`.
2. Locate the StartHereCard ("PLUSD Balance" heading with the formatted balance).
3. Inspect the Buy and Sell buttons.

**Expected outcomes:** Both Buy and Sell are fully opaque and interactive; the `disabled` attribute is absent from both.

---

## Story 4: Connected, has sPLUSD — Sell fully interactive (mobile)

**Persona:** A mobile user with a connected wallet and a positive sPLUSD balance.

**Pre-conditions:** App running; wallet connected with sPLUSD > 0; viewport < 768px.

**Steps:**

1. Load the home page at `/`.
2. Locate the StartHereCard ("PLUSD Balance" heading).
3. Inspect the Buy and Sell buttons.

**Expected outcomes:** Both Buy and Sell are fully opaque and interactive; the `disabled` attribute is absent from both.

---

## Story 5: Desktop — Sell not dimmed regardless of wallet state

**Persona:** A desktop user (≥ 768px viewport) in any wallet state.

**Pre-conditions:** App running; viewport ≥ 768px.

**Steps:**

1. Load the home page at `/`.
2. Locate the StartHereCard in the desktop grid.
3. Inspect the Sell button.

**Expected outcomes:** The desktop StartHereCard applies no opacity dimming to Sell; the button is interactive regardless of wallet state, and the `disabled` attribute is absent.
