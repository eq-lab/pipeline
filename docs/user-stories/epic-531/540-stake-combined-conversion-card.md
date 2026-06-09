# User Stories: #540 — Stake page: merge input and output/rates into one conversion card

Epic: [#531 — Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#540](https://github.com/eq-lab/pipeline/issues/540)

Viewport: 1280×800 (desktop) and 402×874 (mobile). Mock scenario: "Connected, ready to stake (approved)" (`/test` fixture).

Figma references: node 1498-101158.

---

## Story 1: Stake tab — single white conversion card contains tabs, input, output preview, exchange rate, and network fee

**Persona:** A connected user with an approved allowance visiting `/stake` on the Stake tab.

**Pre-conditions:**

- App is running at `http://localhost:3000/stake`.
- Wallet is connected and the PLUSD allowance is already approved (use the `/test` fixture scenario "Connected, ready to stake (approved)").

**Steps:**

1. Open `http://localhost:3000/stake`.
2. Observe the conversion area above the steps card.

**Expected outcomes:**

- There is exactly one white card (rounded, elevated) that contains all of the following, top-to-bottom:
  - Segmented tab control ("Stake" / "Unstake") at the top of the card.
  - PLUSD token amount input field.
  - sPLUSD output preview row (estimated amount the user will receive).
  - Exchange-rate row (e.g. "1 PLUSD = X sPLUSD").
  - Network-fee row (e.g. "Network fee: ~$Y").
- The input field and output preview are separated by a visual divider or arrow inside the same card — they are not in two distinct cards.
- There is no separate "output card" rendered outside this white card.

---

## Story 2: Unstake tab — single card updates tokens, output preview, exchange rate, and network fee

**Persona:** A connected user switching to the Unstake tab.

**Pre-conditions:**

- App is running at `http://localhost:3000/stake`.
- Wallet is connected (use the `/test` fixture scenario "Connected, ready to stake (approved)").
- The Stake tab is currently active.

**Steps:**

1. Click the "Unstake" tab in the segmented control inside the white card.
2. Observe the conversion card contents.

**Expected outcomes:**

- The same single white card is still shown; no layout shift occurs.
- The input field now shows the sPLUSD token.
- The output preview now shows the PLUSD amount.
- The exchange-rate row reflects the unstake direction (e.g. "1 sPLUSD = X PLUSD").
- The network-fee row is still visible inside the card.
- The steps card below the conversion card updates to show the Unstake step.

---

## Story 3: Steps / connect card is rendered separately below the conversion card

**Persona:** A connected user ready to stake.

**Pre-conditions:**

- App is running at `http://localhost:3000/stake`.
- Wallet is connected and allowance approved (use the `/test` fixture scenario "Connected, ready to stake (approved)").

**Steps:**

1. Open `http://localhost:3000/stake`.
2. Scroll down past the conversion card.

**Expected outcomes:**

- The steps card ("Approve" / "Stake" actions) is visually separate from the conversion card — it has its own card container below the conversion card.
- The steps card is not nested inside the conversion card.
- The two cards do not merge into one visually (distinct backgrounds / border radius / spacing between them).

---

## Story 4: Mobile viewport — single conversion card layout matches desktop structure

**Persona:** A mobile user visiting `/stake`.

**Pre-conditions:**

- Browser viewport is set to 402×874.
- Wallet is connected and allowance approved (use the `/test` fixture scenario "Connected, ready to stake (approved)").

**Steps:**

1. Open `http://localhost:3000/stake` at 402×874 viewport.
2. Observe the full conversion card.

**Expected outcomes:**

- The single white conversion card is rendered: tabs → input → output preview → exchange-rate row → network-fee row, all within one card boundary.
- No element overflows the card horizontally.
- The steps card is rendered below the conversion card as a separate element.
