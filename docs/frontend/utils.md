# Frontend utils

Catalogue of shared frontend utility helpers. Governed by [`docs/FRONTEND.md` → Code structure rules](../FRONTEND.md#code-structure-rules).

**Inclusion criteria.** A helper appears here when it is used in two or more places and has been lifted into a dedicated module under `packages/frontend/src/utils/` or `packages/ui/src/utils/`. Every entry must ship with unit tests in the same commit that adds it.

Entries are sorted alphabetically by name.

| Name | Import path | Description |
|------|-------------|-------------|
| `CACHE_FOREVER` | `@/wallet` (internal: `src/wallet/evm/cache.ts`) | Wagmi query options preset for "fetch once per page lifetime" reads (immutable-in-practice on-chain data). Sets `staleTime: Infinity`, `gcTime: Infinity`, and disables all automatic refetch triggers. |
| `formatCompactUsd` | `@/utils/formatCompactUsd` | Formats base-6 decimal-string USDC amounts (already in human units, e.g. `"8000000.000000"`) as compact dollar notation (`"$8.0M"`, `"$500.0K"`). Do NOT pass raw sub-unit bigints. null/undefined/non-numeric → `"—"`. |
| `formatCoverage` | `@/utils/formatCompactUsd` | Formats a 2-decimal ratio string as a one-decimal `"x"` suffix (e.g. `"1.50"` → `"1.5x"`). null → `"—"`. |
| `formatDurationDays` | `@/utils/formatCompactUsd` | Formats a duration in whole days. `compact` variant: `"120d"` (table); `long` variant: `"68 days"` (summary card). null → `"—"`. |
| `formatLtv` | `@/utils/formatCompactUsd` | Formats a 4-decimal fraction LTV string as a rounded integer percentage (e.g. `"0.8511"` → `"85%"`). null → `"—"`. |
| `formatOneDecimalRate` | `@/utils/formatCompactUsd` | Formats a decimal-fraction rate/yield string as a one-decimal percentage (e.g. `"0.112000"` → `"11.2%"`). One decimal per issue-717 design decision. null → `"—"`. |
| `HomeStatsStrip` | `@/components/HomeStatsStrip` | Exchange rate / TVL / Current APY stat row extracted from `WelcomeHeader`. Rendered at the top-right of the heading on desktop (inside `WelcomeHeader`) and as a horizontally-scrollable strip at the bottom of the home page on mobile (in `routes/index.tsx`). |

## How to add a row

1. Land the util in code with its `*.test.ts` next to it. Test must cover the cases the call sites rely on.
2. Add a row above with the export name, the `@pipeline/...` import path, and a one-sentence description (what it returns, not how it's implemented).
3. Keep the table sorted alphabetically. If the util is renamed or moved, update the row in the same commit.
