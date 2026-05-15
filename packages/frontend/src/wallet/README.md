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
# edit VITE_WALLETCONNECT_PROJECT_ID and VITE_DEPOSIT_MANAGER_ADDRESS as needed
```

If you leave `VITE_DEPOSIT_MANAGER_ADDRESS` at the zero-address default or omit it, USDC
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
  useApproval,
  useDepositManagerAddresses,
  useDepositManagerMinDeposit,
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

Reads `balanceOf(address)` on the USDC contract. The USDC address is derived
from `useDepositManagerAddresses().usdc` (the `usdc()` view on the
DepositManager contract) — not from a separate env variable. The read is gated
on the manager being configured and `usdc()` resolving to a non-zero address.
`isLoading` is `true` while the manager's `usdc()` call is in flight. When
`VITE_DEPOSIT_MANAGER_ADDRESS` is the zero address (default), the read is
skipped and `data` is `undefined`.

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

| Field       | Type                       | Description                                           |
| ----------- | -------------------------- | ----------------------------------------------------- |
| `plusd`     | `0x${string} \| undefined` | plUSD token address, or `undefined` if not configured |
| `usdc`      | `0x${string} \| undefined` | USDC token address, or `undefined` if not configured  |
| `isLoading` | `boolean`                  |                                                       |
| `error`     | `Error \| null`            |                                                       |

### `useDepositManagerMinDeposit()`

```ts
const { minDeposit, isLoading, error } = useDepositManagerMinDeposit();
```

Reads `minDeposit()` from the DepositManager contract. Fetches once per page
lifetime (`staleTime: Infinity`). Returns `minDeposit: undefined` when
`VITE_DEPOSIT_MANAGER_ADDRESS` is the zero address — no RPC call is made.

| Field        | Type                  | Description                                                   |
| ------------ | --------------------- | ------------------------------------------------------------- |
| `minDeposit` | `bigint \| undefined` | Minimum USDC amount accepted by `requestDeposit` (6 decimals) |
| `isLoading`  | `boolean`             |                                                               |
| `error`      | `Error \| null`       |                                                               |

### `useApproval({ token, spender })`

```ts
const {
  allowance,
  isSufficient,
  approve,
  data,
  isLoading,
  isPending,
  isSuccess,
  error,
  reset,
  refetch,
} = useApproval({ token, spender });
```

Reads `allowance(owner, spender)` on any ERC-20 token contract and exposes
`approve(spender, amount)` for the same pair. Token address and spender address
are parameters — nothing is hard-coded — so the same hook serves any
(token, spender) combination.

**Parameters:**

| Parameter | Type          | Description                      |
| --------- | ------------- | -------------------------------- |
| `token`   | `0x${string}` | ERC-20 token contract address    |
| `spender` | `0x${string}` | Spender address to check/approve |

**Return fields:**

| Field          | Type                            | Description                                                                                                                          |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `allowance`    | `bigint \| undefined`           | Current allowance for `(owner=connected wallet, spender)`. `undefined` when disconnected, zero address, or loading.                  |
| `isSufficient` | `(amount: bigint) => boolean`   | Convenience check: `allowance >= amount`. Returns `false` when `allowance` is `undefined` (pessimistic).                             |
| `approve`      | `(amount: bigint) => void`      | Triggers `approve(spender, amount)` on the token contract. No-op (sets `error`) when token/spender is zero or disconnected.          |
| `data`         | `{ hash: string } \| undefined` | Populated after approve tx is broadcast.                                                                                             |
| `isLoading`    | `boolean`                       | `true` while allowance read is in flight.                                                                                            |
| `isPending`    | `boolean`                       | `true` while approve tx is in flight.                                                                                                |
| `isSuccess`    | `boolean`                       | `true` once approve tx is broadcast-accepted (does not wait for receipt, consistent with `useRequestDeposit`).                       |
| `error`        | `Error \| null`                 | Read or write error; cleared by `reset()`.                                                                                           |
| `reset`        | `() => void`                    | Clears `data`, `error`, and resets `isPending`/`isSuccess`.                                                                          |
| `refetch`      | `() => void`                    | Re-reads current allowance. Called automatically after a successful approve. Note: external allowance changes are NOT auto-detected. |

### `useRequestDeposit()`

```ts
const { write, data, isPending, isSuccess, error, reset } = useRequestDeposit();
write(amount); // amount: bigint (USDC, 6 decimals)
```

Write hook for `requestDeposit(uint256 amount)`. Returns a tx hash in `data.hash`
after success. When `VITE_DEPOSIT_MANAGER_ADDRESS` is zero, `write()` surfaces
`Error("DepositManager not configured")` without making an RPC call.

### `useClaim()`

```ts
const { write, data, isPending, isSuccess, error, reset } = useClaim();
write(requestId, verifierSignature); // requestId: bigint; verifierSignature: `0x${string}`
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

