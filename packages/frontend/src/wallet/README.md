# Wallet module

All blockchain access in the app goes through this module. No other file may
import `wagmi`, `viem`, `@reown/appkit`, or `@tanstack/react-query` directly —
the ESLint `no-restricted-imports` rule enforces this boundary.

## Public API

```ts
import {
  WalletProvider,
  useWallet,
  useUsdcBalance,
  useContractRead,
} from "@/wallet";
```

### `<WalletProvider>`

Top-level provider — mount once above `RouterProvider` in `main.tsx`. Wires
`WagmiProvider` + `QueryClientProvider` and installs the same-tab localStorage
mock bridge.

### `useWallet()`

```ts
const { address, isConnected, chainId, connect, disconnect } = useWallet();
```

| Field          | Type                       | Description                                 |
| -------------- | -------------------------- | ------------------------------------------- |
| `address`      | `0x${string} \| undefined` | Connected wallet address, or `undefined`    |
| `isConnected`  | `boolean`                  | True when a wallet is connected (or mocked) |
| `chainId`      | `number \| undefined`      | Current chain id                            |
| `connect()`    | `() => void`               | Opens the AppKit wallet modal               |
| `disconnect()` | `() => void`               | Disconnects the wallet                      |

### `useUsdcBalance()`

```ts
const { data, formatted, isLoading, error } = useUsdcBalance();
```

Reads `balanceOf(address)` on the USDC contract configured via
`VITE_USDC_ADDRESS`. When the address is the zero address (default) the read
is skipped and `data` is `undefined` ("USDC not configured").

| Field       | Type                  | Description                             |
| ----------- | --------------------- | --------------------------------------- |
| `data`      | `bigint \| undefined` | Raw balance (6 decimal places for USDC) |
| `formatted` | `string \| undefined` | Formatted as `$1,000.00`                |
| `isLoading` | `boolean`             |                                         |
| `error`     | `Error \| null`       |                                         |

### `useContractRead({ address, abi, functionName, args })`

Thin wrapper around wagmi's `useReadContract` that checks the mock layer
before delegating to the real read. Returns `{ data, isLoading, error }`.

---

## localStorage mock key schema

When a `pipeline.mock.wallet.*` key is present the wallet module returns the
parsed mock value and skips the real RPC call entirely. No env flag needed —
the absence of a key is its own off-switch.

> Note: the same-tab mock bridge is installed automatically by `WalletProvider`
> on mount. This patches `localStorage.setItem` / `removeItem` so writes from
> the DevTools console dispatch a `pipeline-mock:wallet` custom event that
> causes React to re-render without a page reload.

| Key                                            | Type                                                    | Notes                                                       |
| ---------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| `pipeline.mock.wallet.address`                 | `string` (`0x…`)                                        | Sets the connected wallet address                           |
| `pipeline.mock.wallet.isConnected`             | `"true"` or `"false"`                                   | Defaults to `"true"` when `address` is set                  |
| `pipeline.mock.wallet.chainId`                 | numeric string e.g. `"560048"`                          | Overrides `useChainId()`                                    |
| `pipeline.mock.wallet.balance.usdc`            | numeric string of raw bigint (6 dp) e.g. `"1000000000"` | 1000 USDC                                                   |
| `pipeline.mock.wallet.contract.<address>.<fn>` | JSON-encoded return value                               | Overrides `useContractRead` for the given contract+function |

### DevTools console snippets

**Simulate connected wallet with 1,000 USDC:**

```js
localStorage.setItem(
  "pipeline.mock.wallet.address",
  "0x1234000000000000000000000000000000000000",
);
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.balance.usdc", "1000000000");
```

**Clear mock (simulate disconnect):**

```js
localStorage.removeItem("pipeline.mock.wallet.address");
localStorage.removeItem("pipeline.mock.wallet.isConnected");
localStorage.removeItem("pipeline.mock.wallet.balance.usdc");
```

**Override a contract read:**

```js
localStorage.setItem(
  "pipeline.mock.wallet.contract.0xabc123.balanceOf",
  JSON.stringify("42"),
);
```

---

## Adding to the public surface

To expose a new hook or type:

1. Implement it in a file inside `src/wallet/`.
2. Export it from `src/wallet/index.ts`.
3. Do not re-export raw `wagmi`/`viem` types in the barrel — define wrapper
   types in `useWallet.ts` instead, so the call sites stay free of direct
   library imports.
