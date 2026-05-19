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
  useToken,
  useContractRead,
  useApproval,
  useDepositManagerAddresses,
  useDepositManagerMinDeposit,
  useRequestDeposit,
  useClaim,
  useWithdrawalQueueAddresses,
  useRequestWithdrawal,
  useClaimWithdrawal,
  useStakedPlusdAsset,
  useStakedPlusdConvertToShares,
  useStakedPlusdConvertToAssets,
  useStake,
  useUnstake,
  isMockKeyPresent,
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

### `useToken({ token, spender? })`

```ts
const {
  decimals,
  symbol,
  balance,
  formattedBalance,
  refetchBalance,
  allowance,
  isSufficient,
  approve,
  approveData,
  isApprovePending,
  isApproveSuccess,
  refetchAllowance,
  isLoading,
  error,
} = useToken({ token: "0x…", spender: "0x…" /* optional */ });
```

Bundles three ERC-20 reads for the connected wallet into one return value:
metadata (`decimals`, `symbol`), balance (`balanceOf(owner)`), and approval
(composed from `useApproval`). The approval fields are `undefined` / no-op
when `spender` is omitted.

**Parameters:**

| Parameter | Type                       | Description                                          |
| --------- | -------------------------- | ---------------------------------------------------- |
| `token`   | `0x${string}`              | ERC-20 token contract address (required)             |
| `spender` | `0x${string} \| undefined` | Optional — enables the approval branch when provided |

**Return fields:**

| Field              | Type                                         | Description                                                                                    |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `decimals`         | `number \| undefined`                        | Token decimals from `decimals()`. Cached forever. `undefined` while loading.                   |
| `symbol`           | `string \| undefined`                        | Token symbol from `symbol()`. Cached forever. `undefined` while loading.                       |
| `balance`          | `bigint \| undefined`                        | Raw `balanceOf(owner)`. `undefined` when disconnected or loading.                              |
| `formattedBalance` | `string \| undefined`                        | Plain formatted number string (e.g. `"1,000.00"`). `undefined` while balance or decimals load. |
| `refetchBalance`   | `() => void`                                 | Re-reads `balanceOf(owner)`.                                                                   |
| `allowance`        | `bigint \| undefined`                        | Current ERC-20 allowance. `undefined` when spender is omitted.                                 |
| `isSufficient`     | `((amount: bigint) => boolean) \| undefined` | `allowance >= amount`. `undefined` when spender is omitted.                                    |
| `approve`          | `((amount: bigint) => void) \| undefined`    | Triggers `approve(spender, amount)`. `undefined` when spender is omitted.                      |
| `approveData`      | `{ hash: string } \| undefined`              | Populated after approve tx is broadcast. `undefined` when spender is omitted.                  |
| `isApprovePending` | `boolean`                                    | `true` while approve tx is in flight.                                                          |
| `isApproveSuccess` | `boolean`                                    | `true` once approve tx is broadcast-accepted.                                                  |
| `refetchAllowance` | `(() => void) \| undefined`                  | Re-reads current allowance. `undefined` when spender is omitted.                               |
| `isLoading`        | `boolean`                                    | `true` when any underlying read is in flight.                                                  |
| `error`            | `Error \| null`                              | First non-null error across all reads (approval error masked when spender is omitted).         |

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

### `useStakedPlusdAsset()`

```ts
const { plusd, isLoading, error } = useStakedPlusdAsset();
```

Reads the `asset()` view from the StakedPLUSD vault — returns the underlying
PLUSD token address. Immutable per the ERC-4626 spec; cached forever
(`staleTime: Infinity`). Returns `plusd: undefined` when
`VITE_STAKED_PLUSD_ADDRESS` is the zero address.

| Field       | Type                       | Description                                           |
| ----------- | -------------------------- | ----------------------------------------------------- |
| `plusd`     | `0x${string} \| undefined` | PLUSD token address, or `undefined` if not configured |
| `isLoading` | `boolean`                  |                                                       |
| `error`     | `Error \| null`            |                                                       |

