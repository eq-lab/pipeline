# Frontend hooks

Catalogue of reused React hooks. Governed by [`docs/FRONTEND.md` → Code structure rules](../FRONTEND.md#code-structure-rules).

**Inclusion criteria.** A hook appears here when it is consumed by two or more components, or is explicitly designed for reuse (e.g. shipped from `@pipeline/ui` or the wallet module). Component-local hooks following the "view + co-located hook" rule (e.g. `useStakeCard` next to `StakeCard.tsx`) are intentionally **excluded** — they have one owner and one call site.

Entries are sorted alphabetically by name.

| Name | Import path | Description |
|------|-------------|-------------|
| `useApproval` | `@/wallet` | Reads ERC-20 `allowance(owner, spender)` and exposes `approve(spender, amount)` for any (token, spender) pair. Returns `{ allowance, isSufficient, approve, data, isLoading, isPending, isSuccess, error, reset, refetch }`. Honours `pipeline.mock.wallet.allowance.<token>.<spender>` and `pipeline.mock.wallet.contract.<token>.approve` for mock testing. |
| `useClaim` | `@/wallet` | Write hook for `claim(requestId, verifierSignature)` on the DepositManager contract. Returns `{ write, data, isPending, isSuccess, error, reset }`. Honours `pipeline.mock.wallet.contract.depositManager.claim` for mock testing. |
| `useContractRead` | `@/wallet` | Generic read hook wrapping wagmi's `useReadContract` with the per-address localStorage mock layer. |
| `useDepositManagerAddresses` | `@/wallet` | Reads the `plUsd()` and `usdc()` addresses from the DepositManager contract. Returns `{ plusd, usdc, isLoading, error }` with "fetch once" caching. Honours `pipeline.mock.wallet.contract.depositManager.plusd/usdc` named aliases. |
| `useDepositManagerMinDeposit` | `@/wallet` | Reads the `minDeposit()` view from the DepositManager contract. Returns `{ minDeposit: bigint \| undefined, isLoading, error }` with "fetch once" caching. Honours `pipeline.mock.wallet.contract.depositManager.minDeposit` (named alias, takes priority) and `pipeline.mock.wallet.contract.<address>.minDeposit` (generic per-address fallback). |
| `useRequestDeposit` | `@/wallet` | Write hook for `requestDeposit(amount)` on the DepositManager contract. Returns `{ write, data, isPending, isSuccess, error, reset }`. Honours `pipeline.mock.wallet.contract.depositManager.requestDeposit` for mock testing. |
| `useToken` | `@/wallet` | Bundles ERC-20 metadata (`decimals`, `symbol`), balance (`balanceOf`), and approval (`useApproval` composition) into one return value for the connected wallet. Returns `{ decimals, symbol, balance, formattedBalance, refetchBalance, allowance, isSufficient, approve, approveData, isApprovePending, isApproveSuccess, refetchAllowance, isLoading, error }`. Honours `pipeline.mock.wallet.contract.<token>.decimals`, `…symbol`, `pipeline.mock.wallet.balance.<token>`, and approval mock keys. |
| `useWallet` | `@/wallet` | Returns the connected wallet's address, connection state, chain id, and `connect`/`disconnect` actions. Backed by wagmi + Reown AppKit; honours `pipeline.mock.wallet.*` localStorage keys. |

## How to add a row

1. Land the hook in code with the tests that cover its public contract.
2. Add a row above with the export name, the `@pipeline/...` (or `@/...`) import path, and a one-sentence description (what it returns and its primary side effect, if any).
3. Keep the table sorted alphabetically. If the hook is renamed, moved, or retires from "reused" status, update the row in the same commit.
