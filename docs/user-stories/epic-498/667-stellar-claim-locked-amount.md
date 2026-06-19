# User story: #667 — Stellar deposit locked amount comes from the API when Claim is active

**Epic:** #498 — Stellar deposit/withdraw flow
**Issue:** https://github.com/eq-lab/pipeline/issues/667
**Status:** Initial

---

## Overview

These stories verify that on the Stellar deposit page, once a deposit request is
confirmed and the **Claim** button is active (`PendingClaim`), the amount input
stays locked to the **deposited value from the API** — not 0 — even after the
client-side in-flight record has been cleared. This mirrors the EVM flow.

Stellar amounts from `/v1/requests` are the raw on-chain `i128` at **7 decimals**
(the indexer stores the value verbatim), matching the page's `SAC_DECIMALS`.

Prerequisite mock keys (Stellar wallet connected, both trustlines present; see
#604 for the full set):

```js
localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.stellar.balance.sac.plusd", "10000000000");
localStorage.setItem("pipeline.mock.wallet.stellar.balance.sac.usdc", "10000000000");
localStorage.setItem("pipeline.mock.wallet.stellar.balance.usdc", "5000");
```

---

## Story 1 — PendingClaim deposit → input shows the API amount

**Given** the Stellar deposit page is open with a connected wallet
**And** the API returns a `Deposit` request with status `PendingClaim` and
`amount` = `"20000000000"` (2000 USDC at 7 decimals)

**When** the page renders

**Then:**

- The amount input shows **`2000.00`** (the deposited value), not `0`
- The input is **disabled** (locked to the active request)

---

## Story 2 — No client-side in-flight record present

**Given** the same PendingClaim deposit request from the API
**And** no localStorage in-flight record exists (it was cleared on confirmation)

**When** the page renders

**Then:**

- The input still shows the deposited value from the API (e.g. `1000.00` for an
  `amount` of `"10000000000"`), never `0`

---

## Notes

- Regression coverage in `packages/frontend/src/routes/-deposit.test.tsx`
  ("Deposit page — Stellar locked amount on active request").
- The fix makes Stellar's `lockedAmountRaw` prefer the API active-request amount,
  falling back to the in-flight record — the same source EVM already uses.
