# User story: #672 — Stellar deposit Claim blocked while PLUSD trustline is unauthorized

**Epic:** #498 — Stellar deposit/withdraw flow
**Issue:** https://github.com/eq-lab/pipeline/issues/672
**Status:** Initial

---

## Overview

These stories verify that on the Stellar deposit page, the **Claim** button (step 4
in the four-step StepsCard) is **disabled** while the PLUSD trustline exists but has
not yet been authorized by the PLUSD issuer (`auth_required=true`). Clicking Claim
in that window would submit a `claim_request` mint that fails with
`Error(Contract, #11)` / "balance is deauthorized".

When the guard is active, the Claim step label changes from "Claim your PLUSD" to
**"Claim your PLUSD — awaiting authorization"** to communicate the reason for the
disabled state.

The guard is **deposit-only** — the withdraw Claim is unaffected.

Prerequisite mock keys (Stellar wallet connected, both trustlines present):

```js
localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.stellar.balance.sac.plusd", "10000000000");
localStorage.setItem("pipeline.mock.wallet.stellar.balance.sac.usdc", "10000000000");
localStorage.setItem("pipeline.mock.wallet.stellar.balance.usdc", "5000");
```

---

## Story 1 — Claim disabled when PLUSD trustline is unauthorized

**Given** the Stellar deposit page is open with a connected wallet
**And** both PLUSD and USDC trustlines exist (step 1 is complete)
**And** a deposit request is in `PendingClaim` state with a voucher ready
**And** the PLUSD trustline's `is_authorized` flag is `false` (not yet authorized by the issuer)

**When** the page renders

**Then:**

- The Claim button (step 4 action) is **disabled**
- The step 4 label reads **"Claim your PLUSD — awaiting authorization"**

---

## Story 2 — Claim enabled once PLUSD trustline is authorized

**Given** the same setup as Story 1
**And** the PLUSD trustline's `is_authorized` flag is `true` (issuer has authorized)

**When** the page renders

**Then:**

- The Claim button (step 4 action) is **enabled**
- The step 4 label reads **"Claim your PLUSD"** (normal label, no awaiting message)

---

## Story 3 — Withdraw Claim is unaffected

**Given** the Stellar withdraw page is open with a connected wallet
**And** a withdrawal request is in `PendingClaim` state with a voucher ready
**And** the PLUSD trustline's `is_authorized` flag is `false`

**When** the page renders

**Then:**

- The withdraw Claim button is **not** blocked by the PLUSD authorization state
- (The deposit-only guard does not apply to the withdraw path)

---

## Notes

- The `isAuthorized` flag is sourced from Horizon's `BalanceLineAsset.is_authorized`
  on the PLUSD balance line in `useStellarSacToken`.
- The gate lives in `useDepositFlow.ts` as `plusdTrustlineUnauthorized` feeding into
  `canStellarStep3Deposit`. The `deposit.tsx` UI layer needs no change since it already
  renders `flow.step3.label` and `flow.step3.disabled` from the hook.
- In mock mode (localStorage), `isAuthorized` defaults to `hasTrustline` (i.e., `mockRaw > 0n`)
  so dev/test flows are not newly blocked.
- Regression coverage in:
  - `packages/frontend/src/wallet/stellar/useStellarSacToken.test.tsx`
    ("trustline present, is_authorized: false/true" suites)
  - `packages/frontend/src/routes/-deposit.test.tsx`
    ("Deposit page — Stellar PLUSD unauthorized trustline guard" suite)
