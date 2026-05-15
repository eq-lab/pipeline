# Frontend hooks

Catalogue of reused React hooks. Governed by [`docs/FRONTEND.md` → Code structure rules](../FRONTEND.md#code-structure-rules).

**Inclusion criteria.** A hook appears here when it is consumed by two or more components, or is explicitly designed for reuse (e.g. shipped from `@pipeline/ui` or the wallet module). Component-local hooks following the "view + co-located hook" rule (e.g. `useStakeCard` next to `StakeCard.tsx`) are intentionally **excluded** — they have one owner and one call site.

Entries are sorted alphabetically by name.

| Name | Import path | Description |
|------|-------------|-------------|
| `useUsdcBalance` | `@/wallet` | Returns the connected wallet's USDC balance, formatted and raw. Honours `pipeline.mock.wallet.balance.usdc` for mock testing. |
| `useWallet` | `@/wallet` | Returns the connected wallet's address, connection state, chain id, and `connect`/`disconnect` actions. Backed by wagmi + Reown AppKit; honours `pipeline.mock.wallet.*` localStorage keys. |

## How to add a row

1. Land the hook in code with the tests that cover its public contract.
2. Add a row above with the export name, the `@pipeline/...` (or `@/...`) import path, and a one-sentence description (what it returns and its primary side effect, if any).
3. Keep the table sorted alphabetically. If the hook is renamed, moved, or retires from "reused" status, update the row in the same commit.
