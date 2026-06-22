# API module

All REST API calls in the application go through this module. No other file may
call `fetch` directly — the ESLint `no-restricted-globals` rule enforces this
boundary.

## Public API

```ts
import {
  apiFetch,
  useRequests,
  useDepositVoucher,
  useWithdrawalVoucher,
  useStats,
  formatApy,
} from "@/api";

import type {
  RequestItem,
  RequestType,
  RequestStatus,
  RequestsResponse,
  UseRequestsResult,
  VoucherResponse,
  VoucherStatus,
  UseDepositVoucherResult,
  WithdrawalVoucherResponse,
  WithdrawalVoucherStatus,
  UseWithdrawalVoucherResult,
  VaultStatsItem,
  StatsResponse,
  UseStatsResult,
} from "@/api";
```

### `apiFetch<T>(path, init?)`

Low-level fetch wrapper. Resolves the URL as `${ENV.API_BASE_URL}${path}`,
consults the localStorage mock layer before issuing a real request, and throws
on non-2xx responses.

```ts
const data = await apiFetch<MyType>("/v1/some-endpoint");
```

### `useRequests()`

React Query hook that fetches the connected wallet's full request history.

```ts
const { data, isLoading, error, refetch } = useRequests();
// data?.requests — RequestItem[]
```

Disabled when the wallet is disconnected. Automatically refetches when any
`pipeline.mock.*` key changes (same-tab DevTools writes).

