# User stories — Issue #639: 'Before you continue' gate precedes ConnectWalletModal

Part of epic #556 (Connect page). Stacked on #638.

## Context

The "Before you continue" jurisdiction-attestation gate (`FirstConnectionModal`) must
appear **before** the `ConnectWalletModal` (network tabs + wallet picker) when the
user has not yet acknowledged the terms. Only after the user clicks Continue does the
wallet picker open.

If terms were already acknowledged (`pipeline.wallet.termsAcknowledged` set), the
gate is skipped and the wallet picker opens immediately.

---

## Story 1 — Gate-first flow (terms not yet acknowledged)

**Precondition:** `pipeline.wallet.termsAcknowledged` is absent from localStorage;
user is not connected.

**Steps:**

1. Open the app and navigate to the home page.
2. Click **Connect Wallet** in the TopBar.

**Expected:**

- The "Before you continue" gate (`FirstConnectionModal`) appears immediately.
- The `ConnectWalletModal` (with EVM / Soroban tabs) is NOT visible yet.
- After clicking **Continue** on the gate, the `ConnectWalletModal` opens.
- After selecting a wallet and connecting, the gate does NOT reappear.

---

## Story 2 — Gate skip when terms already acknowledged

**Precondition:** `pipeline.wallet.termsAcknowledged` is `"true"` in localStorage;
user is not connected.

**Steps:**

1. Open the app.
2. Click **Connect Wallet** in the TopBar.

**Expected:**

- The "Before you continue" gate does NOT appear.
- The `ConnectWalletModal` (EVM / Soroban tabs) opens immediately.

---

## Story 3 — Gate-first from every CTA entry point

**Precondition:** `pipeline.wallet.termsAcknowledged` is absent.

**Steps:**

1. Click **Connect Wallet** from each of the following CTAs in turn (clearing
   localStorage between each):
   - TopBar Connect Wallet button
   - Home promo card Connect Wallet button
   - Deposit page wallet-disconnected banner Connect button
   - Stake page wallet-disconnected banner Connect button
   - Mobile nav menu Connect Wallet entry

**Expected:**

- Every CTA shows the gate first, then the `ConnectWalletModal` after Continue.
- Ordering is consistent across all entry points.

---

## Story 4 — Dismissing the gate does not open ConnectWalletModal

**Precondition:** `pipeline.wallet.termsAcknowledged` is absent.

**Steps:**

1. Click **Connect Wallet** in the TopBar.
2. When the gate appears, click the dismiss/close button.

**Expected:**

- The gate closes.
- The `ConnectWalletModal` does NOT open.
- Clicking Connect Wallet again shows the gate again (flag not written).

---

## Story 5 — No double gate after wallet selection

**Precondition:** `pipeline.wallet.termsAcknowledged` is absent.

**Steps:**

1. Click **Connect Wallet** → gate appears → click **Continue**.
2. In the `ConnectWalletModal`, click a specific wallet (e.g. MetaMask on the EVM tab).

**Expected:**

- The gate does NOT reappear after wallet selection.
- The wallet connect flow proceeds directly.
