# Wallet module

## Running the dev server

```bash
# From the repo root
yarn workspace @pipeline/frontend dev
```

The app is served at http://localhost:5173.

Copy `.env.example` to `.env` and fill in the values before starting:

```bash
cp .env.example .env
# edit VITE_WALLETCONNECT_PROJECT_ID and VITE_USDC_ADDRESS as needed
```

If you leave `VITE_USDC_ADDRESS` at the zero-address default or omit it, USDC
balance reads are skipped and the mock layer is the only way to display a
balance (see below).

---

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
  useDepositManagerAddresses,
  useRequestDeposit,
  useClaim,
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

### `useDepositManagerAddresses()`

```ts
const { plusd, usdc, isLoading, error } = useDepositManagerAddresses();
```

Reads `plUsd()` and `usdc()` from the DepositManager contract. Fetches once
per page lifetime (`staleTime: Infinity`). Returns `undefined` data when
`VITE_DEPOSIT_MANAGER_ADDRESS` is the zero address.

| Field       | Type                            | Description                                  |
| ----------- | ------------------------------- | -------------------------------------------- |
| `plusd`     | `0x${string} \| undefined`     | plUSD token address, or `undefined` if not configured |
| `usdc`      | `0x${string} \| undefined`     | USDC token address, or `undefined` if not configured  |
| `isLoading` | `boolean`                       |                                              |
| `error`     | `Error \| null`                 |                                              |

### `useRequestDeposit()`

```ts
const { write, data, isPending, isSuccess, error, reset } = useRequestDeposit();
write(amount);  // amount: bigint (USDC, 6 decimals)
```

Write hook for `requestDeposit(uint256 amount)`. Returns a tx hash in `data.hash`
after success. When `VITE_DEPOSIT_MANAGER_ADDRESS` is zero, `write()` surfaces
`Error("DepositManager not configured")` without making an RPC call.

### `useClaim()`

```ts
const { write, data, isPending, isSuccess, error, reset } = useClaim();
write(requestId, verifierSignature);  // requestId: bigint; verifierSignature: `0x${string}`
```

Write hook for `claim(uint256 requestId, bytes verifierSignature)`. Returns a tx
hash in `data.hash` after success. Same zero-address guard as `useRequestDeposit`.

---

## localStorage mock key schema

### Quick start — work without a real wallet

Run the dev server, open the browser DevTools console, and paste:

```js
localStorage.setItem(
  "pipeline.mock.wallet.address",
  "0x1234000000000000000000000000000000000000",
);
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.balance.usdc", "1000000000"); // 1,000 USDC
```

The UI updates instantly (no reload needed). The TopBar switches to its
connected state and shows the USDC balance. To reset:

```js
[
  "pipeline.mock.wallet.address",
  "pipeline.mock.wallet.isConnected",
  "pipeline.mock.wallet.balance.usdc",
].forEach((k) => localStorage.removeItem(k));
```

---

When a `pipeline.mock.wallet.*` key is present the wallet module returns the
parsed mock value and skips the real RPC call entirely. No env flag needed —
the absence of a key is its own off-switch.

> Note: the same-tab mock bridge is installed automatically by `WalletProvider`
> on mount. This patches `localStorage.setItem` / `removeItem` so writes from
> the DevTools console dispatch a `pipeline-mock:wallet` custom event that
> causes React to re-render without a page reload.

| Key                                                                   | Type                                                          | Notes                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pipeline.mock.wallet.address`                                        | `string` (`0x…`)                                              | Sets the connected wallet address                                                                     |
| `pipeline.mock.wallet.isConnected`                                    | `"true"` or `"false"`                                         | Defaults to `"true"` when `address` is set                                                            |
| `pipeline.mock.wallet.chainId`                                        | numeric string e.g. `"560048"`                                | Overrides `useChainId()`                                                                              |
| `pipeline.mock.wallet.balance.usdc`                                   | numeric string of raw bigint (6 dp) e.g. `"1000000000"`       | 1000 USDC                                                                                             |
| `pipeline.mock.wallet.contract.<address>.<fn>`                        | JSON-encoded return value                                     | Overrides `useContractRead` for the given contract+function                                           |
| `pipeline.mock.wallet.contract.depositManager.plusd`                  | `string` (`0x…`)                                              | Named alias for `useDepositManagerAddresses` — plUSD address. Takes priority over the generic key.    |
| `pipeline.mock.wallet.contract.depositManager.usdc`                   | `string` (`0x…`)                                              | Named alias for `useDepositManagerAddresses` — USDC address. Takes priority over the generic key.     |
| `pipeline.mock.wallet.contract.depositManager.requestDeposit`         | JSON `{ hash: "0x…", requestId?: "123" }`                    | Bypasses `useRequestDeposit` wagmi call; `write()` settles immediately with this data.                |
| `pipeline.mock.wallet.contract.depositManager.claim`                  | JSON `{ hash: "0x…", amount?: "1000000" }`                   | Bypasses `useClaim` wagmi call; `write()` settles immediately with this data.                         |

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

**Mock DepositManager addresses + simulate a successful requestDeposit:**

```js
// 1. Set the contract addresses (named aliases — no need to know the deployed address)
localStorage.setItem(
  "pipeline.mock.wallet.contract.depositManager.plusd",
  "0x1111000000000000000000000000000000000001",
);
localStorage.setItem(
  "pipeline.mock.wallet.contract.depositManager.usdc",
  "0x2222000000000000000000000000000000000002",
);

// 2. Mock a successful requestDeposit (returns a fake tx hash + requestId)
localStorage.setItem(
  "pipeline.mock.wallet.contract.depositManager.requestDeposit",
  JSON.stringify({ hash: "0xdeadbeefdeadbeef", requestId: "42" }),
);

// 3. Mock a successful claim
localStorage.setItem(
  "pipeline.mock.wallet.contract.depositManager.claim",
  JSON.stringify({ hash: "0xcafecafecafecafe", amount: "1000000" }),
);
```

To reset DepositManager mocks:

```js
[
  "pipeline.mock.wallet.contract.depositManager.plusd",
  "pipeline.mock.wallet.contract.depositManager.usdc",
  "pipeline.mock.wallet.contract.depositManager.requestDeposit",
  "pipeline.mock.wallet.contract.depositManager.claim",
].forEach((k) => localStorage.removeItem(k));
```

---

## Adding to the public surface

To expose a new hook or type:

1. Implement it in a file inside `src/wallet/`.
2. Export it from `src/wallet/index.ts`.
3. Do not re-export raw `wagmi`/`viem` types in the barrel — define wrapper
   types in `useWallet.ts` instead, so the call sites stay free of direct
   library imports.
