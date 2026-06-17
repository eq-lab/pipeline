# User story: #551 — Stellar withdraw hooks

**Epic:** #498 — Stellar deposit/withdraw flow  
**Issue:** https://github.com/eq-lab/pipeline/issues/551  
**Status:** Initial

---

## Overview

These stories verify that the Stellar/Soroban withdrawal hooks expose the correct
interface and behave correctly in mock mode. Full end-to-end stories (UI wiring)
are covered by #553 once the withdraw page is built.

---

## Story 1 — `useStellarRequestWithdrawal` mock path succeeds

**Given** the user has set the mock key:
```js
localStorage.setItem(
  "pipeline.mock.wallet.stellar.withdrawalQueue.requestWithdrawal",
  JSON.stringify({ hash: "mockhash123", requestId: "42" })
);
localStorage.setItem("pipeline.mock.wallet.stellar.address", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
```

**When** a component calls `write(10_000_000n)` on `useStellarRequestWithdrawal()`

**Then**:
- `isPending` transitions `false → true → false`
- `isSuccess` becomes `true`
- `data.hash` equals `"mockhash123"`
- `data.requestId` equals `42n`
- No RPC or signing calls are made

---

## Story 2 — `useStellarRequestWithdrawal` in-flight recovery persists to localStorage

**Given** the mock key above is set

**When** `write(10_000_000n)` completes successfully

**Then**:
- `localStorage.getItem("pipeline.stellar.withdrawal.inflight.<G…>")` returns a
  JSON entry with `requestId: "42"`, `amount: "10000000"`, and a `createdAt` timestamp
- The entry is scoped to the connected address (another address's entry is unaffected)

---

## Story 3 — `useStellarClaimWithdrawal` mock path succeeds

**Given** the mock key:
```js
localStorage.setItem(
  "pipeline.mock.wallet.stellar.withdrawalQueue.claimWithdrawal",
  JSON.stringify({ hash: "claimhash456" })
);
```

**When** a component calls `write(42n, new Uint8Array(64).fill(0xab))` on
`useStellarClaimWithdrawal()`

**Then**:
- `isSuccess` becomes `true`
- `data.hash` equals `"claimhash456"`
- The in-flight localStorage entry for the connected address is removed

---

## Story 4 — `useStellarClaimWithdrawal` rejects short signature

**Given** no mock key is set

**When** a component calls `write(42n, new Uint8Array(32))` (32 bytes, not 64)

**Then**:
- `error.message` contains `"must be 64 bytes"`
- `isPending` remains `false`

---

## Story 5 — `useStellarWithdrawalVoucher` fetches with `chain_id=99000001`

**Given** the mock key:
```js
localStorage.setItem(
  "pipeline.mock.api.GET./v1/withdrawals/42/voucher",
  JSON.stringify({
    request_id: "42",
    amount: "10000000",
    user: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    signature: "ab".repeat(64),
  })
);
localStorage.setItem("pipeline.mock.wallet.stellar.address", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
```

**When** a component renders `useStellarWithdrawalVoucher("42")`

**Then**:
- `status` transitions to `"ready"`
- `data.signature` is a 128-char hex string
- `signatureBytes` is a `Uint8Array` of length 64
- The real HTTP call (when not mocked) would include `chain_id=99000001` in the URL

---

## Story 6 — `useStellarChangeTrustUsdc` mock path succeeds

**Given** the mock key:
```js
localStorage.setItem(
  "pipeline.mock.wallet.stellar.changeTrust",
  JSON.stringify({ hash: "trusthash789" })
);
```

**When** a component calls `submit()` on `useStellarChangeTrustUsdc()`

**Then**:
- `isSuccess` becomes `true`
- `data.hash` equals `"trusthash789"`
- No Horizon call is made

---

## Story 7 — Hooks are idle when contract is unconfigured

**Given** `VITE_STELLAR_WITHDRAWAL_QUEUE_ID` is not set (empty string)
and no mock keys are set

**When** a component calls `write(...)` on `useStellarRequestWithdrawal()`

**Then**:
- `error.message` matches `"WithdrawalQueue not configured"`
- `isPending` remains `false`

---

## Acceptance for full E2E (manual, testnet)

On testnet with a funded account holding PLUSD:

1. Call `useStellarRequestWithdrawal().write(amount)` → poll `useStellarWithdrawalRequest(requestId)` → `request.claimed === false`
2. Fetch `useStellarWithdrawalVoucher(requestId)` → `status === "ready"` → `signatureBytes` is 64 bytes
3. If no USDC trustline: call `useStellarChangeTrustUsdc().submit()` → wait for success
4. Call `useStellarClaimWithdrawal().write(requestId, signatureBytes)` → success
5. USDC balance increases, PLUSD balance decreases on-chain
