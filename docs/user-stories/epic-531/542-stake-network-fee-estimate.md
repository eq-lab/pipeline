# User Stories: #542 — Stake page network-fee estimate

Epic: [#531 — Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#542](https://github.com/eq-lab/pipeline/issues/542)

Viewport: 1280×800 (desktop). Mock scenario: Connected, ready to stake (approved).

---

## Story 1: Stake tab network-fee row shows an ETH estimate

**Persona:** A user who has connected their wallet and is viewing the Stake tab on `/stake`.

**Pre-conditions:**

- App is running at `http://localhost:3000/stake`.
- Wallet is connected and the "Connected, ready to stake (approved)" fixture scenario is active.
- The Stake tab is selected (default).
- Mock key `pipeline.mock.wallet.networkFeeEstimate.stake` is set to `"~0.00042 ETH"`.

**Steps:**

1. Open `http://localhost:3000/stake`.
2. Locate the **Network fee** row in the conversion card.

**Expected outcomes:**

- The Network-fee row renders the mocked value **"~0.00042 ETH"** (not "—").
- The value is ETH-denominated (no USD conversion).

---

## Story 2: Unstake tab network-fee row shows an ETH estimate

**Persona:** A user viewing the Unstake tab on `/stake`.

**Pre-conditions:**

- Same as Story 1 but with mock key `pipeline.mock.wallet.networkFeeEstimate.unstake` set to `"~0.00038 ETH"`.
- The Unstake tab is selected.

**Steps:**

1. Open `http://localhost:3000/stake`.
2. Click the **Unstake** tab.
3. Locate the **Network fee** row.

**Expected outcomes:**

- The Network-fee row renders **"~0.00038 ETH"** (not "—").

---

## Story 3: Network-fee row falls back to "—" when disconnected

**Persona:** A user who is not connected.

**Pre-conditions:**

- Wallet is disconnected (or no mock fee key is set and `STAKED_PLUSD_ADDRESS` is zero-address).

**Steps:**

1. Open `http://localhost:3000/stake` without connecting a wallet.
2. Locate the **Network fee** row.

**Expected outcomes:**

- The Network-fee row displays **"—"** (the fallback).
