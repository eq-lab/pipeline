# API module

All REST API calls in the application go through this module. No other file may
call `fetch` directly — the ESLint `no-restricted-globals` rule enforces this
boundary.

## Public API

```ts
import { apiFetch, useRequests } from "@/api";

import type {
  RequestItem,
  RequestType,
  RequestStatus,
  RequestsResponse,
  UseRequestsResult,
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

### Types

| Type               | Description                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `RequestItem`      | A single transaction record from `GET /v1/requests`                              |
| `RequestType`      | `"Deposit" \| "Withdraw" \| "Stake" \| "Unstake"`                                |
| `RequestStatus`    | `"PendingVerification" \| "PendingClaim" \| "Completed" \| "VerificationFailed"` |
| `RequestsResponse` | Shape of the full API response: `{ requests: RequestItem[] }`                    |

---

## localStorage mock key schema

The API module reuses the same mock infrastructure as the wallet module. The
same-tab bridge (installed by `WalletProvider` on mount) patches
`localStorage.setItem`/`removeItem` to dispatch a `pipeline-mock:wallet` custom
event on every `pipeline.mock.*` write. The `useRequests` hook subscribes to
this event and issues a refetch — no page reload needed.

> **Note:** The event name `pipeline-mock:wallet` is a legacy misnomer. The
> bridge covers all `pipeline.mock.*` keys, not just wallet ones.

### `useRequests` mock keys

| Key                                                | Type                       | Purpose                                                                         |
| -------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `pipeline.mock.api.GET./v1/requests`               | JSON `{ requests: [...] }` | Bypasses the real fetch — `useRequests` returns this immediately for any wallet |
| `pipeline.mock.api.GET./v1/requests?wallet=<addr>` | JSON `{ requests: [...] }` | Per-wallet override; takes priority over the un-keyed alias above               |

**Lookup order:** with-query-string key → without-query-string key → real fetch.

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

---

## Wallet mock keys (cross-reference)

For wallet mock keys (`pipeline.mock.wallet.*`) see
[`src/wallet/README.md`](../wallet/README.md).