**Chain-aware (issue #552).** When `useWalletView().kind === "stellar"`, the hook
selects the Stellar G… address (`useStellarWallet().address`) instead of the EVM
`0x…` address. The query key changes with the address so EVM and Stellar histories
never mix in the React Query cache. No `chain_id` parameter is added — the backend
dispatch is handled by the voucher hooks.

### Types

| Type               | Description                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `RequestItem`      | A single transaction record from `GET /v1/requests`                              |
| `RequestType`      | `"Deposit" \| "Withdraw" \| "Stake" \| "Unstake"`                                |
| `RequestStatus`    | `"PendingVerification" \| "PendingClaim" \| "Completed" \| "VerificationFailed"` |
| `RequestsResponse` | Shape of the full API response: `{ requests: RequestItem[] }`                    |

---

### `useDepositVoucher(requestId?)`

React Query hook that fetches a deposit voucher (verifier signature) from
`GET /v1/deposits/{request_id}/voucher?wallet=<address>`.

```ts
const { data, status, error, refetch } = useDepositVoucher(requestId);
// status: "idle" | "pending" | "ready" | "failed"
// data?.signature — passed to useClaim.write()
```

Disabled when `requestId` is `undefined` or the wallet is disconnected. Polls
every 3 s until the signature is present; retries up to 20 times on retriable
errors (404/403). Reactive to `pipeline.mock.api.*` localStorage key changes.

### `useStellarDepositVoucher(requestId?)`

Stellar variant of `useDepositVoucher`. It uses the connected Stellar wallet
address and includes `VITE_STELLAR_CHAIN_ID` so the API dispatches to the
Stellar ed25519 voucher signer:
`GET /v1/deposits/{request_id}/voucher?wallet=<G...>&chain_id=<id>`.

```ts
const { data, signatureBytes, status, error, refetch } =
  useStellarDepositVoucher(requestId);
// signatureBytes — 64-byte ed25519 signature for useStellarClaim.write()
```

---

### `useWithdrawalVoucher(requestId?)`

React Query hook that fetches a withdrawal voucher (verifier signature) from
`GET /v1/withdrawals/{request_id}/voucher?wallet=<address>`.

```ts
const { data, status, error, refetch } = useWithdrawalVoucher(requestId);
// status: "idle" | "pending" | "ready" | "failed"
// data?.signature — passed to useClaimWithdrawal.write()
```

Disabled when `requestId` is `undefined` or the wallet is disconnected. Same
polling / retry semantics as `useDepositVoucher`. The EIP-712 domain for
withdrawal vouchers differs from deposit vouchers, but the `signature` field
shape is identical (`0x…` bytes string).

Reactive to `pipeline.mock.api.*` localStorage key changes.

---

### `useStats()`

React Query hook that fetches protocol vault statistics from `GET /v1/stats`.

```ts
const { data, isLoading, error } = useStats();
// data?.vaults[0]?.apy — APY as a decimal fraction string, or null
```

Always enabled — no wallet connection required. Use `formatApy(apy)` to convert
the raw fraction to a display string (e.g. `"0.0842"` → `"8.42%"`, null → `"—"`).

### `formatApy(apy)`

Formats an APY decimal fraction string as a percentage string.

```ts
formatApy("0.0842"); // → "8.42%"
formatApy(null); // → "—"
formatApy(undefined); // → "—"
```

### `usePnl()`

React Query hook that fetches staking PnL for the connected wallet from
`GET /v1/pnl`.

```ts
const { data, isLoading, error } = usePnl();
// data?.avg_apy — APY as a decimal fraction string, or null
// data?.total_unrealized_pnl — raw asset-unit decimal string
```

The hook follows `useWalletView().kind`, uses the active wallet address, and
passes the matching `chain_id` (`ENV.EVM_CHAIN_ID` or `ENV.STELLAR_CHAIN_ID`).
It is disabled until the active wallet is connected.

---

## localStorage mock key schema

The API module reuses the same mock infrastructure as the wallet module. The
same-tab bridge (installed by `WalletProvider` on mount) patches
`localStorage.setItem`/`removeItem` to dispatch a `pipeline-mock:wallet` custom
event on every `pipeline.mock.*` write. The `useRequests` hook subscribes to
this event and issues a refetch — no page reload needed.

> **Note:** The event name `pipeline-mock:wallet` is a legacy misnomer. The
> bridge covers all `pipeline.mock.*` keys, not just wallet ones.

### `useStats` mock keys

| Key                               | Type                     | Purpose                                           |
| --------------------------------- | ------------------------ | ------------------------------------------------- |
| `pipeline.mock.api.GET./v1/stats` | JSON `{ vaults: [...] }` | Bypasses the real fetch — `useStats` returns this |

### `usePnl` mock keys

| Key                                                 | Type               | Purpose                                        |
| --------------------------------------------------- | ------------------ | ---------------------------------------------- |
| `pipeline.mock.api.GET./v1/pnl`                     | JSON `PnlResponse` | Bypasses the real fetch for any wallet         |
| `pipeline.mock.api.GET./v1/pnl?wallet=…&chain_id=…` | JSON `PnlResponse` | Per-wallet/per-chain override when exact match |

### `useRequests` mock keys

| Key                                                | Type                       | Purpose                                                                         |
| -------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `pipeline.mock.api.GET./v1/requests`               | JSON `{ requests: [...] }` | Bypasses the real fetch — `useRequests` returns this immediately for any wallet |
| `pipeline.mock.api.GET./v1/requests?wallet=<addr>` | JSON `{ requests: [...] }` | Per-wallet override; takes priority over the un-keyed alias above               |

**Lookup order:** with-query-string key → without-query-string key → real fetch.

### `useDepositVoucher` mock keys

| Key                                                                    | Type                                                  | Purpose                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher`               | JSON `{ signature: "0x…", request_id, amount, user }` | Bypasses the real fetch for any wallet                            |
| `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher?wallet=<addr>` | JSON `{ signature: "0x…", request_id, amount, user }` | Per-wallet override; takes priority over the un-keyed alias above |

### `useStellarDepositVoucher` mock keys

| Key                                                                                  | Type                                                  | Purpose                                                               |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher`                             | JSON `{ signature: "...", request_id, amount, user }` | Bypasses the real fetch for any wallet                                |
| `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher?wallet=<addr>&chain_id=<id>` | JSON `{ signature: "...", request_id, amount, user }` | Per-wallet/per-chain override; takes priority over the un-keyed alias |

### `useWithdrawalVoucher` mock keys

| Key                                                                       | Type                                                  | Purpose                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `pipeline.mock.api.GET./v1/withdrawals/<requestId>/voucher`               | JSON `{ signature: "0x…", request_id, amount, user }` | Bypasses the real fetch for any wallet                            |
| `pipeline.mock.api.GET./v1/withdrawals/<requestId>/voucher?wallet=<addr>` | JSON `{ signature: "0x…", request_id, amount, user }` | Per-wallet override; takes priority over the un-keyed alias above |

**Lookup order:** with-query-string key → without-query-string key → real fetch.

### `useStellarWithdrawalVoucher` mock keys

`useStellarWithdrawalVoucher` uses the **same mock keys as `useWithdrawalVoucher`** — it
hits the same `/v1/withdrawals/{request_id}/voucher` endpoint. The only difference is the
real HTTP request appends `&chain_id=99000001` (Stellar synthetic chain id) so the API
dispatches to the ed25519 verifier path. The mock layer does not filter on `chain_id`,
so the existing per-wallet and un-keyed alias keys work for both EVM and Stellar mocks.

`signature` in the Stellar response is a **128-char hex string** (64-byte ed25519, not an
EVM 65-byte `0x…` sig). `useStellarWithdrawalVoucher` exposes the decoded bytes as
`signatureBytes: Uint8Array` for direct use in `useStellarClaimWithdrawal.write()`.

| Key                                                                                       | Type                                                        | Purpose                                                 |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| `pipeline.mock.api.GET./v1/withdrawals/<requestId>/voucher`                               | JSON `{ signature: "<128-hex>", request_id, amount, user }` | Bypasses the real fetch for any wallet (Stellar or EVM) |
| `pipeline.mock.api.GET./v1/withdrawals/<requestId>/voucher?wallet=<G…>&chain_id=99000001` | JSON `{ signature: "<128-hex>", request_id, amount, user }` | Per-Stellar-wallet override (most specific wins)        |

### DevTools console snippet — seed example data

Open the browser DevTools console and paste:

```js
localStorage.setItem(
  "pipeline.mock.api.GET./v1/requests",
  JSON.stringify({
    requests: [
      {
        type: "Deposit",
        amount: "1000000",
        request_id: "42",
        status: "PendingClaim",
        created_at: "2026-05-15T12:00:00Z",
      },
      {
        type: "Withdraw",
        amount: "500000",
        request_id: "43",
        status: "PendingVerification",
        created_at: "2026-05-14T09:30:00Z",
      },
      {
        type: "Stake",
        amount: "1000000000000000000000",
        assets: "1000000000000000000000",
        shares: "999500000000000000000",
        status: "Completed",
        created_at: "2026-05-13T18:00:00Z",
      },
    ],
  }),
);
```

The `/transactions` page updates instantly. To reset:

```js
localStorage.removeItem("pipeline.mock.api.GET./v1/requests");
```

To mock per-wallet (takes priority over the alias above):

```js
localStorage.setItem(
  "pipeline.mock.api.GET./v1/requests?wallet=0x1234000000000000000000000000000000000001",
  JSON.stringify({ requests: [] }),
);
```

### DevTools console snippet — seed withdrawal voucher mock (request_id=77)

```js
// Seed a PendingClaim withdrawal request and a ready voucher for request_id=77.
// Navigate to /withdraw — step 3 (Claim) will be the enabled action.
localStorage.setItem(
  "pipeline.mock.api.GET./v1/requests",
  JSON.stringify({
    requests: [
      {
        type: "Withdraw",
        amount: "10000000000000000000", // 10 PLUSD at 18 decimals
        request_id: "77",
        status: "PendingClaim",
        created_at: new Date().toISOString(),
      },
    ],
  }),
);
localStorage.setItem(
  "pipeline.mock.api.GET./v1/withdrawals/77/voucher",
  JSON.stringify({
    request_id: "77",
    amount: "10000000000000000000",
    user: "0x1234000000000000000000000000000000000000",
    signature:
      "0xaabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd0011223300112233",
  }),
);
```

To reset:

```js
localStorage.removeItem("pipeline.mock.api.GET./v1/requests");
localStorage.removeItem("pipeline.mock.api.GET./v1/withdrawals/77/voucher");
```

---

## Wallet mock keys (cross-reference)

For wallet mock keys (`pipeline.mock.wallet.*`) see
[`src/wallet/README.md`](../wallet/README.md).

### Stellar network fee mock keys

The Stellar network fee hook (`useStellarNetworkFeeEstimate`) lives in the wallet
module but its mock keys are documented here for completeness:

| Key                                                        | Type        | Purpose                                                                                           |
| ---------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `pipeline.mock.wallet.stellar.networkFeeEstimate.deposit`  | JSON string | Pre-formatted (`"~0.0052 XLM"`) or raw decimal (`"0.0052"`) — bypasses the Soroban RPC simulation |
| `pipeline.mock.wallet.stellar.networkFeeEstimate.withdraw` | JSON string | Same format as deposit key; used when `direction === "withdraw"`                                  |

When a raw numeric string is stored (e.g. `"0.0052"`), the hook prepends `~` and appends ` XLM`
automatically. When the key is absent, the hook simulates a representative transaction via the
Soroban RPC server; if simulation fails or the wallet is disconnected, `feeXlm` is `undefined`
and the page renders `—`.
