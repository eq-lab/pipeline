# Issue #1819: Home: show the "Transfers unlocked / Add Funds" card for every signed-in, wallet-connected, KYB-passed LP

Source: https://github.com/eq-lab/pipeline/issues/1819

Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-97494&m=dev
— node `6701:97494` (`card-horizontal`, 313.14 × 246: "Add USD" / "Use a bank transfer" /
"Transfers unlocked" / circular `Add Funds`). Parent frame: state 4, `6701:97340`.

## Scope

**What exists.** `AddUsdCard variant="unlocked"` (`packages/frontend/src/components/AddUsdCard.tsx`,
`data-node-id="6701:97494"`) already matches the frame pixel-for-pixel (#1424, verified by QA). The
home route (`packages/frontend/src/routes/index.tsx`) mounts it only in the `"plusd-held"` branch,
which `deriveHomeState` (`packages/frontend/src/components/homeState.ts`) returns for session +
connected wallet + `lpRead === "loaded"` + `kyb_status === "Passed"` + PLUSD displayed non-zero +
sPLUSD displayed zero. Every other `Passed` + connected combination returns `"legacy"`, whose grid
has no Add-USD slot (col 3–4 row 2 is the full `StakeCard`).

**What changes.** Two new `HomeState` values and two new desktop grid branches, so a signed-in,
connected, `Passed` LP always sees the `unlocked` card:

| New state | Condition (all of) | Composition |
| --- | --- | --- |
| `"passed-empty"` | session · `isConnected` · `lpRead === "loaded"` · `kybStatus === "Passed"` · `plusdIsZero` · `splusdIsZero` | State-3 (`"kyb-pending"`) grid with one card swap: `AddUsdCard variant="unlocked" className="flex-1"` instead of `verifying` (the same "reuse + one swap" pattern states 6 and 7 use). Hero `PortfolioPlaceholderCard variant="get-plusd"` (served `$0.00`), `CompactBalances {...compactWalletActions}` (Buy enabled, Sell + Stake disabled by the served zero balances), right stack `CompactAddUsdStack` → `unlocked` + `EarnedCard layout="compact"`. |
| `"passed-staked"` | session · `isConnected` · `lpRead === "loaded"` · `kybStatus === "Passed"` · `!splusdIsZero` (any PLUSD) | **Pending Open Question 1.** Recommended interim: the state-4 grid geometry with the connected hero — `PortfolioPlaceholderCard` default variant (`mobileHomeState`, `balanceLabel={splusdBalanceFormatted}`, `unrealizedPnlLabel`, chart props), `CompactBalances` with `compactVariant="balance"` + `compactBalanceLabel={plusdFormattedActive}` when PLUSD is non-zero and the default compact pair otherwise, right stack `CompactAddUsdStack` → `unlocked` + compact `EarnedCard earnedPnlLabel`. |

No Figma frame exists for either combination as a whole: the designed frame for "Passed + sPLUSD >
0" is state 5 (`6701:97136`, #1425, **blocked** by user decision 2026-10-12), and it shows the
`funded` card plus a compact "Staked PLUSD / 1,000.00 / Stake More / Unstake" card
(`6701:97273`) that does not exist in code (the compact `StakeCard` has only the marketing
variant). Nothing here pre-empts #1425: when it lands, `"passed-staked"` becomes state 5 and the
`funded` card swap is #1820.

`"plusd-held"` (state 4) is untouched. `Passed` with the wallet **disconnected** stays `"legacy"`
(the issue requires a connected wallet; no frame exists). Precedence: the two new branches are
evaluated after `"plusd-held"` and before `"kyb-problem"` (disjoint statuses, so order among the
three is immaterial; placing them together keeps the `Passed` family adjacent).

**Add Funds** keeps opening `FundingDetailsModal` with no `details` (every row `—`), exactly as
state 4 does today; wiring real bank details and the payment reference is #1817.

### Out of scope

- The `funded` variant (`6701:97289`) — #1820, blocked on the trust-account balance endpoint (#1285).
- The compact "Staked PLUSD" balance card (`6701:97273`) and the rest of state 5 — #1425.
- Mobile: the mobile block never reads `homeState` (decision recorded on #1421, reapplied through
  #1460); it stays `isConnected`-driven. No mobile frame exists for the unlocked card.
- Real wire details / payment reference in the modal — #1815 / #1817.
- `Passed` + disconnected wallet, and `NotStarted` + connected — undesigned, still `"legacy"`.

## Assumptions and Risks

- **Served data only.** The gate is `useAuthSession().isAuthenticated`, the wallet connection,
  `lpRead`/`kybStatus` from `useAuthFlow()` and the two `isDisplayZero` balance inputs the route
  already computes. No new request, no client-derived "transfers unlocked" flag.
- **TD-121 flicker.** An unresolved PLUSD/sPLUSD balance reads as displayed-zero, so a `Passed`
  LP who holds PLUSD may render `"passed-empty"` for the moment before the balance resolves, then
  settle into `"plusd-held"`. Same shape as today's state-3/4 flicker; the `AddUsdCard` is the same
  in both, so the swap is only the hero and the Buy/Sell pair.
- **Existing regression tests flip by design.** `-index.test.tsx` "kybStatus Passed keeps the legacy
  connected layout" (KYB-pending regressions, zero balances) and "a non-zero sPLUSD balance keeps the
  legacy connected layout" (plusd-held regressions) assert the behaviour this issue removes; they are
  rewritten, not deleted (see Test Strategy). `homeState.test.ts` "returns legacy when … LP loaded
  with an undesigned status" passes no `kybStatus`, so it still holds.
- **Information loss in `"passed-staked"` (if Open Question 1 → interim).** The legacy grid's full
  `StakeCard` shows the staked value and an `Unstake` entry; the compact `StakeCard` shows the APY
  marketing copy and `Stake` only. The hero still shows the sPLUSD value in PLUSD
  (`splusdBalanceFormatted`, #1658) and `Unstake` remains on `/stake?tab=unstake`. Log as a TD entry
  (next free number is TD-161) closed by #1425.
- **Figma MCP.** The local Dev Mode server (127.0.0.1:3845) answered during planning; the card
  node's `get_design_context` is only needed for QA screenshots since no new styling is written.
- **Dev mock.** `pipeline.mock.*` localStorage keys drive the tests only; nothing new is mocked.

## Open Questions

1. **`Passed` + sPLUSD > 0 (any PLUSD) — what renders until #1425 ships?**
   (a) *Recommended:* the interim `"passed-staked"` composition above — the LP sees the
   `unlocked` card and the connected hero, but the home grid temporarily loses the full
   `StakeCard`'s staked-value line and `Unstake` button (both still on `/stake`); logged as TD-161.
   (b) Keep `"legacy"` for staked LPs — no information loss, but a staked `Passed` LP sees no
   "Transfers unlocked / Add Funds" card on the home grid until state 5 lands.
   (c) Unblock #1425 and build state 5 now with `unlocked` standing in for `funded` — the largest
   scope (new compact staked-balance card `6701:97273`, hero per `6701:97247`).

## Implementation Steps

1. **Derivation** — `packages/frontend/src/components/homeState.ts`: extend `HomeState` with
   `"passed-empty" | "passed-staked"`. After the `"plusd-held"` block add
   `if (isConnected && lpRead === "loaded" && kybStatus === "Passed" && plusdIsZero && splusdIsZero) return "passed-empty";`
   and (per Open Question 1a) `if (isConnected && lpRead === "loaded" && kybStatus === "Passed" && !splusdIsZero) return "passed-staked";`.
   Keep the header comment pointing at `home-screen-states.md`.
2. **Route branch `"passed-empty"`** — `packages/frontend/src/routes/index.tsx`: add a
   `homeState === "passed-empty"` branch between `"plusd-held"` and `"kyb-problem"`, copied from the
   `"kyb-pending"` branch with the right stack replaced by
   `<CompactAddUsdStack nodeId="6701:97493"><AddUsdCard variant="unlocked" className="flex-1" onAddFunds={onAddFunds} data-testid="home-add-usd-card" /></CompactAddUsdStack>`.
   Hero `PortfolioPlaceholderCard variant="get-plusd" balanceLabel={splusdBalanceFormatted} {...portfolioChartProps}`,
   `balancesNodeId="6701:98773"`, `balances={<CompactBalances {...compactWalletActions} />}`,
   `activityPadding="md"`. The stack/balances node ids name the frames whose geometry is reused
   (state 4's Add-USD stack, state 3's balances stack); record that in the spec table.
3. **Route branch `"passed-staked"`** (Open Question 1a) — same file: hero
   `<PortfolioPlaceholderCard mobileHomeState={mobileHomeState} balanceLabel={splusdBalanceFormatted} unrealizedPnlLabel={unrealizedPnlFormatted} {...portfolioChartProps} />`;
   `balances={<CompactBalances {...compactWalletActions} {...(plusdIsZero ? {} : { compactVariant: "balance", compactBalanceLabel: plusdFormattedActive })} />}`
   (hoist `plusdIsZero`/`splusdIsZero` into named consts so the route and `deriveHomeState` share
   one computation); right stack identical to step 2 but with
   `<EarnedCard layout="compact" earnedPnlLabel={earnedPnlLabel} …>` — `CompactAddUsdStack`
   currently hard-codes the compact `EarnedCard` with no label, so add an optional
   `earnedPnlLabel?: string` prop to `CompactAddUsdStack` in `-HomeDashboardGrid.tsx` and pass it
   through (omitted everywhere else → unchanged markup). If 1b is chosen, skip this step and keep
   `"legacy"`; if 1c, the plan is superseded by #1425's.
4. **Comment lint** — no new comments beyond the existing file headers; run
   `npx tsx scripts/lint-comments.ts` and shrink `scripts/lint-comments.baseline.json` if a touched
   file is listed.
5. **Docs** — see "Docs to Update". Write the user-stories doc
   `docs/user-stories/epic-1419/1819-home-passed-unlocked-card.md` (format of
   `1424-home-plusd-held-state.md`: Persona / Pre-conditions / Steps / Expected, one story per
   combination plus the modal story and the state-4 non-regression story) and add its row to
   `docs/user-stories/index.md` under epic #1419.
6. **Verification** — `yarn --cwd packages/frontend lint`, `yarn --cwd packages/frontend build`
   (regenerate `routeTree.gen.ts` first only if a route file is added — none is), `vitest` for
   `packages/frontend`, `npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts`.
   Figma check: `get_screenshot` of node `6701:97494` against the rendered card in the new branches
   (identical component, so this is a non-regression check), and the `6701:98417` frame for the
   `"passed-empty"` grid geometry (same geometry as state 3 with one card swapped).

## Test Strategy

- `packages/frontend/src/components/homeState.test.ts`:
  - `Passed` + connected + both zero → `"passed-empty"`.
  - `Passed` + connected + sPLUSD non-zero, PLUSD zero → `"passed-staked"`; PLUSD non-zero too →
    `"passed-staked"` (1a) / `"legacy"` (1b).
  - `Passed` + connected + PLUSD non-zero + sPLUSD zero → still `"plusd-held"` (precedence).
  - `Passed` + disconnected → still `"legacy"`; `Passed` + `lpRead: "error"` → `"legacy"`;
    `lpRead: "unknown"` → `"loading"`.
- `packages/frontend/src/routes/-index.test.tsx`:
  - New `describe("Home page — passed-empty state (#1819)")`: session + `Passed` + connected, no
    balances set → `home-add-usd-card` has `data-variant="unlocked"` and `data-node-id="6701:97494"`,
    text "Transfers unlocked"; hero `data-variant="get-plusd"`; Sell and Stake disabled, Buy
    enabled; grid occupancy (StartHere + Stake in `home-balances-stack`, AddUsd + Earned in
    `home-add-usd-stack`); clicking `Add Funds` opens `funding-details-modal` with `—` rows.
  - New `describe("Home page — passed-staked state (#1819)")` (1a): sPLUSD balance set → unlocked
    card present, hero shows the sPLUSD value; with PLUSD also set the StartHere card is in balance
    mode (`PLUSD Balance`, Buy and Sell enabled).
  - Rewrite the two flipped regressions: "kybStatus Passed keeps the legacy connected layout" →
    "kybStatus Passed with zero balances renders the passed-empty grid"; "a non-zero sPLUSD balance
    keeps the legacy connected layout" → the 1a/1b outcome.
  - Keep: state-4 block unchanged; `Passed` + disconnected still legacy; `lpRead` error still legacy.
- `AddUsdCard.test.tsx`: unchanged (component untouched).

## Docs to Update

- `docs/product-specs/home-screen-states.md`: add rows 4a/4b (or 8/9) to the states table with the
  conditions above and "Implemented (#1819)"; in the precedence section replace the state-4
  paragraph's "`Passed` with PLUSD also display-zero, `Passed` with sPLUSD non-zero … fall through to
  `"legacy"`" with the new rule; keep "`Passed` with no wallet connected … `"legacy"`"; note that
  "Bank transfer unlocked" is the `Passed` rendering for every connected `Passed` combination.
- `docs/frontend/dashboard-components.md#home-route`: add the `"passed-empty"` (and 1a
  `"passed-staked"`) branch tables after the `"plusd-held"` table; extend the `HomeState` union and
  the derivation paragraph (issues list + the `"legacy"` coverage sentence); `CompactAddUsdStack`
  `earnedPnlLabel` prop if step 3 lands.
- `docs/frontend/bank-transfers.md#addusdcard`: "`unlocked` ships on `/` for home state 4 (#1424) **and
  for every other connected `Passed` combination (#1819, `"passed-empty"` / `"passed-staked"`)**".
- `docs/user-stories/epic-1419/1819-home-passed-unlocked-card.md` + `docs/user-stories/index.md` row.
- `docs/exec-plans/tech-debt-tracker.md`: TD-161 (1a only) — compact staked-balance card missing
  from the interim `"passed-staked"` grid; closed by #1425.
- Move this plan to `docs/exec-plans/completed/` at completion with a Decision log recording the
  Open Question 1 answer.
