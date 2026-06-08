# User Stories: #509 — Mobile home StartHereCard (connected): missing the '$X USDC' sub-line under the PLUSD balance

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#509](https://github.com/eq-lab/pipeline/issues/509)

Breakpoint: `md` (768px). Below 768px is mobile; 768px and above is desktop.

Figma frames:
- State B (has PLUSD, 0 sPLUSD): `1984:6501` — sub-line node `1984:6772`
- State C (has both PLUSD and sPLUSD): `1886:46777`

---

## Story 1: State B — USDC sub-line appears below the PLUSD balance (402px viewport)

**Persona:** A user who holds PLUSD but has not yet staked any.

**Pre-conditions:**
- App is running, home route (`/`) loaded.
- Wallet connected with 1 000 PLUSD balance, no sPLUSD.
- Viewport width approximately 402px.

**Seeding (via browser console or Vitest `beforeEach`):**

```js
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000000001");
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.asset",
  "0xaaaa000000000000000000000000000000000001"
);
localStorage.setItem(
  "pipeline.mock.wallet.balance.0xaaaa000000000000000000000000000000000001",
  "1000000000000000000000"
);
```

**Steps:**

1. Load `/` with the mobile viewport (402px wide).
2. Observe the `StartHereCard` in the left balances column.

**Expected outcomes:**

- **Step 2 (StartHereCard — connected variant):**
  - Eyebrow reads "PLUSD Balance".
  - A PLUSD coin icon appears next to the formatted balance value (e.g. `$1,000.00`).
  - Immediately below the balance row, a caption line reads `"$1,000.00 USDC"`
    in muted ink (caption token, Graphik LC — Figma node `1984:6772`).
  - Both "Buy" and "Sell" buttons are enabled.
  - The caption element has `data-testid="plusd-in-usdc"`.

---

## Story 2: State C — USDC sub-line still appears when PLUSD balance is non-zero (402px viewport)

**Persona:** A user who holds both PLUSD and sPLUSD shares.

**Pre-conditions:**
- App is running, home route loaded.
- Wallet connected with 1 000 PLUSD + 1 000 sPLUSD shares.
- Viewport width approximately 402px.

**Seeding:**

```js
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000000001");
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.asset",
  "0xaaaa000000000000000000000000000000000001"
);
localStorage.setItem(
  "pipeline.mock.wallet.balance.0xaaaa000000000000000000000000000000000001",
  "1000000000000000000000"
);
localStorage.setItem(
  "pipeline.mock.wallet.balance.<STAKED_PLUSD_ADDRESS>",
  "1000000000000000000000"
);
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets",
  "1042800000000000000"
);
```

Replace `<STAKED_PLUSD_ADDRESS>` with `ENV.STAKED_PLUSD_ADDRESS` for your environment.

**Steps:**

1. Load `/` with the mobile viewport (402px wide).
2. Observe the `StartHereCard` in the left balances column.

**Expected outcomes:**

- **Step 2 (StartHereCard — connected variant):**
  - Eyebrow reads "PLUSD Balance".
  - PLUSD coin icon + balance value (e.g. `$1,000.00`).
  - A `"$1,000.00 USDC"` caption appears below the balance row.
  - Both "Buy" and "Sell" buttons are enabled.

---

## Story 3: State C with zero PLUSD — sub-line shows "$0.00 USDC" (402px viewport)

**Persona:** A user who has staked all their PLUSD (holds only sPLUSD, PLUSD balance = 0).

**Pre-conditions:**
- Wallet connected, PLUSD balance = 0, sPLUSD balance > 0.
- Viewport width approximately 402px.

**Seeding:**

```js
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000000001");
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.asset",
  "0xaaaa000000000000000000000000000000000001"
);
// No PLUSD balance key → resolves as undefined / $0.00
localStorage.setItem(
  "pipeline.mock.wallet.balance.<STAKED_PLUSD_ADDRESS>",
  "1000000000000000000000"
);
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets",
  "1042800000000000000"
);
```

**Steps:**

1. Load `/` with the mobile viewport (402px wide).
2. Observe the `StartHereCard`.

**Expected outcomes:**

- **Step 2:**
  - Eyebrow reads "PLUSD Balance".
  - Balance value shows `$0.00`.
  - The USDC sub-line still appears and reads `"$0.00 USDC"` (not hidden).
  - Both "Buy" and "Sell" buttons are enabled (State C enables both).

---

## Story 4: Disconnected / State A — no USDC sub-line (regression)

**Pre-conditions:**
- Wallet disconnected or connected with zero PLUSD and zero sPLUSD.
- Viewport width approximately 402px.

**Steps:**

1. Load `/` with the mobile viewport (402px wide) and no wallet connected.
2. Observe the `StartHereCard`.

**Expected outcomes:**

- **Step 2:**
  - Eyebrow reads "Start here".
  - Headline reads "Get PLUSD".
  - Subtitle reads "Convert USDC 1:1".
  - No `"$X USDC"` caption is visible (disconnected variant has no balance sub-line).
  - `data-testid="plusd-in-usdc"` element is NOT present in the DOM.

---

## Story 5: Desktop layout — no USDC sub-line bleeds into desktop grid (regression)

**Pre-conditions:**
- Any wallet state.
- Viewport width 1440px.

**Steps:**

1. Load `/` in a 1440px-wide viewport with PLUSD balance seeded.
2. Observe the desktop grid `StartHereCard`.

**Expected outcomes:**

- **Step 2:**
  - The desktop grid `StartHereCard` shows the **disconnected** variant ("Start here /
    Get PLUSD / Convert USDC 1:1").
  - No `"$X USDC"` caption is visible in the desktop card.
