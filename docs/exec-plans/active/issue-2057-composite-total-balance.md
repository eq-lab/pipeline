# Issue #2057: Home: Total Balance headline and graph on the served composite total_balance (PLUSD + sPLUSD value + wire-out escrow)

Source: https://github.com/eq-lab/pipeline/issues/2057

Parent epic: #1419 (LP home screen states). Split from #1282; the piece #1629 deferred
(`docs/exec-plans/completed/issue-1629-lp-portfolio-chart-value.md`). Branch
`feat/2057-composite-total-balance` (draft PR #2102). App: LP (`packages/frontend`).

## Scope

Switch the LP home Total Balance card (`PortfolioPlaceholderCard`, wired in
`packages/frontend/src/routes/index.tsx`) from the sPLUSD-only binding to the served composite
`total_balance` on `GET /v1/positions/history` (spec `docs/product-specs/lp-total-balance.md`).

- **Headline** (`balanceLabel` on every `PortfolioPlaceholderCard` instance, mobile and desktop):
  the latest served bucket's `total_balance`, formatted with `formatMoney(Number(str))`, the same
  formatter the chart tooltip uses, so the headline equals the last bar's tooltip exactly.
  - Latest bucket present but without `total_balance` → `—`. No fallback to `splusd_value`, no
    summing of `plusd_balance` / `wire_out_escrow` / `splusd_value`.
  - No served bucket (query loading, errored, or `history: []`): `$0.00` only when the on-chain
    reads the home route already gates states on say the wallet holds nothing
    (`plusdIsZero && splusdIsZero`, the same zero that states 3 / 7 / `passed-empty` render today);
    otherwise `—`. Nothing is computed: the zero is the documented zero of those served reads, and
    a non-zero wallet without a served composite never shows a false `$0.00`.
- **"Includes PLUSD" label** (spec: "The card labels the total as including PLUSD when
  `plusd_balance` is present"): when the bucket the headline reads carries `plusd_balance`, the
  eyebrow reads `Total Balance · incl. PLUSD` (a nested span in the existing eyebrow, same
  typography and colour tokens). Otherwise the eyebrow is unchanged (`Total Balance`).
- **Graph**: bars and tooltip plot per-bucket `total_balance` instead of `splusd_value`; Y axis from
  the served `total_balance` `SeriesStat` (`max`). Everything else #1629 built is kept: timestamp
  scale, step-interpolated hover, `sampleAxisDatesByTime` dates row, missing bucket → no bar
  (`data-missing`) and `—` tooltip, no axis when the stat is absent, `computeAxisTicks(null)`.
- **No flash on period switch**: the headline now comes from the period-tab query, so a tab switch
  would blank it (and drop the chart to grey placeholder bars) until the new window loads.
  `usePositionsHistory` keeps the previous response as placeholder data while only the window
  changes (same `kind` / `address` / `chainId`), never across a wallet or chain switch.
- **No-wallet states unchanged**: the mobile `ConnectWalletPromoCard`, desktop state 1 (zero),
  state 2 (`unverified`, `connect-wallet` variant, placeholder chart, default `$0.00`) and the
  disconnected `kyb-problem` card render exactly as today (the history query is disabled without a
  wallet, so they keep the `$0.00` zero and placeholder chart).
- **Untouched sPLUSD bindings**: `StakeCard.splusdUsdValue` and `mobileSplusdInPlusd` keep
  `splusdBalanceFormatted` (that card shows the staked position, not the total). `deriveHomeState`,
  `mobileHomeState`, the compact PLUSD balance card and `EarnedCard` are unchanged.
- **Earning delta**: unchanged. The card's caption is `unrealizedPnlLabel`, the served
  `GET /v1/pnl` `total_unrealized_pnl` formatted verbatim by `formatRawDecimalUSD(…, { signed: true,
  suffix: "unrealized" })` (#700); the compact `EarnedCard` reads served `total_pnl`. Both have a
  served source; nothing is derived, so no change and no Open Question.
- Docs and a user-stories doc (see Docs to Update).

Out of scope: backend (#1960 stat coverage), rendering the individual terms (`plusd_balance`,
`wire_out_escrow`) anywhere, the earning caption's binding, Y-axis tick format, placeholder chart
mode, `StakeCard`.

## Assumptions and Risks

- **Figma not read this session.** The Figma MCP server failed to connect and the local Dev Mode
  MCP at `127.0.0.1:3845` did not answer. Funded frame `6701:97136` (state 5) could not be
  inspected, so the plan keeps the existing card chrome exactly (all variants, typography, bar
  design). The only visible addition is the copy suffix inside the existing eyebrow span (no new
  token, size or element style). Its wording `· incl. PLUSD` is the planner's choice: the spec
  mandates the label but not its copy; it is reviewable on the PR (live UI review) and a one-string
  change.
- **#1960 (open backend bug) is a soft dependency, not a blocker.** The `total_balance` stat is
  omitted when any bucket lacks the term (Stellar buckets before the PLUSD bound, pre-price-seed
  buckets). Until #1960 lands, such wallets render bars with no Y axis, exactly as #1629 does for a
  missing `splusd_value` stat. Bar heights then normalise on the max over present values, the
  existing render-only fallback in `PortfolioPlaceholderCard` (never shown as a number).
- **Headline period-dependence.** The spec says the last item of the dense series is the current
  composite because every grid ends at `truncate(now)`, so the latest bucket is the same value for
  every tab and interval rung. The plan relies on that; a tab switch shows the previous window's
  value (placeholder data) until the new one arrives, which should be equal or within one poll.
- **Headline vs on-chain reads.** The headline used to be the live on-chain `convertToAssets`; it is
  now the API's last bucket (indexer- and price-sample-dependent, 30 s poll). After a deposit or
  stake the headline can lag the StakeCard / PLUSD card until the indexer and the next poll catch
  up. Both are served; the lag is accepted, and documented, not patched client-side.
- **State 4 changes visibly.** A PLUSD-only wallet (state 4, `plusd-held`) showed `$0.00` (the
  sPLUSD binding, human decision 2026-10-12 because no combined total existed). With
  `plusd_balance` served it now shows the PLUSD holding plus `· incl. PLUSD`, which is what the
  Figma frame mocks (`$1,000.00`). On a chain where the API does not serve `plusd_balance` (key
  unset, Stellar wallet without a seed), the served total excludes PLUSD; a PLUSD-only wallet
  there typically gets `history: []`, and the headline renders `—` (PLUSD non-zero on chain, no
  served composite), not a false `$0.00`.
- **Wire-out escrow.** Stellar (and EVM only with the PLUSD API key) carries `wire_out_escrow`; the
  plan shows the served total verbatim either way and never inspects the term.
- **Existing tests assume the sPLUSD binding.** `routes/-index.test.tsx` asserts headlines such as
  `$1,000.00` / `$1,001.50` from mocked `convertToAssets` with `mockPositionsHistory.current`
  undefined. Those must be rewritten to serve a history; the zero-state tests (`$0.00` with zero
  balances and no history) keep passing under the zero rule.
- **Live data.** A funded wallet with composite history on the current staging vault is needed for
  the acceptance check; the user or QA provides it. Do not drive the user's browser.
- **Comment rules / line budgets.** Touched files keep their single `// spec:` header; no new
  comments. `docs/product-specs/home-screen-states.md` is at 198/200 lines: replace text in place.

## Open Questions

_None_

## Implementation Steps

1. `packages/frontend/src/components/usePortfolioChart.ts`
   - `buildSeries(history)`: read `item.total_balance` instead of `item.splusd_value`; input type
     becomes `{ timestamp: string; total_balance?: string }[] | undefined`. Missing or non-finite →
     `null` for that bucket; malformed timestamp → `null` series; empty → `null` (unchanged logic).
   - Add a pure exported `latestTotalBalance(history)` returning
     `{ totalBalance: string | undefined; includesPlusd: boolean } | null`: `null` for absent or
     empty history; otherwise reads only the **last** item (`total_balance` verbatim string,
     `includesPlusd = item.plusd_balance !== undefined`). No arithmetic.

2. `packages/frontend/src/api/usePositionsHistory.ts`
   - Add `placeholderData: (previousData, previousQuery) => …` to the `useQuery` options: return
     `previousData` only when `previousQuery.queryKey` has the same `kind`, `address` and `chainId`
     (indices 1–3 of the existing key) as the current key; otherwise `undefined`. Build the key once
     in a local so both sites use it. No other fetch or ladder change.

3. `packages/frontend/src/routes/index.tsx`
   - After `portfolioSeries`, compute
     `const latestTotal = latestTotalBalance(positionsHistory.data?.history);`
     and a `totalBalanceFormatted: string`:
     - `latestTotal !== null`: `latestTotal.totalBalance === undefined || !Number.isFinite(Number(latestTotal.totalBalance))`
       → `"—"`, else `formatMoney(Number(latestTotal.totalBalance))`.
     - `latestTotal === null`: `plusdIsZero && splusdIsZero ? "$0.00" : "—"`.
   - `const totalIncludesPlusd = latestTotal?.includesPlusd ?? false;`
   - Axis: replace `splusdValueMax` with `positionsHistory.data?.total_balance?.max`, same
     `Number.isFinite` guard, same `computeAxisTicks`. No fallback to the `splusd_value` stat.
   - Replace `balanceLabel={splusdBalanceFormatted}` with `balanceLabel={totalBalanceFormatted}` on
     every `PortfolioPlaceholderCard` (mobile instance ~L292, `wallet-only`, `kyb-pending`,
     `plusd-held`, `passed-empty`, `passed-staked`, `kyb-problem`, legacy connected), and pass
     `includesPlusd={totalIncludesPlusd}` alongside (simplest: add both to `portfolioChartProps`
     and the explicit mobile props). The `unverified` instance passes no `balanceLabel` today; leave
     it (no wallet, query disabled, `includesPlusd` is `false`).
   - Keep `splusdBalanceFormatted` for both `StakeCard` instances (`splusdUsdValue`).
   - Import `latestTotalBalance` and `formatMoney` from `@/components/usePortfolioChart`.

4. `packages/frontend/src/components/PortfolioPlaceholderCard.tsx`
   - New optional prop `includesPlusd?: boolean` (default `false`).
   - In the eyebrow span (`Total Balance`, ~L205), when `includesPlusd`, render
     `Total Balance` followed by `<span data-testid="total-balance-includes-plusd"> · incl. PLUSD</span>`
     inheriting the eyebrow's classes (no new tokens). Keep the `Total Balance` text in its own
     text node / span so `getByText("Total Balance")` queries still resolve (wrap it in a span if
     needed).
   - No change to variants, chart branch, tooltip, axis or aria-label logic (the aria-label already
     reads `balanceLabel`).

5. Lint and gates (from the repo root unless noted):
   - `npx tsx scripts/lint-comments.ts` (shrink `scripts/lint-comments.baseline.json` for any touched
     file it lists); `npx tsx scripts/lint-docs.ts`.
   - `cd packages/frontend && npx tsc --noEmit` (or the package typecheck script) and `yarn build`.
   - Vitest as in Test Strategy.

## Test Strategy

Vitest from `packages/frontend`
(`npx vitest run src/components src/routes/-index.test.tsx src/api src/utils`).

- **`components/PortfolioPlaceholderCard.test.tsx`** (and/or `usePortfolioChart.test.ts`)
  - `buildSeries`: `total_balance: "1500.250000"` → `1500.25`, with a different `splusd_value` on the
    same item to prove `splusd_value` is ignored; an item with `splusd_value` but no
    `total_balance` → `null` (no fallback); malformed timestamp → `null`; empty → `null`.
  - `latestTotalBalance`: absent / empty → `null`; reads only the last item; last item without
    `total_balance` → `{ totalBalance: undefined, … }` even when an earlier item has it;
    `includesPlusd` true only when the last item carries `plusd_balance` (including `"0.000000"`).
  - Card: `includesPlusd` renders `total-balance-includes-plusd` with `· incl. PLUSD`; absent/false
    renders none; `Total Balance` text still queryable. Existing #1629 tests (time axis, hover,
    `data-missing`, `—` tooltip, uniform-grid regression) pass with fixtures moved to
    `total_balance`.
- **`routes/-index.test.tsx`** (uses the configurable `mockPositionsHistory.current`)
  - Served history whose last item has `total_balance: "1500.250000"`, `splusd_value:
    "1000.000000"`, `plusd_balance: "500.250000"`, plus stat `total_balance.max: "2000.000000"` and a
    different `splusd_value.max`: headline `$1,500.25` on the mobile and desktop cards, eyebrow
    shows `· incl. PLUSD`, Y axis `$2K / $1K / $0` (from `total_balance.max`), `StakeCard` still
    shows the `convertToAssets` value.
  - Last item without `plusd_balance` → no `incl. PLUSD` suffix.
  - Last item without `total_balance` (but with `splusd_value`) → headline `—`, never the
    `splusd_value`; a response without the `total_balance` stat (but with the `splusd_value`
    stat) → no Y axis.
  - A bucket without `total_balance` mid-series → `[data-bar-slot][data-missing="true"]`.
  - No served history + non-zero on-chain sPLUSD → headline `—` (replaces the #1658 `$1,001.50`
    headline assertion; keep its StakeCard `$1,001.50` assertion). Rewrite "Case 1" (PLUSD held, 0
    sPLUSD) and "Case 2" headline assertions to serve a history.
  - Zero-balance states (3, 7, `passed-empty`, Case 3) with no history keep `$0.00`; no-wallet
    states (1, 2, disconnected `kyb-problem`, mobile promo) unchanged, no `incl. PLUSD`, no
    series bars.
  - `state 4` (`plusd-held`) with a served composite shows the served total, not `$0.00`.
- **`api/usePositionsHistory.test.tsx`**: switching the period keeps the previous `data` while the
  new window loads (pending fetch), then replaces it; switching wallet address (or chain) does not
  carry data over (`data` undefined while loading).
- **Manual, staging** (user / QA supplies a funded Stellar wallet on the current vault): Network
  tab `/v1/positions/history` last item's `total_balance` equals the headline; each bar's tooltip
  equals its bucket's served value; a bucket missing the term shows a gap and `—`; the
  `incl. PLUSD` suffix appears iff the last item has `plusd_balance`; disconnect → no graph. Ask the
  user to report; do not drive their browser.
- **Figma (styles only)**: compare the funded card against `6701:97136` (state 5) and the compact
  variants against `6701:98528` / `6701:97451` when the Figma MCP is reachable; no chrome change is
  expected besides the eyebrow suffix.

## Docs to Update

- `docs/frontend/dashboard-components.md`
  - § Home route "Headline value is assets, not shares (#1658)" (~L1609): the card `balanceLabel` is
    now the latest served `total_balance` (#2057) with the zero / `—` rule above; `StakeCard`
    keeps `splusdBalanceFormatted`; the headline can lag on-chain reads by the indexer + poll.
  - § PortfolioPlaceholderCard: `get-plusd` paragraph ("formatted zero sPLUSD balance") and
    `stake-or-add-usd` paragraph (L376–379, "no combined-total endpoint exists") → the served
    composite; **Served series mode** (L394–401) → `total_balance` per bucket, drop "headline is
    convertToAssets … can differ slightly" and "composite is #1282's scope", note headline ==
    last bucket; **Y axis** (L431–434) → `total_balance.max`, no axis when absent (any bucket
    lacks `total_balance`, see #1960); **Data rule** (L468–469); add the `includesPlusd` prop and
    the `· incl. PLUSD` eyebrow rule; note the placeholder-data behaviour of `usePositionsHistory`
    in the All-tab / served-series paragraph.
  - Rows ~L1675, L1688 (`sPLUSD binding unchanged`), L1712 (`balanceLabel={splusdBalanceFormatted}`)
    and the home-route paragraph ~L1779 (`splusd_value` history / `splusd_value.max`).
- `docs/product-specs/home-screen-states.md` (stay ≤ 200 lines, edit in place): state 7 (L120,
  "keeps the sPLUSD-position binding"), state 3 (L177–178) and state 4 (L185–189, "No endpoint
  serves a combined PLUSD+sPLUSD total … out of scope for #1424") → the headline is the served
  composite `total_balance` (#2057), labelled `incl. PLUSD` when the API serves `plusd_balance`,
  `$0.00` for a zero wallet without history, `—` otherwise.
- `docs/product-specs/lp-total-balance.md` L7: correct "the 'earning' delta on the card keeps
  binding to `total_pnl`" to the shipped bindings (card caption `total_unrealized_pnl`, Earnings
  card `total_pnl`), no behaviour change; optionally name the label copy in the "labels the total
  as including PLUSD" sentence.
- New `docs/user-stories/epic-1419/2057-home-composite-total-balance.md` (format of
  `1819-home-passed-unlocked-card.md`: epic, issue, spec links, Figma `6701:97136`, stories for
  funded headline = last bucket, incl. PLUSD label, gap bucket, missing stat → no axis (#1960),
  zero wallet `$0.00`, no-wallet states unchanged), and its row in `docs/user-stories/index.md`
  under epic #1419.
- `docs/frontend/hooks.md`: only if it documents `usePositionsHistory` options/fields, add the
  placeholder-data rule.
