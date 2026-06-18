# User story: #604 — Stellar dual PLUSD + USDC trustline Enable button

**Epic:** #498 — Stellar deposit/withdraw flow
**Issue:** https://github.com/eq-lab/pipeline/issues/604
**Status:** Initial

---

## Overview

These stories verify that the Stellar deposit/withdraw page (`/deposit`) shows
**both** PLUSD and USDC trustline statuses with per-asset "Enable" buttons,
regardless of direction. Both trustlines must be enabled before the Confirm
button is reachable.

Prerequisite mock keys for all Stellar stories unless stated otherwise:

```js
localStorage.setItem(
  "pipeline.mock.wallet.stellar.address",
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
);
localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
// Contract addresses (required for needsTrustline derivation)
localStorage.setItem(
  "pipeline.mock.wallet.stellar.contract.usdc",
  "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7",
);
localStorage.setItem(
  "pipeline.mock.wallet.stellar.contract.plusd",
  "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C8",
);
// USDC deposit balance
localStorage.setItem("pipeline.mock.wallet.stellar.balance.usdc", "1000");
```

SAC balance mock keys (raw at 7 decimal places):

- `pipeline.mock.wallet.stellar.balance.sac.plusd` — drives `hasTrustline` for
  PLUSD (any value > "0" means trustline exists)
- `pipeline.mock.wallet.stellar.balance.sac.usdc` — drives `hasTrustline` for
  USDC

---

## Story 1 — Both trustlines missing (deposit direction)

**Given** the user is on the Stellar deposit page (`direction=deposit`)  
**And** neither PLUSD nor USDC SAC balances are set (or both are "0")

**When** the page renders

**Then:**

- A 4-step StepsCard is visible with steps: "Enable PLUSD", "Enable USDC",
  "Confirm deposit", "Claim your PLUSD"
- Both "Enable PLUSD" and "Enable USDC" buttons are enabled and clickable
- The Confirm button (step 3) is disabled

---

## Story 2 — Both trustlines missing (withdraw direction)

**Given** the user is on the Stellar withdraw page (`direction=withdraw`)  
**And** neither PLUSD nor USDC SAC balances are set

**When** the page renders

**Then:**

- A 4-step StepsCard is visible with steps: "Enable PLUSD", "Enable USDC",
  "Confirm PLUSD burn", "Claim your USDC"
- Both "Enable PLUSD" and "Enable USDC" buttons are enabled
- The Confirm button (step 3) is disabled

---

## Story 3 — Only PLUSD trustline missing

**Given** the Stellar deposit page is open  
**And** `pipeline.mock.wallet.stellar.balance.sac.usdc` = `"10000000000"` (USDC
enabled)  
**And** `pipeline.mock.wallet.stellar.balance.sac.plusd` is unset or "0"

**When** the page renders

**Then:**

- Step 1 ("Enable PLUSD") shows an active "Enable" button
- Step 2 ("Enable USDC") shows a success / complete state (no "Enable" button)
- The Confirm button (step 3) is still disabled (PLUSD trustline still missing)

---

## Story 4 — Only USDC trustline missing

**Given** the Stellar deposit page is open  
**And** `pipeline.mock.wallet.stellar.balance.sac.plusd` = `"10000000000"`
(PLUSD enabled)  
**And** `pipeline.mock.wallet.stellar.balance.sac.usdc` is unset or "0"

**When** the page renders

**Then:**

- Step 1 ("Enable PLUSD") shows a success / complete state (no "Enable" button)
- Step 2 ("Enable USDC") shows an active "Enable" button
- The Confirm button (step 3) is still disabled

---

## Story 5 — Both trustlines present (deposit direction)

**Given** the Stellar deposit page is open  
**And** both `balance.sac.plusd` and `balance.sac.usdc` are set to
`"10000000000"`  
**And** the entered amount meets the minimum deposit

**When** the page renders

**Then:**

- Step 1 ("Enable PLUSD") shows success state; no "Enable" button
- Step 2 ("Enable USDC") shows success state; no "Enable" button
- The Confirm button (step 3) is **enabled**

---

## Story 6 — Both trustlines present (withdraw direction)

**Given** the Stellar withdraw page is open  
**And** both `balance.sac.plusd` and `balance.sac.usdc` are set to
`"10000000000"`  
**And** the entered amount meets the minimum deposit

**When** the page renders

**Then:**

- Step 1 ("Enable PLUSD") shows success state; no "Enable" button
- Step 2 ("Enable USDC") shows success state; no "Enable" button
- The Confirm button (step 3) is **enabled**

---

## Story 7 — Enable button triggers trustline submission

**Given** a Stellar trustline is missing (e.g. PLUSD)  
**And** `pipeline.mock.wallet.stellar.changeTrust` is set to a mock tx hash

**When** the user clicks the "Enable PLUSD" button

**Then:**

- The button enters a loading/spinner state while the transaction is in flight
- On success, the step row transitions to a success state and the "Enable"
  button disappears

---

## Story 8 — EVM regression: no trustline block rendered

**Given** the user is on the EVM deposit page (EVM wallet connected)

**When** the page renders

**Then:**

- The trustline step rows (Enable PLUSD / Enable USDC) are **not** visible
- The standard 3-step StepsCard (Approve / Confirm / Claim) is visible
- EVM step 1 (Approve) behavior is unchanged