### `useStakedPlusdConvertToShares(assets)`

```ts
const { data, isLoading, error } = useStakedPlusdConvertToShares(assets);
// assets: bigint | undefined — pass undefined or 0n to disable the hook
```

Reads `convertToShares(uint256 assets)` — "how many sPLUSD shares do I get for
`assets` PLUSD?" Used for the stake-direction preview. Short cache (`staleTime:
30_000`, `refetchInterval: 30_000`). Disabled when `assets` is `undefined` or
`0n`, or when `VITE_STAKED_PLUSD_ADDRESS` is zero.

| Field       | Type                  | Description                                        |
| ----------- | --------------------- | -------------------------------------------------- |
| `data`      | `bigint \| undefined` | Projected sPLUSD share count, `undefined` if disabled |
| `isLoading` | `boolean`             |                                                    |
| `error`     | `Error \| null`       |                                                    |

### `useStakedPlusdConvertToAssets(shares)`

```ts
const { data, isLoading, error } = useStakedPlusdConvertToAssets(shares);
// shares: bigint | undefined — pass undefined or 0n to disable the hook
```

Reads `convertToAssets(uint256 shares)` — "how much PLUSD do I get for
`shares` sPLUSD?" Used for the unstake-direction preview. Same caching and
disable semantics as `useStakedPlusdConvertToShares`.

### `useStake()`

```ts
const { write, data, isPending, isSuccess, error, reset } = useStake();
write(amount); // amount: bigint (PLUSD, 18 decimals)
```

Write hook for `deposit(uint256 assets, address receiver)`. `receiver` defaults
to the connected wallet (applied internally). Returns a tx hash in `data.hash`
after success. Error guards: `Error("Wallet not connected")` when no wallet is
connected; `Error("StakedPLUSD not configured")` when the env address is zero.

### `useUnstake()`

```ts
const { write, data, isPending, isSuccess, error, reset } = useUnstake();
write(shares); // shares: bigint (sPLUSD, 18 decimals)
```

Write hook for `redeem(uint256 shares, address receiver, address owner)`. Both
`receiver` and `owner` default to the connected wallet (applied internally). No
verifier signature required — unstaking is a direct ERC-4626 transaction. Same
error guards as `useStake`.

### `isMockKeyPresent(key: string): boolean`

Non-reactive helper that returns `true` when a `pipeline.mock.wallet.*` key is
currently set in `localStorage`. Used by the `/test` diagnostic page to render
`MOCKED` badges next to each field whose value is sourced from the mock layer
rather than from a real RPC call. Performs a single `localStorage.getItem` check
per call — not reactive, but because the wallet hooks re-render when mock keys
change, the badge is recomputed automatically in the same cycle as the value.

---

## localStorage mock key schema

> For API mock keys (`pipeline.mock.api.*`) see [`src/api/README.md`](../api/README.md).

### Quick start — work without a real wallet

Run the dev server, open the browser DevTools console, and paste:

```js
// Replace with the actual USDC address from your deployment
const usdcAddress = "0x2222000000000000000000000000000000000002";

localStorage.setItem(
  "pipeline.mock.wallet.address",
  "0x1234000000000000000000000000000000000000",
);
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
localStorage.setItem(
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.decimals`,
  "6",
);
localStorage.setItem(
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.symbol`,
  "USDC",
);
localStorage.setItem(
  `pipeline.mock.wallet.balance.${usdcAddress.toLowerCase()}`,
  "1000000000", // 1,000 USDC
);
```

The UI updates instantly (no reload needed). The TopBar switches to its
connected state and shows the USDC balance. To reset:

```js
const usdcAddress = "0x2222000000000000000000000000000000000002";

