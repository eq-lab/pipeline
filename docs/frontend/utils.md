# Frontend utils

Catalogue of shared frontend utility helpers. Governed by [`docs/FRONTEND.md` → Code structure rules](../FRONTEND.md#code-structure-rules).

**Inclusion criteria.** A helper appears here when it is used in two or more places and has been lifted into a dedicated module under `packages/frontend/src/utils/` or `packages/ui/src/utils/`. Every entry must ship with unit tests in the same commit that adds it.

Entries are sorted alphabetically by name.

| Name | Import path | Description |
|------|-------------|-------------|
| `CACHE_FOREVER` | `@/wallet` (internal: `src/wallet/evm/cache.ts`) | Wagmi query options preset for "fetch once per page lifetime" reads (immutable-in-practice on-chain data). Sets `staleTime: Infinity`, `gcTime: Infinity`, and disables all automatic refetch triggers. |

## How to add a row

1. Land the util in code with its `*.test.ts` next to it. Test must cover the cases the call sites rely on.
2. Add a row above with the export name, the `@pipeline/...` import path, and a one-sentence description (what it returns, not how it's implemented).
3. Keep the table sorted alphabetically. If the util is renamed or moved, update the row in the same commit.
