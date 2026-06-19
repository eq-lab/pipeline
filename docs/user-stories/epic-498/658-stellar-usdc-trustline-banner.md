# User story: #658 — Stellar deposit "Add USDC trustline" banner

**Epic:** #498 — Stellar deposit/withdraw flow
**Issue:** https://github.com/eq-lab/pipeline/issues/658
**Status:** Initial

---

## Overview

These stories verify that the Stellar deposit page (`/deposit?direction=deposit`)
shows an **"Add USDC trustline"** banner — instead of the "Add funds to your USDC
balance" low-balance banner — when the connected account has **no USDC trustline
and no USDC balance**. The banner's action establishes the USDC trustline.

Prerequisite mock keys for all stories (Stellar wallet connected, deposit
direction):

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
```

Driving mock keys:

- `pipeline.mock.wallet.stellar.balance.usdc` — USDC deposit balance; `"0"` →
  `hasBalance` is `false`
- `pipeline.mock.wallet.stellar.balance.sac.usdc` — `"0"` → USDC trustline
  missing (`needsTrustline`)

---

## Story 1 — No USDC trustline and no balance → "Add USDC trustline" banner

**Given** the Stellar deposit page is open (`direction=deposit`)
**And** `balance.usdc` = `"0"` (no USDC balance)
**And** `balance.sac.usdc` = `"0"` (no USDC trustline)

**When** the page renders

**Then:**

- A yellow banner titled **"Add USDC trustline"** is visible with an **"Add
  trustline"** button
- The "Add funds to your USDC balance" low-balance banner is **not** shown
- The 4-step StepsCard ("Enable PLUSD" / "Enable USDC" / …) is **not** shown

---

## Story 2 — USDC balance present → steps card, not the trustline banner

**Given** the Stellar deposit page is open
**And** `balance.usdc` = `"5000"` (deposit balance present, `hasBalance` true)
**And** `balance.sac.usdc` = `"0"` (USDC trustline still missing)

**When** the page renders

**Then:**

- The "Add USDC trustline" banner is **not** shown
- The 4-step StepsCard is shown, including the "Enable USDC" step

> This preserves the dual-enable steps-card behavior from #604 — the new banner
> only replaces the low-balance banner, never the steps card.

---

## Story 3 — "Add trustline" submits the USDC changeTrust

**Given** Story 1's no-trustline / no-balance state
**And** `pipeline.mock.wallet.stellar.changeTrust` is set to a mock tx hash

**When** the user clicks **"Add trustline"**

**Then:**

- The USDC `changeTrust` transaction is submitted (button shows "Adding…" while
  in flight)
- The page remains mounted and functional; on success the account gains a USDC
  trustline and the flow advances to the "Add funds" / steps state

---

## Story 4 — EVM regression: banner never shown

**Given** the user is on the EVM deposit page (EVM wallet connected)

**When** the page renders

**Then:**

- The "Add USDC trustline" banner is **not** rendered (trustlines are a
  Stellar-only concept)
