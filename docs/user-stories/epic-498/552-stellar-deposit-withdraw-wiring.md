# User story: #552 — Stellar deposit/withdraw page wiring

**Epic:** #498 — Stellar deposit/withdraw flow  
**Issue:** https://github.com/eq-lab/pipeline/issues/552  
**Status:** Initial

---

## Overview

These stories verify the end-to-end Stellar deposit and withdraw experience on
the `/deposit` page after the chain-aware adapter (`useDepositFlow`) and
`useStellarNetworkFeeEstimate` are wired in. EVM regression parity is also
covered.

Prerequisite mock keys for all Stellar stories unless stated otherwise:

```js
localStorage.setItem(
  "pipeline.mock.wallet.stellar.address",
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
);
localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
```

---

## Story 1 — Stellar deposit: wallet not connected

**Given** the user is on the Stellar tab (account dropdown) and NO Stellar
wallet is connected

**When** they navigate to `/deposit?direction=deposit`

**Then:**
- The yellow "Connect your wallet first" banner is visible
- The banner's **Connect** button is enabled
- No StepsCard (Approve/Confirm/Claim buttons) is visible
- No low-balance banner is visible

---

## Story 2 — Stellar deposit: below minimum balance

**Given** the user is on the Stellar tab with a connected wallet and mock keys:

```js
localStorage.setItem("pipeline.mock.wallet.stellar.balance.plusd", "500");
// 500 PLUSD — below the $1,000 minimum
```

**When** they navigate to `/deposit?direction=deposit`

**Then:**
- The "Add funds to your USDC balance" low-balance banner is visible
- The banner subtitle references "1,000 USDC" (minimum deposit)
- No StepsCard is rendered
- The amount input is visible but the step buttons are absent

---

## Story 3 — Stellar deposit: trustline step (Enable PLUSD)

**Given** the user has a sufficient balance and no PLUSD trustline:

```js
localStorage.setItem("pipeline.mock.wallet.stellar.balance.usdc", "5000");
// needsTrustline = true (no PLUSD trust mock set)
```

**When** they navigate to `/deposit?direction=deposit`

**Then:**
- Step 1 label reads **"Enable PLUSD"**
- Step 1 action button reads **"Approve"** and is enabled (amount > 0 entered) or disabled (no amount)
- Step 2 label reads **"Confirm USDC transfer"** and is disabled
- Step 3 label reads **"Claim your PLUSD"** and is disabled

**When** the user enters an amount ≥ $1,000 and clicks **Approve**

**Then:**
- Step 1 transitions to loading, then success (green check badge)
- Step 2 becomes the active step

---

## Story 4 — Stellar deposit: trustline already exists

**Given** the user has a sufficient balance and the PLUSD trustline is already
established:

```js
localStorage.setItem("pipeline.mock.wallet.stellar.balance.usdc", "5000");
localStorage.setItem(
  "pipeline.mock.wallet.stellar.depositManager.changeTrust",
  JSON.stringify({ hash: "trustlinehash" }),
);
// Trust is detected as pre-existing via on-chain read
```

**When** they navigate to `/deposit?direction=deposit`

**Then:**
- Step 1 shows the success badge ("Approve complete") immediately
- Step 2 (**Confirm**) is the active enabled step when an amount ≥ $1,000 is entered

---

## Story 5 — Stellar deposit: request submitted (PendingVerification)

**Given** step 1 is complete and the user submits a deposit request:

```js
localStorage.setItem(
  "pipeline.mock.wallet.stellar.depositManager.requestDeposit",
  JSON.stringify({ hash: "deposithash", requestId: "99" }),
);
```

**When** they enter an amount and click **Confirm**

**Then:**
- Step 2 transitions to loading spinner (aria-busy), then disabled
- A "Deposit submitted" toast appears
- The amount input is locked to the submitted amount
- Quick-amount chips are disabled

---

## Story 6 — Stellar deposit: claim ready

