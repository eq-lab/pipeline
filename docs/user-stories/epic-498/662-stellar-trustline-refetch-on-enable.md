# User story: #662 — Stellar trustline status refreshes immediately after Enable

**Epic:** #498 — Stellar deposit/withdraw flow
**Issue:** https://github.com/eq-lab/pipeline/issues/662
**Status:** Initial

---

## Overview

These stories verify that after a successful trustline `changeTrust`, the
trustline status refetches immediately — so the "Enable" button / "Add USDC
trustline" banner updates within a second or two of the success toast, instead
of waiting for the 30s `useStellarSacToken` poll.

Prerequisite mock keys (Stellar wallet connected; see #604 for the full set):

```js
localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
// A trustline is missing (SAC balance "0") so an Enable affordance is shown.
localStorage.setItem("pipeline.mock.wallet.stellar.balance.sac.plusd", "0");
// Provide a mock changeTrust tx hash so submit() settles successfully.
localStorage.setItem(
  "pipeline.mock.wallet.stellar.changeTrust",
  JSON.stringify({ hash: "0xtrusthash" }),
);
```

---

## Story 1 — PLUSD trustline refetches after Enable

**Given** the Stellar deposit page is open and the PLUSD trustline is missing
**When** the user clicks "Enable PLUSD" and the transaction succeeds

**Then:**

- The PLUSD trustline status is refetched immediately on success (no waiting for
  the 30s poll)
- The "Enable" affordance flips to the complete/success state promptly after the
  "Enabled" toast

---

## Story 2 — USDC trustline refetches after Enable

**Given** a Stellar flow where the USDC trustline is missing — the withdraw
"Enable USDC" step or the deposit "Add USDC trustline" banner (#658)
**When** the user enables the USDC trustline and the transaction succeeds

**Then:**

- The USDC trustline status is refetched immediately on success
- The "Enable" button / "Add USDC trustline" banner clears promptly rather than
  ~30–60s later

---

## Notes

- Regression coverage: `useChangeTrust` (PLUSD) and `useStellarChangeTrustUsdc`
  (USDC) call the `useStellarSacToken` `refetchBalance()` on success — asserted
  in the hook tests (`useStellarDepositManager.test.tsx`,
  `useStellarWithdrawalQueue.test.tsx`).
- The 30s `refetchInterval` poll remains as the fallback for any Horizon
  propagation lag.
