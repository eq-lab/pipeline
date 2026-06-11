# User stories — #549 Stellar protocol contract foundation

Epic: #498 (Deposit/withdraw page)
Issue: [#549 [FE] [Stellar] Protocol contract foundation: addresses config, typed Soroban clients, SAC token support](https://github.com/eq-lab/pipeline/issues/549)

This issue is infrastructure/plumbing — no UI changes. Stories verify the plumbing
is wired correctly at the hook level (no page rendering required).

---

## Story 1 — Env short-circuit (unconfigured)

**Setup**: `VITE_STELLAR_DEPOSIT_MANAGER_ID` and `VITE_STELLAR_WITHDRAWAL_QUEUE_ID` are not
set (or set to empty strings).

**Action**: Load the app.

**Expected**:
- No RPC call is made to the Soroban endpoint for DepositManager or WithdrawalQueue.
- `depositManagerId` and `withdrawalQueueId` in `chain.ts` are empty strings.
- `useStellarDepositManagerAddresses` returns `{ addresses: undefined, isLoading: false, error: null }`.

---

## Story 2 — Contract IDs exposed from env (configured)

**Setup**: Set `VITE_STELLAR_DEPOSIT_MANAGER_ID=CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO`
and `VITE_STELLAR_WITHDRAWAL_QUEUE_ID=CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL`.

**Action**: Inspect `depositManagerId` and `withdrawalQueueId` exported from `chain.ts`.

**Expected**:
- `depositManagerId === "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO"`
- `withdrawalQueueId === "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL"`

---

## Story 3 — Address-derivation mock fast-path

**Setup**: App running. Set both mock keys in DevTools:
```js
localStorage.setItem("pipeline.mock.wallet.stellar.contract.usdc",
  "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7");
localStorage.setItem("pipeline.mock.wallet.stellar.contract.plusd",
  "CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN");
```

**Action**: Trigger `useStellarDepositManagerAddresses` (e.g. via a test component or
DevTools `__query` inspection).

**Expected**:
- Hook returns the mock contract IDs immediately.
- `addresses.usdcAsset.issuer` equals `"GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM"`.
- No Soroban RPC call is made.

---

## Story 4 — SAC token balance (7-decimal, not 6)

**Setup**: Connected Stellar wallet with a USDC balance under the protocol issuer
(`GC5SUAXM…`). Mock the balance via:
```js
localStorage.setItem("pipeline.mock.wallet.stellar.balance.sac.usdc", "10000000");
```
(= 1 USDC at 7 decimals)

**Action**: Read `useStellarSacToken({ assetCode: "USDC", assetIssuer: "GC5SUAXM…", contractId: "CCWX3…" })`.

**Expected**:
- `balance === "1.0000000"` (7 decimal places, not `"1.000000"` which would be 6).
- `hasTrustline === true`.
- `decimals === 7`.
- No Horizon call made (mock path).

---

## Story 5 — SAC token: wrong issuer ignored

**Setup**: Horizon account has USDC from a different issuer (e.g. Circle testnet
`GBBD47…`). Protocol issuer is `GC5SUAXM…`.

**Action**: Read `useStellarSacToken` with `assetIssuer = "GC5SUAXM…"`.

**Expected**:
- `balance === "0"`.
- `hasTrustline === false`.
- No error.
- The hook does NOT pick up the Circle USDC balance.

---

## Story 6 — SAC token: no trustline

**Setup**: Connected Stellar wallet with no USDC trustline established.

**Action**: Read `useStellarSacToken` for protocol USDC.

**Expected**:
- `balance === "0"`.
- `hasTrustline === false`.
- `error === null`.

---

## Story 7 — Contract client: empty-env short-circuit

**Setup**: `VITE_STELLAR_DEPOSIT_MANAGER_ID=""`.

**Action**: Call `createDepositManagerClient("")`.

**Expected**:
- Returns `null` (no client constructed, no exception thrown by the factory).

---

## Story 8 — Contract client: read views decode correctly

**Setup**: Mock Soroban RPC to return simulated results for `asset()`, `share()`,
`paused()`, `get_request(42)`.

**Action**: Construct a `DepositManagerClient(contractId)` and call each view.

**Expected**:
- `asset()` returns the USDC SAC contract ID string.
- `share()` returns the PLUSD SAC contract ID string.
- `paused()` returns `false`.
- `getRequest(42n)` returns an object `{ amount: bigint, claimed: boolean, timestamp: bigint, user: string }`.

---

## Story 9 — Write builder: invalid signature length rejected

**Setup**: Construct a `DepositManagerClient`.

**Action**: Call `buildClaimRequest(1n, new Uint8Array(32), account)` (signature is 32 bytes, not 64).

**Expected**:
- Promise rejects with an error mentioning `"64 bytes"`.