**Given** a PendingClaim deposit request and a ready Stellar voucher:

```js
localStorage.setItem(
  "pipeline.mock.api.GET./v1/requests",
  JSON.stringify({
    requests: [
      {
        type: "Deposit",
        amount: "10000000000", // 1000 PLUSD at 7 dp
        request_id: "99",
        status: "PendingClaim",
        created_at: new Date().toISOString(),
      },
    ],
  }),
);
localStorage.setItem(
  "pipeline.mock.api.GET./v1/deposits/99/voucher",
  JSON.stringify({
    request_id: "99",
    amount: "10000000000",
    user: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    signature: "a".repeat(128), // 128-hex ed25519 sig
  }),
);
```

**When** the user views the page

**Then:**
- Step 2 shows the success badge ("Confirm complete")
- Step 3 **Claim** button is enabled
- Clicking **Claim** triggers the Stellar claim transaction and shows a "Deposit complete" toast

---

## Story 7 — Stellar withdraw: enable USDC trustline (step 1)

**Given** the user is on the Stellar tab with sufficient PLUSD balance and no
USDC trustline:

```js
localStorage.setItem("pipeline.mock.wallet.stellar.balance.plusd", "200");
// No USDC trust established
```

**When** they navigate to `/deposit?direction=withdraw`

**Then:**
- Step 1 label reads **"Enable USDC"**
- Step 2 label reads **"Confirm PLUSD burn"**
- Step 3 label reads **"Claim your USDC"**

---

## Story 8 — Stellar withdraw: full flow

**Given** the USDC trustline exists, the user has 100 PLUSD:

```js
localStorage.setItem("pipeline.mock.wallet.stellar.balance.plusd", "100");
localStorage.setItem(
  "pipeline.mock.wallet.stellar.withdrawalQueue.requestWithdrawal",
  JSON.stringify({ hash: "wqhash", requestId: "77" }),
);
```

**When** the user enters `10` and clicks **Confirm**

**Then:**
- A withdrawal request is submitted
- The amount input locks to `10.0000000`
- Step 2 transitions to loading (spinner)
- A "Withdraw submitted" toast appears

---

## Story 9 — Network fee row shows XLM estimate

**Given** a Stellar mock fee key is set:

```js
localStorage.setItem(
  "pipeline.mock.wallet.stellar.networkFeeEstimate.deposit",
  JSON.stringify("~0.0052 XLM"),
);
```

**When** the user views the deposit page with Stellar selected

**Then:**
- The network fee row shows `~0.0052 XLM`
- No USD conversion is shown

---

## Story 10 — Switching from EVM to Stellar resets the amount input

**Given** the user is on the EVM deposit page with `2000` typed in the amount input

**When** they switch to the Stellar tab in the account dropdown

**Then:**
- The amount input is cleared to `""`
- The Stellar balance / step labels are shown immediately
- No stale EVM data remains visible

---

## Story 11 — EVM deposit regression

**Given** the user is on the EVM tab with a connected EVM wallet

**When** they navigate to `/deposit?direction=deposit` and follow the standard
approve → confirm → claim flow using EVM mock keys

**Then:**
- All three step labels read "Allow Pipeline to use USDC" / "Confirm USDC transfer" / "Claim your PLUSD"
- The approve mock key (`pipeline.mock.wallet.allowance.*`) and request mock key
  (`pipeline.mock.wallet.contract.depositManager.requestDeposit`) behave identically to
  before this issue
- No Stellar UI elements leak into the EVM view

---

## Story 12 — EVM withdraw regression

**Given** the user is on the EVM tab with a connected EVM wallet

**When** they navigate to `/deposit?direction=withdraw` with PLUSD allowance set

**Then:**
- Step labels read "Allow Pipeline to use PLUSD" / "Confirm PLUSD burn" / "Claim your USDC"
- Quick-amount chips 25% / 50% / 75% / Max work as before
