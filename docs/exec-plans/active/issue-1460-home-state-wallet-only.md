# Issue #1460: Home state 7: wallet connected, not signed in, PLUSD = 0, sPLUSD = 0

Source: https://github.com/eq-lab/pipeline/issues/1460

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=7149-16033&m=dev
— frame `7149:16033` "Wallet connected: PLUSD = 0, sPLUSD = 0"

## Scope

The seventh and last home state of epic #1419: a visitor who has connected a wallet, has **no**
auth session, and whose connected wallet holds neither PLUSD nor sPLUSD. It takes precedence over
state 1 (zero state), which from now on requires both no session **and** no wallet.

In scope:

- A new `"wallet-only"` member of `HomeState` and the precedence change in `deriveHomeState`
  (`packages/frontend/src/components/homeState.ts`) — the `!hasSession` short-circuit stops
  returning `"zero"` unconditionally.
- A seventh desktop grid branch in `packages/frontend/src/routes/index.tsx`.
- `Start Verification` wired to `useAuthFlow().openAddEmail()` (#1459) instead of
  `openAccountSetup()` — the latter is a **no-op without a session** (see Assumptions).
- Spec, component-doc and user-story updates, including the rewrite of Story 3 of
  `docs/user-stories/epic-1419/1421-home-zero-state.md`, which this state supersedes.

Out of scope / explicitly no work:

- **The header.** #1458 already keys `TopBar`/`MobileNavMenu` on
  `useWalletPresence().isAnyConnected || isAuthenticated`, so the account icon (Figma `7149:16828`)
  already renders for this visitor. This issue must only not regress it; the home route does not
  render `TopBar`.
- **The Add email screen itself.** Shipped by #1459 (`openAddEmail()` → `EmailAuthFlow` on its
  `"add-email"` screen). This issue only calls the seam.
- **Mobile.** No change — see "Mobile" below for why the existing stack already renders this
  visitor correctly.
- **The desktop `Welcome` heading.** The frame reads "Welcome back"; the shipped desktop heading
  reads "Welcome". This is an accepted, documented difference from #1421/#1422
  (`docs/exec-plans/completed/issue-1422-home-state-unverified.md`, row `6701:97540`). Do not
  "fix" it, and do not let it be filed as a state-7 defect.
