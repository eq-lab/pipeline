# User Stories: #541 — Stake page exchange-rate decimals fix

Epic: [#531 — Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#541](https://github.com/eq-lab/pipeline/issues/541)

Viewport: 1280×800 (desktop). Mock scenario: Connected, ready to stake (approved).

---

## Story 1: Stake tab exchange-rate row shows a human-readable rate

**Persona:** A user who has connected their wallet and is viewing the Stake tab on `/stake`.

**Pre-conditions:**

- App is running at `http://localhost:3000/stake`.
- Wallet is connected and the "Connected, ready to stake (approved)" fixture scenario is active.
- The Stake tab is selected (default).

**Steps:**

1. Open `http://localhost:3000/stake`.
2. Locate the exchange-rate row below the output card.

**Expected outcomes:**

- The exchange-rate row reads exactly **"1 PLUSD = 0.9596 sPLUSD"** (or the value derived from the fixture's on-chain rate, formatted to at most 4 decimal places).
- The value is NOT inflated by 1e12 (e.g. a value like "1 PLUSD = 959600000000 sPLUSD" is a bug).
- The number is a plain decimal between 0 and 2 — not in scientific notation and not zero.

---

## Story 2: Unstake tab exchange-rate row shows a human-readable rate

**Persona:** A user who switches to the Unstake tab on `/stake`.

**Pre-conditions:**

- App is running at `http://localhost:3000/stake`.
- Wallet is connected and the "Connected, ready to stake (approved)" fixture scenario is active.

**Steps:**

1. Open `http://localhost:3000/stake`.
2. Click the "Unstake" tab in the segmented tab control.
3. Locate the exchange-rate row below the output card.

**Expected outcomes:**

- The exchange-rate row reads exactly **"1 sPLUSD = 1.0421 PLUSD"** (or the value derived from the fixture's on-chain rate, formatted to at most 4 decimal places).
- The value is NOT inflated by 1e12.
- The number is a plain decimal between 0 and 2 — not in scientific notation and not zero.

---

## Story 3: Stake tab output preview is proportional to the typed amount

**Persona:** A user who types an amount into the PLUSD input on the Stake tab.

**Pre-conditions:**

- App is running at `http://localhost:3000/stake`.
- Wallet is connected and the "Connected, ready to stake (approved)" fixture scenario is active.
- The Stake tab is selected.

**Steps:**

1. Open `http://localhost:3000/stake`.
2. Click on the PLUSD amount input field.
3. Type `10`.
4. Observe the sPLUSD output preview (the large number shown in the output card).

**Expected outcomes:**

- The output preview shows approximately **9.60 sPLUSD** (within ±0.05 of `10 × 0.9596`).
- The output is NOT a number larger than 1e6 (which would indicate the 1e12 inflation bug).
- The output is NOT zero or blank.

---

## Story 4: Unstake tab output preview is proportional to the typed amount

**Persona:** A user who types an amount into the sPLUSD input on the Unstake tab.

**Pre-conditions:**

- App is running at `http://localhost:3000/stake`.
- Wallet is connected and the "Connected, ready to stake (approved)" fixture scenario is active.
- The Unstake tab is selected.

**Steps:**

1. Open `http://localhost:3000/stake`.
2. Click the "Unstake" tab.
3. Click on the sPLUSD amount input field.
4. Type `10`.
5. Observe the PLUSD output preview in the output card.

**Expected outcomes:**

- The output preview shows approximately **10.42 PLUSD** (within ±0.05 of `10 × 1.0421`).
- The output is NOT a number larger than 1e6.
- The output is NOT zero or blank.