| Key                                                           | Type                                                         | Notes                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `pipeline.mock.wallet.address`                                | `string` (`0x…`)                                             | Sets the connected wallet address                                                                      |
| `pipeline.mock.wallet.isConnected`                            | `"true"` or `"false"`                                        | Defaults to `"true"` when `address` is set                                                             |
| `pipeline.mock.wallet.chainId`                                | numeric string e.g. `"560048"`                               | Overrides `useChainId()`                                                                               |
| `pipeline.mock.wallet.balance.usdc`                           | numeric string of raw bigint (6 dp) e.g. `"1000000000"`      | 1000 USDC                                                                                              |
| `pipeline.mock.wallet.contract.<address>.<fn>`                | JSON-encoded return value                                    | Overrides `useContractRead` for the given contract+function                                            |
| `pipeline.mock.wallet.contract.depositManager.plusd`          | `string` (`0x…`)                                             | Named alias for `useDepositManagerAddresses` — plUSD address. Takes priority over the generic key.     |
| `pipeline.mock.wallet.contract.depositManager.usdc`           | `string` (`0x…`)                                             | Named alias for `useDepositManagerAddresses` — USDC address. Takes priority over the generic key.      |
| `pipeline.mock.wallet.contract.depositManager.minDeposit`     | `string` (decimal bigint, e.g. `"1000000"` = 1 USDC at 6 dp) | Named alias for `useDepositManagerMinDeposit`. Takes priority over the generic per-address key.        |
| `pipeline.mock.wallet.contract.<address>.minDeposit`          | `string` (decimal bigint, e.g. `"1000000"`)                  | Generic per-address fallback for `useDepositManagerMinDeposit`.                                        |
| `pipeline.mock.wallet.contract.depositManager.requestDeposit` | JSON `{ hash: "0x…", requestId?: "123" }`                    | Bypasses `useRequestDeposit` wagmi call; `write()` settles immediately with this data.                 |
| `pipeline.mock.wallet.contract.depositManager.claim`          | JSON `{ hash: "0x…", amount?: "1000000" }`                   | Bypasses `useClaim` wagmi call; `write()` settles immediately with this data.                          |
| `pipeline.mock.wallet.allowance.<token>.<spender>`            | decimal bigint string e.g. `"1000000"` (= 1 USDC at 6 dp)    | Bypasses the real `allowance` read in `useApproval`; token and spender are lowercased.                 |
| `pipeline.mock.wallet.contract.<token>.approve`               | JSON `{ hash: "0x…" }`                                       | Bypasses the real `approve` tx in `useApproval`; token is lowercased. `approve()` settles immediately. |

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

**Mock DepositManager addresses + minDeposit + simulate a successful requestDeposit:**

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

// 2. Set the minimum deposit (decimal bigint string; 1000000 = 1 USDC at 6 decimals)
localStorage.setItem(
  "pipeline.mock.wallet.contract.depositManager.minDeposit",
  "1000000",
);

// 3. Mock a successful requestDeposit (returns a fake tx hash + requestId)
localStorage.setItem(
  "pipeline.mock.wallet.contract.depositManager.requestDeposit",
  JSON.stringify({ hash: "0xdeadbeefdeadbeef", requestId: "42" }),
);

// 4. Mock a successful claim
localStorage.setItem(
  "pipeline.mock.wallet.contract.depositManager.claim",
  JSON.stringify({ hash: "0xcafecafecafecafe", amount: "1000000" }),
);
```

To reset all DepositManager mocks:

```js
[
  "pipeline.mock.wallet.contract.depositManager.plusd",
  "pipeline.mock.wallet.contract.depositManager.usdc",
  "pipeline.mock.wallet.contract.depositManager.minDeposit",
  "pipeline.mock.wallet.contract.depositManager.requestDeposit",
  "pipeline.mock.wallet.contract.depositManager.claim",
].forEach((k) => localStorage.removeItem(k));
```

**Mock USDC → DepositManager allowance + approve:**

```js
// Replace these with the actual deployed addresses
const usdcAddress = "0x2222000000000000000000000000000000000002";
const depositManagerAddress = "0x3333000000000000000000000000000000000003";

// 1. Mock the current allowance (decimal bigint string; 500000 = 0.5 USDC at 6 decimals)
localStorage.setItem(
  `pipeline.mock.wallet.allowance.${usdcAddress.toLowerCase()}.${depositManagerAddress.toLowerCase()}`,
  "500000",
);

// 2. Mock a successful approve tx (returns a fake tx hash)
localStorage.setItem(
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.approve`,
  JSON.stringify({ hash: "0xapprovetxhash" }),
);
```

To reset the allowance + approve mocks:

```js
const usdcAddress = "0x2222000000000000000000000000000000000002";
const depositManagerAddress = "0x3333000000000000000000000000000000000003";

[
  `pipeline.mock.wallet.allowance.${usdcAddress.toLowerCase()}.${depositManagerAddress.toLowerCase()}`,
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.approve`,
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