- **State 5** (verified, funded, staked, #1425) — still unimplemented; the `"legacy"` branch and
  the mobile stack keep today's taller cards until it lands.

### What the frame actually is

`get_metadata` on `7149:16033` resolves to **state 3's composition verbatim with exactly one card
swap**. Geometry read off the frame (`Content` 1200×803, cards inset 32 → 1136 content box):

| Figma node | Box | Slot | Component |
| --- | --- | --- | --- |
| `7149:16142` Portfolio | 643×274 @ (32,32) | col 1–4, row 1 | `PortfolioPlaceholderCard variant="get-plusd"` |
| `7149:16043` Section | 477.71×634 @ (690.29,32) | col 5–7, row-span-2 | `RecentActivityCard padding="md"` |
| `7149:16787` | 313.14×344 @ (32,322) | col 1–2, row 2 | `StartHereCard layout="compact"` (`7149:16788`, 164) + `StakeCard layout="compact"` (`7149:16803`, 164), `gap-4` |
| `7149:16152` | 313.14×344 @ (361.14,322) | col 3–4, row 2 | `AddUsdCard variant="verify"` (`7149:17726`, 246) + `EarnedCard layout="compact"` (`7149:16776`, 82), `gap-4` |
| `7149:16143` FAQ | 1136×89 @ (32,682) | col 1–7, row 3 | `QnaSection` |

Text pulled from `get_design_context` on each node matches the shipped components **exactly** —
"Total Balance" / `$0.00` / "Get PLUSD to start"; "Recent activity"; "Start here" / "Get PLUSD" /
"Convert with USDC 1:1" / "Buy" / "Sell"; "Stake PLUSD" / "Earn 8.42% p.a." / "From senior loan
coupons and T-bills" / "Nothing to Stake"; "Verify your account" / "Complete KYB to unlock bank
transfers." / "Start Verification"; "Earnings" / "Tracked once you stake"; "Questions & answers".

Button treatment on the frame: `Buy` is the default navy (it carries neither the `opacity-32` nor
the `rgba(184,191,190,0.12)` tint), `Sell` is `7149:16802` at `opacity-32`, and `Nothing to Stake`
is `7149:16816`, tinted **and** at `opacity-32`. That is states 1–3's treatment, **not** state 4's
tinted-Buy/ink-muted-Sell pair — so the branch must **not** pass `compactVariant="balance"`.

`get_variable_defs` on `7149:16042` resolves `radius/radius-s` = `4` and `radius/radius-xxl` = `4`,
matching the shipped `--radius-pipeline-card` / `--radius-pipeline-button`. The 8px/24px literals
in the codegen output are stale fallbacks (same finding as #1423/#1424). **No new geometry work:
this state is composition of already-pixel-matched parts.**

### Decisions taken by this plan

1. **`isConnected` is the active-view connection** (`useWalletView().kind` → EVM or Stellar), the
   same input states 3/4/6 already use — **not** `useWalletPresence().isAnyConnected`, which the
   header uses. Rationale: state 7's condition includes "PLUSD = 0 and sPLUSD = 0", and balances,
   `usePositionsHistory`, `usePnl` and `useRequests` are all read from the **active view's** chain.
   Under `isAnyConnected` a Stellar-connected visitor whose view is EVM would render a `$0.00`
   headline for a chain we never read (a value not served — forbidden), with `Buy`,
   `Get PLUSD to start` and the chart all pointed at an unconnected namespace. Under the
   active-view rule the same visitor keeps the zero state, whose CTAs all work. The consequence —
   header account icon alongside a "Sign Up" zero-state grid for a Stellar-first visitor with the
   default EVM view — is logged as tech debt, not fixed here.
2. **The Total Balance headline keeps the sPLUSD-position binding** (`splusdBalanceFormatted` =
   `formatBigintCurrency(splusdSharesActive, activeDecimals)`), which reads `$0.00` here because
   sPLUSD is zero — a served value, not a default. This is #1424's human decision (no endpoint
   serves a combined total; summing client-side is the forbidden derived metric) applied unchanged.
3. **`Buy` and `Get PLUSD to start` both navigate to `/deposit?direction=deposit`** for this
   visitor, exactly as they do for any connected visitor today. `/deposit` carries no `beforeLoad`
   auth guard, so no session is required; the route's existing `onBuy` already does this when
   `isConnected`. No new wiring.

## Assumptions and Risks

- **`openAccountSetup()` cannot be reused.** In `AuthFlowProvider`, `setup` is `null` whenever
  there is no token, and `openAccountSetup` is
  `setSetup(prev => prev ? {...prev, open: true} : prev)` — a silent no-op for a sessionless
  visitor. Reusing state 2's wiring would ship a dead `Start Verification` button. `openAddEmail()`
  (`open("add-email")`) has no session dependency and is the correct seam. This is the one wiring
  the coder must actually change, not copy.
- **The `@/auth` mock in `routes/-index.test.tsx` does not expose `openAddEmail`.** Its
  `useAuthFlow()` returns only `{ open, close, lpRead, kybStatus, openAccountSetup }`. The coder
  must add a hoisted `mockOpenAddEmail` to that mock (the `-account.test.tsx` mock is the
  template), or the new branch will throw on click.
- **Sessionless visitor, non-zero balance → state 1.** Recorded on the Issue as an assumption to be
  overridden on the Issue; no comment overrode it (the Issue has zero comments as of 2026-10-12).
  The implementation gets this for free: `deriveHomeState`'s balance inputs default to `false`
  (i.e. "not zero"), so an unpassed or non-zero balance can never promote a sessionless caller into
  `"wallet-only"`.
- **Post-registration landing regresses to `"legacy"`.** After `Start Verification` → Add email →
  OTP → session, the visitor is signed-in + connected + `lpRead: "absent"`, which state 2 requires
  to be **disconnected**, so `deriveHomeState` returns `"legacy"` — today's pre-#1419 taller-card
  layout, with no `AddUsdCard` at all. This is the documented undesigned combination
  (`home-screen-states.md`, state 2 paragraph), not a regression introduced here, but #1460 makes
  it reachable in one click for the first time. It must be written into the user-story doc as the
  expected follow-on so QA does not file it, and logged as tech debt.
- **`RecentActivityCard` is data-driven, not forced empty.** `useRequests` is enabled on
  `isConnected && !!address` (no session needed) and fires `/v1/requests?wallet=…`. A wallet with
  zero balances but past requests would render rows rather than the frame's placeholder. Identical
  wiring to state 3; accepted, not worked around.
- **Three existing `deriveHomeState` assertions are affected** (see Test Strategy) — two flip to
  `"wallet-only"` and one becomes misleadingly named. Missing them is the most likely way this
  change lands red.
- **No backend dependency.** `/v1/stats`, `/v1/positions/history`, `/v1/pnl` and `/v1/requests` are
  all wallet/public-keyed, not bearer-gated; `GET /v1/lps/me` is never issued without a token, so
  `lpRead` stays `"unknown"` and is simply not part of this state's condition.
- **Dependencies, all merged:** #1458 (PR #1466, header + wallet-only `/account`) and #1459
  (PR #1467, Add email screen). The worktree branch `feat/home-state-wallet-only` is cut from main
  after both. No unmerged blocker.

## Open Questions

_None_

## Implementation Steps

1. **`packages/frontend/src/components/homeState.ts`** — add `"wallet-only"` to the `HomeState`
   union (after `"zero"`, mirroring the spec's state order) and replace the short-circuit

   ```ts
   if (!hasSession) return "zero";
   ```

   with

   ```ts
   if (!hasSession) {
     return isConnected && plusdIsZero && splusdIsZero ? "wallet-only" : "zero";
   }
   ```

   Nothing else in the function changes: every signed-in branch below is untouched, and every
   sessionless visitor still resolves to exactly one of `"zero"` / `"wallet-only"` — a sessionless
   caller can never reach `"unverified"` / `"kyb-*"`. Keep the single spec-pointer header comment;
   add no others.

2. **`packages/frontend/src/routes/index.tsx` — destructure the new seam.** Add `openAddEmail` to
   the existing `useAuthFlow()` destructure alongside `openAccountSetup`. Add **no** new hook,
   state, handler or balance read: `stakeDisabled` (`isConnected && plusdIsZero` → `true`),
   `sellDisabled` (`!isConnected || plusdIsZero` → `true`), `onBuy` (connected → `/deposit`),
   `splusdBalanceFormatted` (`$0.00`), `portfolioSeries` / `portfolioAxis` / `portfolioPeriodId`
   already produce exactly what the frame shows. Verify this, do not rewrite it.

3. **`packages/frontend/src/routes/index.tsx` — add the `homeState === "wallet-only"` grid
   branch**, placed in the ternary chain immediately after the `"zero"` branch (so the JSX order
   mirrors the spec's precedence table; behaviourally the order is irrelevant since
   `deriveHomeState` returns one value). Copy the `"kyb-pending"` branch and make exactly one
   change — the `AddUsdCard`:

   ```
   <div className="grid w-full grid-cols-7 gap-4" data-testid="home-dashboard-grid">
     <PortfolioPlaceholderCard
       className="col-span-4 row-start-1"
       variant="get-plusd"
       balanceLabel={splusdBalanceFormatted}
       activePeriodId={portfolioPeriodId}
       onActivePeriodChange={setPortfolioPeriodId}
       series={portfolioSeries}
       yAxis={portfolioAxis}
       yAxisDomainMax={portfolioAxisMax}
       data-testid="home-portfolio-placeholder"
     />

     <div className="relative col-span-3 col-start-5 row-span-2 row-start-1">
       <RecentActivityCard
         className="!absolute inset-0 min-h-0 overflow-hidden"
         padding="md"
         data-testid="home-recent-activity-card"
       />
     </div>

     <div
       className="col-span-2 col-start-1 row-start-2 flex flex-col gap-4"
       data-node-id="7149:16787"
       data-testid="home-balances-stack"
     >
       <StartHereCard layout="compact" onBuy={onBuy} onSell={onSell} sellDisabled={sellDisabled} data-testid="home-start-here-card" />
       <StakeCard layout="compact" onStake={onStake} onUnstake={onUnstake} stakeDisabled={stakeDisabled} data-testid="home-stake-card" />
     </div>

     <div
       className="col-span-2 col-start-3 row-start-2 flex flex-col gap-4"
       data-node-id="7149:16152"
       data-testid="home-add-usd-stack"
     >
       <AddUsdCard variant="verify" onStartVerification={openAddEmail} data-testid="home-add-usd-card" />
       <EarnedCard layout="compact" data-testid="home-earned-card" />
     </div>

     <div className="col-span-7 col-start-1 row-start-3" data-testid="home-qna-wrapper">
       <QnaSection />
     </div>
   </div>
   ```

   Notes the coder must not deviate from:
   - **No `compactVariant="balance"`** on `StartHereCard` — state 7's Buy is default navy (see Scope).
   - **No `className="flex-1"`** on the `AddUsdCard` — the `verify` variant owns its 246px height
     (`SECTION_FRAME_CLASSES` is `h-[246px]`), same as state 2 and state 3's `verifying`.
   - `onStartVerification` is `openAddEmail`, **not** `openAccountSetup`.
   - `data-testid`s are identical to the other six branches so the shared QA selectors keep working.
   - Leave the `PortfolioPlaceholderCard`'s own `data-node-id` as the variant-keyed `6701:98528`;
     per-variant node ids are the established convention (state 6 reuses them the same way). Only
     the two stack wrappers carry state-7 node ids.

4. **Mobile — no code change.** Record the reason in the docs rather than touching the stack: the
   mobile block branches on `isConnected` alone (never on `homeState`), and for this visitor it
   already renders `mobileHomeState === "empty"` — `PortfolioPlaceholderCard` with `$0.00`,
   `StartHereCard` + `EarnedCard`, `StakeCard` with a disabled "Nothing to Stake", no
   `RecentActivityCard`, `HomeStatsStrip` — which is the mobile reading of this exact state. The
   only visible difference from the desktop branch is the greeting ("Welcome back" when connected)
   and the absence of the `Verify your account` card, for which no mobile frame exists. This
   matches epic #463's conventions and the "mobile untouched" decision states 1–6 all took.

5. **Tests** — see Test Strategy.

6. **Docs** — see Docs to Update.

7. **Tech debt** — append two entries to `docs/exec-plans/tech-debt-tracker.md`:
   - The home grid derives connection from the **active wallet view** while the header derives it
     from `isAnyConnected`, so a Stellar-connected visitor with the default EVM view sees the
     account icon over a "Sign Up" zero-state grid (first observable with #1460; `setKind` is only
     ever called by the Account page / dropdown, never by `ConnectWalletModal`).
   - Completing Add email from state 7 lands the visitor in `"legacy"` (session + connected +
     `NotStarted` is undesigned), which drops the `Verify your account` card they just acted on.

8. **Lint and build** — `npx tsx scripts/lint-docs.ts`, plus the frontend lint/typecheck/build the
   repo runs for frontend work. Do not commit (the manager commits with the label change).

## Test Strategy

**A. `packages/frontend/src/components/homeState.test.ts`**

Amend the three affected assertions — do not leave them to the suite run to discover:

| Location | Today | After |
| --- | --- | --- |
| `"returns zero when there is no session, even with a wallet connected"` (`{hasSession:false, isConnected:true}`) | `"zero"` | **still `"zero"`** (balance inputs default to `false` = non-zero) — but the title now misleads; rename to say "…with a wallet connected and balances unknown" and add the positive case below it. |
| kyb-pending block: `"returns zero when there is no session, even with every state-3 input set"` (`{...base, hasSession:false}` — connected, both balances zero) | `"zero"` | **`"wallet-only"`** — rewrite the assertion and the title. |
| kyb-problem block: `"returns zero when there is no session, regardless of kybStatus"` (`connectedZero` + `hasSession:false`) | `"zero"` | **`"wallet-only"`** — rewrite the assertion and the title (a sessionless visitor has no `kyb_status` to honour). |

The plusd-held block's `"returns zero when there is no session, even with every state-4 input set"`
is **unchanged** (`plusdIsZero: false` → not state 7).

Add a `describe("deriveHomeState — wallet-only (#1460)")` covering:

- connected, both balances display-zero, no session → `"wallet-only"`.
- no session + disconnected → `"zero"` (state 1 still owns the no-wallet case).
- no session + connected + `plusdIsZero: false` → `"zero"` (undesigned non-zero fall-through).
- no session + connected + `splusdIsZero: false` → `"zero"`.
- no session + connected + balance inputs **omitted** → `"zero"` (the conservative default).
- no session + connected + zero balances + each of `lpRead`/`kybStatus` set to every value → still
  `"wallet-only"` (a sessionless visitor can never reach the KYB branches, including
  `ChangesRequested`/`Failed`, which otherwise ignore connection and balances).
- `hasSession: true` + connected + zero balances + `lpRead: "unknown"` → `"legacy"`, unchanged
  (state 7 never steals a signed-in visitor).

**B. `packages/frontend/src/routes/-index.test.tsx`**

Add `describe("Home page — wallet-only state (#1460)")`, modelled on the `#1423` block
(line ~1597) for the connection setup and on the `#1421` block (line ~1230) for the session setup:

```
mockAuthState.isAuthenticated = false;
mockAuthState.lpRead = "unknown";
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
localStorage.setItem("pipeline.mock.wallet.contract.stakedPlusd.asset", PLUSD_ADDRESS);
```

First add `mockOpenAddEmail` to the hoisted auth mock and return it from `useAuthFlow()`.

Cases:

1. Top-left card is `data-variant="get-plusd"` with "Total Balance", a `$0.00` heading and a
   `Get PLUSD to start` **link** to `/deposit?direction=deposit`; the zero state's "Get Started" /
   "Sign Up" and state 2's "Connect wallet" are all absent.
2. `AddUsdCard` is `data-variant="verify"` with "Verify your account" / "Complete KYB to unlock
   bank transfers."; clicking `Start Verification` calls `mockOpenAddEmail` and calls **neither**
   `mockOpenAccountSetup` nor `mockAuthFlowOpen` nor `mockConnectModalOpen`. (This is the
   regression test for the #1459 re-point.)
3. `Buy` navigates to `/deposit?direction=deposit` and does **not** open the connect modal or the
   auth flow — i.e. it is not the zero state's `onSignUp`.
4. `Sell` is disabled; the Stake CTA reads `Nothing to Stake` and is disabled.
5. Grid occupancy: `home-balances-stack` holds start-here + stake, `home-add-usd-stack` holds
   add-usd + earned, and the two wrappers carry `data-node-id` `7149:16787` / `7149:16152`.
6. `RecentActivityCard` and `QnaSection` are present; `EarnedCard` reads "Tracked once you stake".
7. Regression: with a wallet connected, no session and a **non-zero** PLUSD balance, the grid falls
   back to the zero state ("Get Started" / "Sign Up" present) — the undesigned fall-through.
8. Regression: with a wallet connected and `isAuthenticated = true`, the grid is unchanged from
   today (`"legacy"`, or the relevant KYB branch) — state 7 never applies to a signed-in visitor.
9. Regression: the `#1421` zero-state block still passes untouched (no wallet connected there), and
   the mobile State A block still renders "Welcome back" + "Nothing to Stake".

**C. Full suites.** Run the frontend unit suite and `npx tsx scripts/lint-docs.ts`. Pay attention
to `routes/-index.test.tsx`'s `"EVM-only connected, Stellar view (view-kind semantics)"` and
`"neither connected, Stellar view"` blocks — they are signed-in and must stay green, confirming
Decision 1 did not change the active-view semantics.

**D. Figma verification** (the local Dev Mode MCP at `http://127.0.0.1:3845/mcp`; when the MCP
tools are absent from the session, the curl helpers
`figma.sh <tool> '<json-args>'` and `shot.sh <nodeId> <out.png>` work against the same server).
Render `/` at ≥1440px with a wallet connected and no session, and compare against
`get_screenshot` of `7149:16033`:

- 1136px content box inside the 1200px white panel, heading 32px left of the first card.
- Portfolio 643×274; Recent activity 477.71×634; both stacks 313.14×344 (164+16+164 and 246+16+82);
  FAQ 1136×89.
- `Buy` navy and enabled; `Sell` at 32% and disabled; `Nothing to Stake` tinted, 32% and disabled.
- `$0.00` headline, underlined `Get PLUSD to start`, flat placeholder chart with the period tabs.
- Header shows the account icon (`7149:16828`), not Sign In / Sign Up — regression check on #1458.
- Expected and accepted difference: the desktop heading reads "Welcome", not the frame's
  "Welcome back" (see Scope).

Do **not** drive the user's browser; if a live check is needed, ask the user to load the page and
report, per the project's browser-automation rule.

## Docs to Update

1. **`docs/product-specs/home-screen-states.md`**
   - States table: row 7 → `Implemented (#1460)`.
   - Precedence rule: delete the "Until #1460 lands, `deriveHomeState` is untouched and still
     returns `"zero"` for every sessionless visitor…" sentence and replace it with the shipped
     rule — state 7 requires `!hasSession && isConnected && plusdIsZero && splusdIsZero`, evaluated
     ahead of state 1; the balance test is the same #1186 displayed-zero rule (`isDisplayZero`)
     that drives `stakeDisabled`/`sellDisabled`; `isConnected` is the **active wallet view's**
     connection (Decision 1, with its rationale); the balance inputs' conservative `false` defaults
     mean an unresolved balance keeps a sessionless visitor in state 1, not state 7. Keep and
     re-anchor the existing sentence about a sessionless visitor with a non-zero balance falling
     through to state 1.
   - Add a short state-7 paragraph after the state-6 one: the composition is state 3's verbatim
     with `AddUsdCard variant="verify"` in the Shape B slot; `Start Verification` calls
     `openAddEmail()` because `openAccountSetup()` is a no-op without a session; the Total Balance
     headline keeps the sPLUSD binding (`$0.00`, served); `Buy` and `Get PLUSD to start` both go to
     `/deposit?direction=deposit`; after registering, the visitor lands in `"legacy"` until the
     session + connected + `NotStarted` combination is designed.
   - Update the "Until states 5 and 7 land…" closing line to name state 5 only.
   - Extend the "Card composition" table header/notes to say state 7 reuses states 1–3's grid with
     the state-2 `verify` card (no new geometry).

2. **`docs/frontend/dashboard-components.md#home-route`**
   - Add the seventh branch table (same shape as the `"kyb-problem"` one) with the state-7 node ids
     `7149:16142` / `7149:16043` / `7149:16787` / `7149:16152` / `7149:16143`.
   - Update the **Home state derivation** paragraph: the new union member, the replaced
     `!hasSession` short-circuit and its exact condition, and the note that the route passes
     `openAddEmail` (not `openAccountSetup`) for this branch.
   - Update the "All five #1419 branches are pixel-matched…" sentence to seven, noting state 7
     needed no new geometry.
   - Add one line to the mobile section recording that state 7 deliberately leaves mobile unchanged
     and why (step 4).

3. **`docs/user-stories/epic-1419/1460-home-wallet-only-state.md`** (new) — follow the #1426 doc's
   shape: header with epic/issue/spec links and the Figma frame, a scope note, then stories for
   (1) the grid composition card by card, (2) `Start Verification` opening the Add email screen and
   **not** the `CompanyDocsModal` / account-setup modal, plus the follow-on that completing it lands
   the visitor in `"legacy"`, (3) `Buy` navigating and `Sell` / `Nothing to Stake` inert, (4) the
   neighbouring combinations — non-zero balance → state 1, disconnected → state 1, signed in →
   unchanged, (5) mobile unaffected, (6) the header keeping its #1458 account icon.

4. **`docs/user-stories/epic-1419/1421-home-zero-state.md`** — rewrite **Story 3** ("A connected
   wallet does not override the zero state while signed out"). It now asserts the opposite: a
   connected wallet with zero balances and no session renders **state 7**, not the zero state;
   point to the new #1460 doc; keep a sessionless + connected + **non-zero**-balance case in the
   story as the combination that still falls back to the zero state. Retitle accordingly. Leave
   Stories 1, 2, 4 and 5 alone.

5. **`docs/user-stories/epic-1419/1422-home-unverified-state.md`** — **verified: no change
   required.** Story 4 ("A connected wallet falls through to the legacy layout") is scoped to a
   **signed-in** LP, which state 7 never matches; Stories 1–3, 5 and 6 all presuppose a session.
   Record this check in the PR body rather than editing the file. (Same for 1423/1424/1426, whose
   stories all presuppose a session.)

6. **`docs/exec-plans/tech-debt-tracker.md`** — the two entries from step 7.
