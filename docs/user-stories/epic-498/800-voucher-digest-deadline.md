# User story: #800 — Voucher digest drift: claim_request now takes deadline

**Epic:** #498 — Stellar deposit/withdraw flow
**Issue:** https://github.com/eq-lab/pipeline/issues/800
**Status:** Initial

---

## Overview

These stories verify that on the Stellar deposit and withdraw flows, the
**Claim** step correctly threads the voucher's `deadline` field into the
on-chain `claim_request(request_id, verifier_signature, deadline)` call — the
live DepositManager / WithdrawalQueue contracts (`VITE_STELLAR_DEPOSIT_MANAGER_ID`
/ `VITE_STELLAR_WITHDRAWAL_QUEUE_ID`) require `deadline` as a third argument.
The signed voucher digest is unchanged (it already includes `deadline` as its
4th field); only the claim call site is affected.

Prerequisite mock keys (Stellar wallet connected, both trustlines present; see
#604 for the full set):

```js
localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.stellar.balance.sac.plusd", "10000000000");
localStorage.setItem("pipeline.mock.wallet.stellar.balance.sac.usdc", "10000000000");
localStorage.setItem("pipeline.mock.wallet.stellar.balance.usdc", "5000");
```

---

## Story 1 — Deposit Claim passes deadline to claim_request

**Given** the Stellar deposit page is open with a connected wallet
**And** the API returns a `Deposit` request with status `PendingClaim`
**And** the deposit voucher (`GET /v1/deposits/{id}/voucher`) is `ready` and its
response includes both `signature` and `deadline` (u64 seconds, e.g.
`"1800000000"`)

**When** the user clicks **Claim**

**Then:**

- The built `claim_request` Soroban operation carries three arguments:
  `request_id`, the 64-byte verifier signature, and `deadline` encoded as a
  `u64` scVal (`nativeToScVal(deadline, { type: "u64" })`)
- The claim transaction is signed and submitted as before; on success the step
  shows the success state

---

## Story 2 — Withdraw Claim passes deadline to claim_request

**Given** the Stellar withdraw page is open with a connected wallet
**And** the API returns a `Withdraw` request with status `PendingClaim`
**And** the withdrawal voucher (`GET /v1/withdrawals/{id}/voucher`) is `ready`
and its response includes both `signature` and `deadline`

**When** the user clicks **Claim**

**Then:**

- The built `claim_request` Soroban operation on the WithdrawalQueue contract
  carries the same three arguments (`request_id`, verifier signature,
  `deadline` as `u64` scVal)
- The claim transaction proceeds identically to the deposit case

---

## Story 3 — Missing deadline guards the claim (no bogus 0 sent)

**Given** a Stellar deposit or withdraw request is `PendingClaim`
**And** the voucher response is `ready` but its `deadline` field is missing or
`undefined` (e.g. a stale/older API response)

**When** the user would otherwise click **Claim**

**Then:**

- The claim `write()` call is **not** invoked — the action is a no-op rather
  than sending a fabricated `deadline: 0`
- No error is thrown; the button may still be visually enabled (button
  enablement is gated on voucher `status === "ready"`, independent of this
  guard), but the click has no effect until `deadline` is present

---

## Notes

- Regression coverage:
  - `packages/shared/src/stellar_voucher.rs` — `golden_digest_fixture`
    (re-enabled; verifies the signed 4-field digest byte-for-byte against the
    live DepositManager `CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX`).
  - `packages/frontend/src/wallet/stellar/contracts/depositManager.test.ts` —
    asserts the third `claim_request` op arg is the `u64` deadline scVal.
  - `packages/frontend/src/wallet/stellar/useStellarDepositManager.test.tsx` /
    `useStellarWithdrawalQueue.test.tsx` — assert `deadline` threads from
    `write(...)` into `buildClaimRequest(...)`.
  - `packages/frontend/src/api/useStellarDepositVoucher.test.tsx` /
    `useStellarWithdrawalVoucher.test.tsx` — assert `deadline` passes through
    the voucher response unchanged.
- No change to the signed digest or to backend signing — `deadline` was
  already part of both; only the frontend claim call site needed to pass it
  as an explicit contract argument.
- Known pre-existing gap (not fixed by this issue, logged as BUG-7 in
  `docs/exec-plans/known-bugs.md`): `-deposit.test.tsx`'s Stellar voucher
  mocks nest `signatureBytes` under `data` instead of at the hook-result top
  level, so no test in that file currently clicks the Stellar Claim button
  end-to-end.
