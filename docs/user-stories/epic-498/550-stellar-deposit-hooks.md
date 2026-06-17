# User story: #550 — Stellar deposit hooks

**Epic:** #498 — Stellar deposit/withdraw flow  
**Issue:** https://github.com/eq-lab/pipeline/issues/550  
**Status:** Initial

---

## Overview

These stories verify that the Stellar/Soroban deposit hooks expose the correct
interface and behave correctly in mock mode. Full end-to-end stories (UI wiring)
are covered by #552 once the deposit page is built.

---

## Story 1 — `useStellarRequestDeposit` mock path succeeds

**Given** the user has set the mock key:

```js
localStorage.setItem(
  "pipeline.mock.wallet.stellar.depositManager.requestDeposit",
  JSON.stringify({ hash: "mockhash123", requestId: "42" }),
);
localStorage.setItem(
  "pipeline.mock.wallet.stellar.address",
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
);
localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
```

**When** a component calls `write(10_000_000n)` on `useStellarRequestDeposit()`

**Then:**

- `isPending` is briefly `true` then clears
- `isSuccess` becomes `true`
- `data.hash` is `"mockhash123"`
- `data.requestId` is `42n`
- An entry is written to `localStorage` under `pipeline.stellar.deposit.inflight.<G…>`
- No Soroban RPC call is made

---

## Story 2 — `useStellarClaim` mock path succeeds

**Given** the user has set the mock key:

```js
localStorage.setItem(
  "pipeline.mock.wallet.stellar.depositManager.claim",
  JSON.stringify({ hash: "claimhash456" }),
);
```

and a prior `request_deposit` produced `requestId = 42n` and signatureBytes is a
64-byte `Uint8Array`

**When** a component calls `write(42n, signatureBytes)` on `useStellarClaim()`

**Then:**

- `isSuccess` becomes `true`
- `data.hash` is `"claimhash456"`
- The in-flight `localStorage` entry for this address is cleared

---

## Story 3 — `useStellarClaim` rejects invalid signature length

**Given** the wallet is connected

**When** `write(42n, new Uint8Array(32))` is called (32 bytes, not 64)

**Then:**

- `error.message` contains `"64 bytes"`
- `isPending` remains `false`
- `isSuccess` remains `false`

---

## Story 4 — Unconfigured guard

**Given** `VITE_STELLAR_DEPOSIT_MANAGER_ID` is empty (not set)

**When** `write(10_000_000n)` is called on `useStellarRequestDeposit()`

**Then:**

- `error.message` contains `"DepositManager not configured"`
- No RPC call is made

---

## Story 5 — `useStellarDepositVoucher` mock path

**Given** the user has set the mock key:

```js
localStorage.setItem(
  "pipeline.mock.api.GET./v1/deposits/42/voucher",
  JSON.stringify({
    request_id: "42",
    amount: "10000000",
    user: "GBBD47...",
    signature: `0x${"a".repeat(128)}`, // 64 bytes hex-encoded
  }),
);
```

**When** `useStellarDepositVoucher("42")` is called with a connected Stellar wallet

**Then:**

- `status` is `"ready"`
- `data.signature` is the 0x-prefixed hex string
- `signatureBytes` is a `Uint8Array` of length 64
- All 64 bytes match the hex decode of the signature
- The real API URL includes `chain_id=99000001` (or the configured
  `VITE_STELLAR_CHAIN_ID`) so the backend dispatches to the Stellar signer

---

## Story 6 — `useStellarDepositVoucher` idle when disconnected

**Given** no Stellar wallet is connected (`isConnected = false`)

**When** `useStellarDepositVoucher("42")` is called

**Then:**

- `status` is `"idle"`
- `data` is `undefined`
- `signatureBytes` is `undefined`
- No API call is made

---

## Story 7 — `useChangeTrust` mock path succeeds

**Given** the user has set:

```js
localStorage.setItem(
  "pipeline.mock.wallet.stellar.changeTrust",
  JSON.stringify({ hash: "trusthash789" }),
);
```

**When** `submit()` is called on `useChangeTrust()`

**Then:**

- `isSuccess` becomes `true`
- `data.hash` is `"trusthash789"`
- `needsTrustline` is exposed so the UI can decide whether to render this step
- No Horizon call is made

---

## Story 8 — In-flight recovery

**Given** a successful `request_deposit` has written:

```
pipeline.stellar.deposit.inflight.GBBD47… → { requestId: "42", amount: "10000000", createdAt: ... }
```

**When** `readInflightDeposit("GBBD47…")` is called

**Then** the returned object has `requestId: "42"` and `amount: "10000000"`

**When** `clearInflightDeposit("GBBD47…")` is called

**Then** `readInflightDeposit("GBBD47…")` returns `undefined`

---

## Manual acceptance (testnet — requires funded account)

Prerequisites:

1. Set `VITE_STELLAR_CHAIN_ID=99000001` and `VITE_STELLAR_DEPOSIT_MANAGER_ID=CARFA2QETOZVKHSG4BCEEXMJHTYR2Z75VR7WQNX4MWZ33RQMKRKATIVI` in `.env`
2. Fund a testnet account with XLM and USDC via Friendbot / the SAC faucet
3. Connect a Stellar wallet (Freighter recommended)

Steps:

1. Call `useStellarRequestDeposit().write(10_000_000n)` (1 USDC at 7 decimals)
2. Verify `isSuccess = true` and `data.requestId` is a bigint
3. Call `useStellarDepositRequest(data.requestId)` and verify `request.claimed = false`
4. Call `useStellarDepositVoucher(data.requestId.toString())` and wait for `status = "ready"`
5. Decode `signatureBytes` from `data.signature` (hex → Uint8Array, 64 bytes)
6. Call `useStellarClaim().write(data.requestId, signatureBytes)`
7. Verify `isSuccess = true`
8. Call `useStellarDepositRequest(data.requestId)` and verify `request.claimed = true`
9. Verify PLUSD balance increased by the deposited amount (via `useStellarSacToken` or Horizon)