[
  "pipeline.mock.wallet.address",
  "pipeline.mock.wallet.isConnected",
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.decimals`,
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.symbol`,
  `pipeline.mock.wallet.balance.${usdcAddress.toLowerCase()}`,
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

| Key                                                           | Type                                                            | Notes                                                                                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline.mock.wallet.address`                                | `string` (`0x…`)                                                | Sets the connected wallet address                                                                                                              |
| `pipeline.mock.wallet.isConnected`                            | `"true"` or `"false"`                                           | Defaults to `"true"` when `address` is set                                                                                                     |
| `pipeline.mock.wallet.chainId`                                | numeric string e.g. `"560048"`                                  | Overrides `useChainId()`                                                                                                                       |
| `pipeline.mock.wallet.contract.<token>.decimals`              | numeric string e.g. `"6"`                                       | Mock `decimals()` for `useToken`; `<token>` is the token address (lowercased).                                                                 |
| `pipeline.mock.wallet.contract.<token>.symbol`                | string e.g. `"USDC"`                                            | Mock `symbol()` for `useToken`; `<token>` is the token address (lowercased).                                                                   |
| `pipeline.mock.wallet.balance.<token>`                        | decimal bigint string e.g. `"1000000000"` (= 1000 USDC at 6 dp) | Mock `balanceOf(owner)` for `useToken`; `<token>` is the token address (lowercased). Replaces the removed `pipeline.mock.wallet.balance.usdc`. |
| `pipeline.mock.wallet.contract.<address>.<fn>`                | JSON-encoded return value                                       | Overrides `useContractRead` for the given contract+function                                                                                    |
| `pipeline.mock.wallet.contract.depositManager.plusd`          | `string` (`0x…`)                                                | Named alias for `useDepositManagerAddresses` — plUSD address. Takes priority over the generic key.                                             |
| `pipeline.mock.wallet.contract.depositManager.usdc`           | `string` (`0x…`)                                                | Named alias for `useDepositManagerAddresses` — USDC address. Takes priority over the generic key.                                              |
| `pipeline.mock.wallet.contract.depositManager.minDeposit`     | `string` (decimal bigint, e.g. `"1000000"` = 1 USDC at 6 dp)    | Named alias for `useDepositManagerMinDeposit`. Takes priority over the generic per-address key.                                                |
| `pipeline.mock.wallet.contract.<address>.minDeposit`          | `string` (decimal bigint, e.g. `"1000000"`)                     | Generic per-address fallback for `useDepositManagerMinDeposit`.                                                                                |
| `pipeline.mock.wallet.contract.depositManager.requestDeposit` | JSON `{ hash: "0x…", requestId?: "123" }`                       | Bypasses `useRequestDeposit` wagmi call; `write()` settles immediately with this data.                                                         |
| `pipeline.mock.wallet.contract.depositManager.claim`          | JSON `{ hash: "0x…", amount?: "1000000" }`                      | Bypasses `useClaim` wagmi call; `write()` settles immediately with this data.                                                                  |
| `pipeline.mock.wallet.contract.withdrawalQueue.plusd`         | `string` (`0x…`)                                                | Named alias for `useWithdrawalQueueAddresses` — PLUSD address (maps from on-chain `fromToken`). Takes priority over the generic key.           |
| `pipeline.mock.wallet.contract.withdrawalQueue.usdc`          | `string` (`0x…`)                                                | Named alias for `useWithdrawalQueueAddresses` — USDC address (maps from on-chain `intoToken`). Takes priority over the generic key.            |
| `pipeline.mock.wallet.contract.<address>.fromToken`           | `string` (`0x…`)                                                | Generic per-address fallback for `useWithdrawalQueueAddresses` — PLUSD address.                                                                |
| `pipeline.mock.wallet.contract.<address>.intoToken`           | `string` (`0x…`)                                                | Generic per-address fallback for `useWithdrawalQueueAddresses` — USDC address.                                                                 |
| `pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal` | JSON `{ hash: "0x…", requestId?: "123", queued?: "1000000" }` | Bypasses `useRequestWithdrawal` wagmi call; `write()` settles immediately with this data. `requestId` and `queued` are mock-path only.         |
| `pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal` | JSON `{ hash: "0x…", amount?: "1000000" }`                    | Bypasses `useClaimWithdrawal` wagmi call; `write()` settles immediately with this data.                                                        |
| `pipeline.mock.wallet.contract.stakedPlusd.asset`             | `string` (`0x…`)                                                | Named alias for `useStakedPlusdAsset` — PLUSD token address (maps from `asset()`). Takes priority over the generic key.                        |
| `pipeline.mock.wallet.contract.<address>.asset`               | `string` (`0x…`)                                                | Generic per-address fallback for `useStakedPlusdAsset`.                                                                                        |
| `pipeline.mock.wallet.contract.stakedPlusd.convertToShares`   | decimal bigint at 18 decimals (rate scalar)                     | Rate mock for `useStakedPlusdConvertToShares`. Hook returns `(assets * rate) / 1e18`. Example: `"959600000000000000"` ⇒ 0.9596 sPLUSD per 1 PLUSD. Named alias; takes priority over generic key. |
| `pipeline.mock.wallet.contract.<address>.convertToShares`     | decimal bigint at 18 decimals (rate scalar)                     | Generic per-address fallback for `useStakedPlusdConvertToShares`. Same rate-based arithmetic.                                                  |
| `pipeline.mock.wallet.contract.stakedPlusd.convertToAssets`   | decimal bigint at 18 decimals (inverse rate scalar)             | Rate mock for `useStakedPlusdConvertToAssets`. Hook returns `(shares * rate) / 1e18`. Example: `"1042100000000000000"` ⇒ 1.0421 PLUSD per 1 sPLUSD. Named alias; takes priority over generic key. |
| `pipeline.mock.wallet.contract.<address>.convertToAssets`     | decimal bigint at 18 decimals (inverse rate scalar)             | Generic per-address fallback for `useStakedPlusdConvertToAssets`. Same rate-based arithmetic.                                                  |
| `pipeline.mock.wallet.contract.stakedPlusd.stake`             | JSON `{ hash: "0x…", shares?: "1000000000000000000" }`          | Bypasses `useStake` wagmi call; `write()` settles immediately with this data. `shares` is mock-path only.                                      |
| `pipeline.mock.wallet.contract.stakedPlusd.unstake`           | JSON `{ hash: "0x…", assets?: "1000000000000000000" }`          | Bypasses `useUnstake` wagmi call; `write()` settles immediately with this data. `assets` is mock-path only.                                    |
| `pipeline.mock.wallet.allowance.<token>.<spender>`            | decimal bigint string e.g. `"1000000"` (= 1 USDC at 6 dp)       | Bypasses the real `allowance` read in `useApproval`; token and spender are lowercased.                                                         |
| `pipeline.mock.wallet.contract.<token>.approve`               | JSON `{ hash: "0x…" }`                                          | Bypasses the real `approve` tx in `useApproval`; token is lowercased. `approve()` settles immediately.                                         |

### DevTools console snippets

**Simulate connected wallet with 1,000 USDC (full `useToken` surface):**

```js
// Replace with actual deployed addresses
const usdcAddress = "0x2222000000000000000000000000000000000002";
const depositManagerAddress = "0x3333000000000000000000000000000000000003";

localStorage.setItem(
  "pipeline.mock.wallet.address",
  "0x1234000000000000000000000000000000000000",
);
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");

// Token metadata (cached forever — not wallet-dependent)
localStorage.setItem(
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.decimals`,
  "6",
);
localStorage.setItem(
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.symbol`,
  "USDC",
);

// Balance (keyed by token address, not by symbol)
localStorage.setItem(
  `pipeline.mock.wallet.balance.${usdcAddress.toLowerCase()}`,
  "1000000000", // 1,000 USDC at 6 decimals
);

// Allowance + approve (optional — enables the approval branch)
localStorage.setItem(
  `pipeline.mock.wallet.allowance.${usdcAddress.toLowerCase()}.${depositManagerAddress.toLowerCase()}`,
  "500000000", // 500 USDC at 6 decimals
);
localStorage.setItem(
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.approve`,
  JSON.stringify({ hash: "0xapprovetxhash" }),
);
```

**Clear mock (simulate disconnect):**

```js
const usdcAddress = "0x2222000000000000000000000000000000000002";
const depositManagerAddress = "0x3333000000000000000000000000000000000003";

[
  "pipeline.mock.wallet.address",
  "pipeline.mock.wallet.isConnected",
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.decimals`,
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.symbol`,
  `pipeline.mock.wallet.balance.${usdcAddress.toLowerCase()}`,
  `pipeline.mock.wallet.allowance.${usdcAddress.toLowerCase()}.${depositManagerAddress.toLowerCase()}`,
  `pipeline.mock.wallet.contract.${usdcAddress.toLowerCase()}.approve`,
].forEach((k) => localStorage.removeItem(k));
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

**Mock WithdrawalQueue addresses + simulate a successful requestWithdrawal + claimWithdrawal:**

```js
// 1. Set the contract addresses (named aliases — no need to know the deployed address)
//    fromToken → PLUSD, intoToken → USDC (on-chain names; aliases are plusd / usdc)
localStorage.setItem(
  "pipeline.mock.wallet.contract.withdrawalQueue.plusd",
  "0x1111000000000000000000000000000000000001",
);
localStorage.setItem(
  "pipeline.mock.wallet.contract.withdrawalQueue.usdc",
  "0x2222000000000000000000000000000000000002",
);

// 2. Mock a successful requestWithdrawal (returns a fake tx hash + requestId + queued)
//    Note: requestId and queued are mock-path only (wagmi real path only yields a hash)
localStorage.setItem(
  "pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal",
  JSON.stringify({ hash: "0xdeadbeefdeadbeef", requestId: "7", queued: "5000000" }),
);

// 3. Mock a successful claimWithdrawal (returns a fake tx hash + amount)
localStorage.setItem(
  "pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal",
  JSON.stringify({ hash: "0xcafecafecafecafe", amount: "5000000" }),
);
```

To reset all WithdrawalQueue mocks:

```js
[
  "pipeline.mock.wallet.contract.withdrawalQueue.plusd",
  "pipeline.mock.wallet.contract.withdrawalQueue.usdc",
  "pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal",
  "pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal",
].forEach((k) => localStorage.removeItem(k));
```

**Mock StakedPLUSD vault — asset address + convert rates + stake/unstake:**

```js
// 1. Set the PLUSD underlying asset address (named alias for useStakedPlusdAsset)
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.asset",
  "0x1111000000000000000000000000000000000001",
);

// 2. Mock convertToShares rate: 0.9596 sPLUSD per 1 PLUSD
//    Formula: (assets * rate) / 1e18
//    0.9596 at 1e18 scale = 959600000000000000
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.convertToShares",
  "959600000000000000", // 0.9596 sPLUSD per 1 PLUSD ⇒ rate = 959600000000000000
);

// 3. Mock convertToAssets rate: 1.0421 PLUSD per 1 sPLUSD
//    Formula: (shares * rate) / 1e18
//    1.0421 at 1e18 scale = 1042100000000000000
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets",
  "1042100000000000000", // 1.0421 PLUSD per 1 sPLUSD ⇒ rate = 1042100000000000000
);

// 4. Mock a successful stake (deposit) — returns a fake tx hash + shares
//    Note: shares is mock-path only (wagmi real path only yields a hash)
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.stake",
  JSON.stringify({ hash: "0xdeadbeefdeadbeef", shares: "959600000000000000" }),
);

// 5. Mock a successful unstake (redeem) — returns a fake tx hash + assets
//    Note: assets is mock-path only (wagmi real path only yields a hash)
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.unstake",
  JSON.stringify({ hash: "0xcafecafecafecafe", assets: "1042100000000000000" }),
);
```

To reset all StakedPLUSD mocks:

```js
[
  "pipeline.mock.wallet.contract.stakedPlusd.asset",
  "pipeline.mock.wallet.contract.stakedPlusd.convertToShares",
  "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets",
  "pipeline.mock.wallet.contract.stakedPlusd.stake",
  "pipeline.mock.wallet.contract.stakedPlusd.unstake",
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
