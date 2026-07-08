# Frontend utils

Catalogue of shared frontend utility helpers. Governed by [`docs/FRONTEND.md` → Code structure rules](../FRONTEND.md#code-structure-rules).

**Inclusion criteria.** A helper appears here when it is used in two or more places and has been lifted into a dedicated module under `packages/frontend/src/utils/` or `packages/ui/src/utils/`. Every entry must ship with unit tests in the same commit that adds it.

**Trustee app.** `packages/trustee/` does not depend on `@pipeline/frontend` (epic #775 keeps the two apps separate), so it has its own `src/utils/` with deliberately duplicated formatters where the LP equivalent isn't importable. These are marked "(trustee)" below; see `docs/exec-plans/tech-debt-tracker.md` for the cross-package consolidation debt this creates.

Entries are sorted alphabetically by name.

| Name | Import path | Description |
|------|-------------|-------------|
| `CACHE_FOREVER` | `@/wallet` (internal: `src/wallet/evm/cache.ts`) | Wagmi query options preset for "fetch once per page lifetime" reads (immutable-in-practice on-chain data). Sets `staleTime: Infinity`, `gcTime: Infinity`, and disables all automatic refetch triggers. |
| `formatCompactUsd` | `@/utils/formatCompactUsd` | Formats base-6 decimal-string USDC amounts (already in human units, e.g. `"8000000.000000"`) as compact dollar notation (`"$8.0M"`, `"$500.0K"`). Do NOT pass raw sub-unit bigints. null/undefined/non-numeric → `"—"`. |
| `formatCompactUsd` (trustee) | `@/utils/formatUsd` (`packages/trustee/src/utils/formatUsd.ts`) | Trustee-local port of the LP `formatCompactUsd`, tuned to the Overview page's Capital Allocation legend precision (trims trailing decimal zeros: `"96000000.000000"` → `"$96M"`, `"8400000.000000"` → `"$8.4M"`, `"4950000.000000"` → `"$4.95M"`). null/undefined/non-numeric → `"—"`. |
| `formatFullUsd` (trustee) | `@/utils/formatUsd` (`packages/trustee/src/utils/formatUsd.ts`) | Formats a base-6 decimal-string USD amount as fully-expanded whole dollars with thousands separators, for the Capital Allocation card's big total (`"115190000.000000"` → `"$115,190,000"`). null/undefined/non-numeric → `"—"`. |
| `formatCoverage` | `@/utils/formatCompactUsd` | Formats a 2-decimal ratio string as a one-decimal `"x"` suffix (e.g. `"1.50"` → `"1.5x"`). null → `"—"`. |
| `formatEstimatedWaitDays` | `@/utils/formatCompactUsd` | Formats the `estimated_wait_days` string from the withdrawal-queue API as `"~3.2 days"`. null/non-numeric → `"—"`. |
| `formatDurationDays` | `@/utils/formatCompactUsd` | Formats a duration in whole days. `compact` variant: `"120d"` (table); `long` variant: `"68 days"` (summary card). null → `"—"`. |
| `formatLtv` | `@/utils/formatCompactUsd` | Formats a 4-decimal fraction LTV string as a rounded integer percentage (e.g. `"0.8511"` → `"85%"`). null → `"—"`. |
| `formatOneDecimalRate` | `@/utils/formatCompactUsd` | Formats a decimal-fraction rate/yield string as a one-decimal percentage (e.g. `"0.112000"` → `"11.2%"`). One decimal per issue-717 design decision. null → `"—"`. |
| `HomeStatsStrip` | `@/components/HomeStatsStrip` | Exchange rate / TVL / Current APY stat row extracted from `WelcomeHeader`. Rendered at the top-right of the heading on desktop (inside `WelcomeHeader`) and as a horizontally-scrollable strip at the bottom of the home page on mobile (in `routes/index.tsx`). |
| `periodToQuery` | `@/utils/statsPeriod` | Maps a time-range period id (`"7d"`, `"1m"`, `"3m"`, `"1y"`, `"all"`) to the API query params `{ days?, interval }` for `/v1/stats/prices` and `/v1/stats/yield`. Unknown ids fall back to weekly (full-history). Shared by `useStatsPrices` and `useStatsYield`. |
| `truncateAddress` | `@/utils/truncateAddress` | Truncates a wallet address (EVM `0x…` or Stellar `G…`) to `first6…last4` form (e.g. `"0x8493…3b92"`). Strings ≤ 12 chars returned as-is. Used by `useAccountDropdown` and `useWithdrawalQueuePanel`. |
| `STATS_PERIODS` | `@/utils/statsPeriod` | Array of the five canonical stats period descriptors `[{id, label}]`. Used to render the SegmentedTabs on stats charts. |
| `accrualToBars` | `@/utils/yieldSeries` | Converts a `SampleYieldItem[]` from `GET /v1/stats/yield` into a 100-slot `YieldBarPoint[]` normalised to the max `accrued` value. Returns `null` on empty/invalid input so callers can show the empty state. |
| `latestAccrued` | `@/utils/yieldSeries` | Returns the most-recent cumulative `accrued` value (human-unit dollars) from a `SampleYieldItem[]` by timestamp. Returns `null` on empty/invalid input. |
| `pointsToBars` | `@/utils/yieldSeries` | Generic series adapter: converts a `[{ timestamp: string; value: string }]`-shaped array into a 100-slot `YieldBarPoint[]` normalised to the max value. Callers map domain field names to `value` at the call site (e.g. `cumulative_yield`, `tvl`). Returns `null` on empty/invalid/all-zero input. Used by the TVL and dashboard yield-history series (issue #760). |

## How to add a row

1. Land the util in code with its `*.test.ts` next to it. Test must cover the cases the call sites rely on.
2. Add a row above with the export name, the `@pipeline/...` import path, and a one-sentence description (what it returns, not how it's implemented).
3. Keep the table sorted alphabetically. If the util is renamed or moved, update the row in the same commit.
