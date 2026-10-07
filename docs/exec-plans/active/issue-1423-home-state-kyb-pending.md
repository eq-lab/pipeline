# Issue #1423: Home state 3: wallet connected, PLUSD = 0, sPLUSD = 0, KYB verification pending

Source: https://github.com/eq-lab/pipeline/issues/1423

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-98417&m=dev
— frame `6701:98417` (" PLUSD = 0, sPLUSD = 0, Veryfying account")
Branch: `feat/home-state-kyb-pending` · draft PR #1438

## Scope

Render the LP home route `/` (`packages/frontend/src/routes/index.tsx`) per Figma frame
`6701:98417` when the visitor **has an auth session**, has a **wallet connected**, holds **zero
PLUSD and zero sPLUSD**, and whose `kyb_status` is **`UnderReview`**, by extending the
`deriveHomeState` seam that #1421/#1422 introduced.

In scope:

- A fourth `HomeState` member (`"kyb-pending"`) in
  `packages/frontend/src/components/homeState.ts`, plus two new balance inputs, derived from
  backend-served values only (auth session, wallet connection, `kyb_status` from `GET /v1/lps/me`,
  on-chain PLUSD/sPLUSD balances).
- A `"get-plusd"` variant of `PortfolioPlaceholderCard` — the compact 643×274 Total Balance box
  (geometry already shipped for `"connect-wallet"`) with an underlined brand `Get PLUSD to start`
  link in the subtitle slot instead of the `Connect wallet` button.
- A **disabled** treatment for the compact `StakeCard` CTA: label `Nothing to Stake`, grey disabled
  fill. The compact branch today always renders an enabled-looking navy `Stake`.
- Mounting `AddUsdCard variant="verifying"` (already built and Figma-anchored) on `/` for the first
  time, with `onViewStatus` wired to the Account page.
- The desktop `"kyb-pending"` composition (the same 7-column grid as states 1–2, two card swaps).
- The state-3 precedence rule and card composition recorded in
  `docs/product-specs/home-screen-states.md`.
- A user-stories doc at `docs/user-stories/epic-1419/1423-home-kyb-pending-state.md`.

Out of scope:

- Header auth buttons, the composite Total-Balance graph, the merged activity feed (#1282 and its
  backend blockers #1313, #1314, #1285). Frame node `6701:98803` (header) is not touched.
- Home states 4–6 (#1424–#1426). They keep falling through to `"legacy"`.
- The Account page itself (epic #1247) — this issue only *navigates* to the already-shipped
  `/account` route.
- Any KYB modal work (`CompanyDocsModal` stays as is).
- Mobile. Per the human decision on #1421 (2026-10-07), reaffirmed for #1422, there is no mobile
  layout for these states yet; the `md:hidden` block stays untouched and keeps its
  `isConnected`-only rendering.
- Extracting the shared epic-#1419 grid shell (TD-122) — this issue adds the fourth branch verbatim,
  following #1421/#1422 precedent.

## Figma delta (what actually differs from today)

Read from the local Dev Mode MCP (`get_metadata` + `get_design_context` + `get_variable_defs` +
`get_screenshot` on `6701:98417`). The frame reuses the **same geometry as states 1–2**: `Heading`
at x=264 y=128, 1200×915; `Title` row 1200×64 (48px "Welcome back" + the 492×40 stats cell at
x=708 y=24); `Content` 1200×803 padded 32, so the cards span 1136 at `grid-cols-7 gap-4`
(148.57px columns → 2 cols = 313.14, 3 = 477.71, 4 = 642.28). Row 1 at y=32 h=274, row 2 at y=322
h=344, FAQ at y=682 h=89. **No container, grid or gap change is needed.**

| Figma node | Slot | Unverified state (shipped #1422) | KYB-pending state (this issue) |
| --- | --- | --- | --- |
| `6701:98419` Title row | heading + stats cell | `WelcomeHeader` + `HomeStatsStrip` | unchanged — no work |
| `6701:98528` Portfolio, col 1–4 row 1, 643×274 | `PortfolioPlaceholderCard variant="connect-wallet"` | **`variant="get-plusd"`** — same box, `Get PLUSD to start` link replaces the `Connect wallet` button |
| `6701:98427` Section, col 5–7 rows 1–2, 477.71×634 | `RecentActivityCard padding="md"` | unchanged (empty placeholder, "You will see all transactions here") |
| `6701:98773` col 1–2 row 2, 313.14×344 | `StartHereCard layout="compact"` + `StakeCard layout="compact"` | same composition; **the Stake CTA is disabled** (`Nothing to Stake`), Sell disabled |
| `6701:98538` col 3–4 row 2, 313.14×344 | `AddUsdCard variant="verify"` + `EarnedCard layout="compact"` | **`AddUsdCard variant="verifying"`** + `EarnedCard layout="compact"` (unchanged) |
| `6701:98529` FAQ, col 1–7 row 3, 1136×89 | `QnaSection` | unchanged |
| `6701:98803` header | `TopBar` | out of scope (#1282) |

Per-card node ids and outer geometry, for the coder and for `ux-tester` verification:

| Card | Node | Outer box | Notes |
| --- | --- | --- | --- |
| Total Balance (Portfolio) | `6701:98528` | 643 × 274 at (32, 32) | padding 16; Top Container `I6701:98528;1100:74694` 611×84 at (16,16); Chart `I6701:98528;6268:39890` 611×144 at (16,114) |
| ↳ eyebrow | `I6701:98528;1100:74696` | 100 × 22 | `Total Balance`, Body 16/22, `content-test/primary` #262524 |
| ↳ value | `I6701:98528;1100:74697;6539:2329` | 75 × 36 | `$0.00`, Heading M 28/36 |
| ↳ subtitle | `I6701:98528;1100:74697;6539:2331` | 139 × 22 | `Get PLUSD to start`, Body 16/22, **underlined**, `content-test/brand` #000080 |
| ↳ tabs | `I6701:98528;1100:74698` | 224 × 36 | 7D selected — unchanged |
| Recent activity | `6701:98427` | 477.71 × 634 at (690.29, 32) | title `Recent activity`; caption `You will see all transactions here` |
| Left stack | `6701:98773` | 313.14 × 344 at (32, 322) | `gap-16` → `gap-4` |
| ↳ Get PLUSD | `6701:98774` | 313.14 × 164 | `Start here` / `Get PLUSD` (24px PLUSD icon at 4px gap, Heading 20) / `Convert with USDC 1:1`; Buttons `6701:98786` at y=92: `Buy` 61×40 navy (`6701:98787`), `Sell` 61×40 at 32% opacity (`6701:98788`) |
| ↳ Stake PLUSD | `6701:98789` | 313.14 × 164 | `Stake PLUSD` / `Earn 8.42% p.a.` / `From senior loan coupons and T-bills`; Buttons `6701:98801` at (16,108): **one 160×40 disabled button `Nothing to Stake`** (`6701:98802`) |
| Right stack | `6701:98538` | 313.14 × 344 at (361.14, 322) | `gap-4` |
| ↳ Verifying | `6701:98539` | 313.14 × 246 | padding 16; Union illustration `6701:98540` 291×193.66 at card-box (174, 66.34); title block at (16,16); button frame `6701:98760` 122×40 at (16,190) |
| ↳ Earnings | `6701:98762` | 313.14 × 82 | `Earnings` / `Tracked once you stake` (`content-test/tertiary`); `Earned Icon` `6701:98771` is `hidden` |
| FAQ | `6701:98529` | 1136 × 89 at (32, 682) | three 368-wide cells, unchanged |

Token resolution (`get_variable_defs` on `6701:98417` and on the individual buttons) — **no new
tokens**, and the codegen's stale fallback literals are again not the bound values:

| Figma variable | Codegen fallback (stale) | Resolved | Repo token |
| --- | --- | --- | --- |
| `radius/radius-s`, `radius/radius-xxl`, `radius/radius-l`, `radius/radius-3xl` | 8px / 24px / 16px / 32px | **4** | `--radius-pipeline-card` / `--radius-pipeline-button` |
| `content-test/brand`, `fill/brand` | `#8fb2a4` | **#000080** | `--color-pipeline-brand` |
| `content-test/primary` | `black` | #262524 | `--color-pipeline-ink` |
| `content-test/secondary` | `rgba(50,56,55,0.6)` | #38373599 | `--color-pipeline-ink-muted` |
| `content-test/tertiary` | `rgba(50,56,55,0.3)` | #3835384d | `--color-pipeline-ink-subtle` |
| `border-test/secondary` | — | #3837352e | `--color-pipeline-line` |
| `fill-test/primary` on `6701:98761` (View Status) | — | **#262524** | `--color-pipeline-cta` (`Button variant="primary-dark"`) |
| `fill-test/primary` on `6701:98802` (disabled Stake) | `rgba(184,191,190,0.12)` | **#bfbdbb1f** | no theme token — see decision below |

**No new assets.** The Union at `6701:98540` is the already-committed `striped-check.svg`
(`CheckIllustration`); the PLUSD glyph, Recent-activity artwork and nav icons are all shipped.

## Assumptions and Risks

- **Decision — `View Status` navigates to `/account`.** The Figma button carries the dev annotation
  `data-development-annotations="Open Account"`, and
  `docs/product-specs/kyb-lp-verification.md` makes the Account page the surface that "show[s]
  Name, Country, corporate email, persisted document filenames, and review statuses" and
  "distinguishes loading, 404, and request failure"; `docs/frontend/account-page.md` already ships
  an `under-review` documents state with its status banner. Reopening `CompanyDocsModal` is the
  wrong affordance here: the same spec freezes LP writes while `UnderReview` (`writable: false`),
  so the setup modal would open read-only. Use the `TopBar` precedent verbatim:
  `navigate({ to: "/account", search: { state: undefined } })`
  (`packages/frontend/src/components/TopBar.tsx:145`).
- **Decision — `Verifying account…` ships typo-corrected.** The frame reads "Veryfying
  account...". `AddUsdCard` already ships `Verifying account…` (correct spelling, real ellipsis) per
  the documented `account-page.md` / #1248 design-file-artifact precedent. Do **not** reintroduce
  the typo; `ux-tester` should expect the corrected copy.
- **Decision — a balance is "zero" when its 2dp rendering is zero** (`isDisplayZero`,
  `packages/frontend/src/lib/format.ts`, the #1186 displayed-zero rule the route already applies to
  `stakeDisabled` / `sellDisabled`). Note `isDisplayZero(undefined, d) === true`, so an unresolved
  balance reads as zero; see the flash risk below.
- **Decision — the disabled compact Stake CTA is styled at the call site, not in the `Button`
  primitive.** `Button`'s `primary-blue` has no disabled treatment, and the repo's established
  idiom is a per-call-site `className` override (`CreateAccountModal.tsx:150`,
  `SignInModal.tsx:119`, `ForgotPasswordModal.tsx:62` all add `disabled:opacity-[0.32]`). Adding a
  disabled fill to the shared variant would silently restyle those three auth modals against frames
  nobody has checked. Reuse the exact literal `circular-blue` already uses
  (`rgba(184,191,190,0.12)`), **not** the freshly resolved `#bfbdbb1f`: two existing assertions pin
  the old literal (`packages/frontend/src/routes/-index.test.tsx:493` and `:1193`), and the
  per-channel delta at 12% alpha is sub-perceptual. Record the discrepancy in the docs; do not
  churn `Button.tsx`.
- **Decision — the Total Balance card keeps its served wiring.** The wallet is connected in this
  state, so `balanceLabel` is the real `formatBigintCurrency(splusdSharesActive, activeDecimals)`
  (which renders `$0.00` precisely because sPLUSD is zero — a served value, not a default), and
  `series` / `yAxis` / `yAxisDomainMax` stay wired to `usePositionsHistory` exactly as the legacy
  branch does. The frame's dense bar chart is preview-fixture data; a real connected-but-empty
  wallet will render whatever the backend serves (a zero series, or the documented
  `series === null` placeholder). Nothing is computed or scaled client-side.
- **Decision — `Get PLUSD to start` stays a router `Link` to `/deposit?direction=deposit`**, matching
  the `"balance"` variant's existing link target, so the card stays presentational and no new
  handler prop is needed.
- **Risk — in-flight balance flash.** Because `isDisplayZero(undefined)` is `true`, a connected
  `UnderReview` LP that actually holds PLUSD will briefly render `"kyb-pending"` before the balance
  resolves and the grid falls back to `"legacy"`. Same class as TD-121's LP-read flash; extend that
  entry rather than inventing a loading state Figma has not designed.
- **Risk — `AddUsdCard variant="verifying"` has never rendered in production.** It is unit-tested
  and Figma-anchored (#1430 fixed the Shape B frame and anchor), but `docs/frontend/bank-transfers.md`
  still attributes `onViewStatus` to "#1282" in its seams table and the variant has only ever been
  exercised from `/test?tab=auth`. Expect to correct that attribution and re-check the 246px height
  renders correctly inside the grid stack (**no `flex-1`** — the card owns its height, per
  bank-transfers.md § "Shape B frame and illustration anchor").
- **Risk — test-mock surface.** `packages/frontend/src/routes/-index.test.tsx` (1595 lines) already
  seeds `mockAuthState.lpRead` / `.kybStatus`; the new describes must also drive the EVM/Stellar
  balance mocks to zero *and* set `isConnected: true`, which several existing describes share. Reset
  state in `beforeEach` (the file already does at line ~237) so the four `"unverified"` regression
  tests at `:1532` stay green.
- **Risk — a fourth near-identical grid branch.** `index.tsx` will hold `legacy`, `zero`,
  `unverified` and `kyb-pending` JSX. Following #1421/#1422 precedent this issue adds the branch
  verbatim; update TD-122's count rather than refactoring mid-epic.
- **Dependency.** None unmerged. #1421 (`296f55b6`) and #1422 (`6ec5e093`) are on `main`; branch
  `feat/home-state-kyb-pending` and draft PR #1438 exist. Do not touch the unrelated working-tree
  changes (`.mcp.json`, `Cash management.md`, `trustee-new.md`).

## Open Questions

_None_ — the epic's standing decisions (state-machine ownership on #1419, `!session` precedence, no
mobile layout, pixel-exact desktop grids including shared cards) are recorded on #1421/#1422 and
applied here. The one genuinely new behavioural choice, where `View Status` leads, is settled by the
Figma node's own `Open Account` dev annotation together with
`docs/product-specs/kyb-lp-verification.md` and `docs/frontend/account-page.md`.

## Implementation Steps

1. **Extend the state seam.** — DONE. `packages/frontend/src/components/homeState.ts`:

   ```ts
   export type HomeState = "zero" | "unverified" | "kyb-pending" | "legacy";

   export interface DeriveHomeStateInput {
     hasSession: boolean;
     isConnected: boolean;
     lpRead?: LpReadState;      // default "unknown"
     kybStatus?: string;        // only meaningful when lpRead === "loaded"
     plusdIsZero?: boolean;     // default false — an unpassed input must never promote
     splusdIsZero?: boolean;    // default false
   }
   ```

   Ordered rules (first match wins), mirroring the spec's precedence list:
   - `!hasSession` → `"zero"` (unchanged; wallet ignored).
   - `!isConnected && (lpRead === "absent" || (lpRead === "loaded" && kybStatus === "NotStarted"))`
     → `"unverified"` (unchanged).
   - `isConnected && lpRead === "loaded" && kybStatus === "UnderReview" && plusdIsZero && splusdIsZero`
     → `"kyb-pending"`.
   - otherwise → `"legacy"` (covers `unknown`/`error`, a disconnected wallet, a non-zero balance,
     and every other `kyb_status`).

   `LpReadState` is unchanged. Keep the one-line spec-pointer header; add no other comments.

2. **Add the `PortfolioPlaceholderCard` `"get-plusd"` variant.** — DONE.
   `packages/frontend/src/components/PortfolioPlaceholderCard.tsx`:

   ```ts
   export type PortfolioPlaceholderCardVariant =
     | "balance" | "connect-wallet" | "get-plusd";
   ```

   Replace the single `isConnectWallet` flag with `isCompact = variant !== "balance"` for the
   geometry (`h-[274px] gap-2`, `padding="md"`, Body-16 primary-ink eyebrow) so `"get-plusd"` shares
   the box `"connect-wallet"` already pins to the frame, and keep `isConnectWallet` only for the
   subtitle branch. `"balance"` must stay byte-identical in rendered output
   (`min-h-[274px] gap-6`, `padding="lg"`, Caption/ink-muted eyebrow, PnL caption + `Link`).

   In the subtitle slot for `"get-plusd"` render a router `Link` (not a button):

   ```tsx
   <Link to="/deposit" search={{ direction: "deposit" as const }} className={…}>
     Get PLUSD to start
   </Link>
   ```

   styled the same as the `Connect wallet` control — `--text-pipeline-body`,
   `text-[color:var(--color-pipeline-brand)]`, `underline underline-offset-2`. Render **no**
   unrealized-PnL caption in this variant and ignore `mobileHomeState`.
   `data-node-id`: `"6701:98528"` for `"get-plusd"`, `"6701:97649"` for `"connect-wallet"`,
   `"1497:95048"` for `"balance"`; set `data-variant` for both compact variants. Drop the PnL clause
   from the chart `role="img"` aria-label whenever `isCompact`.

3. **Give the compact `StakeCard` CTA a disabled treatment.** — DONE.
   `packages/frontend/src/components/StakeCard.tsx`, compact branch only (`layout === "compact"`):
   - Label and `aria-label` become `Nothing to Stake` when `isStakeCtaDisabled` (the existing
     `stakeDisabled || mobileHomeState === "empty"` expression), matching the default branch's
     wording; otherwise `Stake` as today.
   - Add the scoped disabled className to that `Button`:
     `disabled:bg-[rgba(184,191,190,0.12)]`, `disabled:hover:!bg-[rgba(184,191,190,0.12)]`,
     `disabled:text-[color:var(--color-pipeline-ink)]`, `disabled:opacity-[0.32]`.
   - Leave `layout="default"` and the `"splusd"` branch untouched.
   - The 160px frame width comes from the longer label plus the existing `size="m"` padding — do
     **not** hard-code a width.

4. **Add the `"kyb-pending"` desktop branch.** — DONE. `packages/frontend/src/routes/index.tsx`:
   - Feed the two new inputs into the existing `deriveHomeState` call:
     `plusdIsZero: isDisplayZero(plusdBalanceActive, activeDecimals)` and
     `splusdIsZero: isDisplayZero(splusdSharesActive, activeDecimals)`.
   - Add `const onViewStatus = () => navigate({ to: "/account", search: { state: undefined } });`
     next to the existing `onBuy`/`onSell`/`onStake` handlers.
   - Inside the `hidden md:block` outer `Card`, add a fourth branch for `homeState === "kyb-pending"`,
     built from the `"unverified"` branch with these differences:
     - col 1–4 row 1: `PortfolioPlaceholderCard variant="get-plusd"` with `balanceLabel`,
       `activePeriodId`/`onActivePeriodChange`/`series`/`yAxis`/`yAxisDomainMax` wired exactly as the
       legacy branch, `data-testid="home-portfolio-placeholder"`. No `onConnectWallet`.
     - col 5–7 rows 1–2: `RecentActivityCard padding="md"` in the existing absolute wrapper
       (unchanged).
     - col 1–2 row 2 (`data-node-id="6701:98773"`): `StartHereCard layout="compact"` +
       `StakeCard layout="compact"`, `gap-4`, wired to the route's `onBuy` / `onSell` / `onStake`
       with the existing `sellDisabled` and **`stakeDisabled={stakeDisabled}`** expressions (both
       resolve to `true` in this state — a connected wallet with display-zero PLUSD).
     - col 3–4 row 2 (`data-node-id="6701:98538"`): `AddUsdCard variant="verifying"` with
       `onViewStatus={onViewStatus}` and **no `flex-1`**, stacked above
       `EarnedCard layout="compact"`, `gap-4`.
     - col 1–7 row 3: `QnaSection` (unchanged).
   - Leave the `md:hidden` mobile block, the `"zero"`, `"unverified"` and `"legacy"` branches
     byte-identical.

5. **Record the precedence rule and composition.** — DONE. `docs/product-specs/home-screen-states.md`
   (66 lines, under the 200-line cap):
   - Flip row 3's Status to `Implemented (#1423)`.
   - Extend `## Precedence rule` with the state-3 clause: it requires a session, a **connected**
     wallet, `lpRead === "loaded"`, `kyb_status === "UnderReview"`, and **both** PLUSD and sPLUSD
     rendering as zero at 2dp (the #1186 displayed-zero rule); `UnderReview` with a non-zero balance,
     or with no wallet connected, is a combination the product has not designed and falls through to
     `"legacy"`; an unknown or failed LP read still renders `"legacy"`.
   - Extend `## Card composition` with a state-3 row (or a short third column): the same 1136px
     7-column grid, with the Total Balance card showing `Get PLUSD to start`, the Stake CTA disabled
     as `Nothing to Stake`, and `AddUsdCard verifying` in the right stack.

6. **Update the frontend docs.** — DONE.
   - `docs/frontend/dashboard-components.md` § "Home route": add the `"kyb-pending"` grid table
     (node ids and geometry from the table above) and update the "Home state derivation" paragraph
     for the widened union and the two balance inputs. § "PortfolioPlaceholderCard": document
     `variant="get-plusd"` (shared compact geometry, `Get PLUSD to start` link, no PnL caption,
     `data-node-id` `6701:98528`). § "StakeCard": document the compact disabled CTA
     (`Nothing to Stake`, node `6701:98802`, the call-site disabled fill and why it is not in the
     primitive, and the `#bfbdbb1f` vs `rgba(184,191,190,0.12)` sub-perceptual discrepancy).
   - `docs/frontend/bank-transfers.md`: `verifying` now ships on `/` (state 3), and correct the
     seams-table row — `AddUsdCard.onViewStatus` is wired by **#1423** to `/account`, not by #1282.
     `onStartVerification` stays #1422's `openAccountSetup`.
   - `docs/frontend/ui-components.md` § Button: note that the rectangular `primary-blue` disabled
     treatment is a documented call-site override (StakeCard compact + the three auth modals), not a
     variant state.

7. **User stories.** — DONE. New `docs/user-stories/epic-1419/1423-home-kyb-pending-state.md` in the #1422
   format (Persona / Pre-conditions / Steps / Expected outcomes, desktop-only note, node ids and box
   sizes per card so `ux-tester` can verify against `6701:98417`), plus a row in
   `docs/user-stories/index.md` under "Epic #1419".

8. **Log, do not fix.** — DONE. Extend `docs/exec-plans/tech-debt-tracker.md`: add the in-flight **balance**
   flash to TD-121 (same root shape as the in-flight LP read) and update TD-122 to say the branch
   count is now four.

9. **Lint and build.** — DONE. `yarn workspace @pipeline/frontend lint`,
   `yarn workspace @pipeline/frontend build`, `npx tsx scripts/lint-docs.ts`. Keep the
   comment-minimal rule: one 2–3-line spec-pointer header per file, no field/function JSDoc, no body
   or test comments in new code.

## Test Strategy

Vitest + React Testing Library, colocated. Commands: `yarn workspace @pipeline/frontend test`,
`yarn workspace @pipeline/frontend lint`, `yarn workspace @pipeline/frontend build`,
`npx tsx scripts/lint-docs.ts`.

- **`packages/frontend/src/components/homeState.test.ts`** (extend) — keep every existing row green
  and add:
  - session + connected + `lpRead: "loaded"` + `kybStatus: "UnderReview"` + both balances zero →
    `"kyb-pending"`.
  - the same row with `plusdIsZero: false` → `"legacy"`; with `splusdIsZero: false` → `"legacy"`.
  - the same row **disconnected** → `"legacy"` (a connected wallet is part of the condition).
  - `UnderReview` with `lpRead: "unknown"` / `"error"` → `"legacy"`.
  - connected + `"NotStarted"` / `"Passed"` / `"ChangesRequested"` / `"Failed"` / `"InProgress"`
    with zero balances → `"legacy"` (states 4–6 not yet implemented).
  - `!hasSession` with every state-3 input set → still `"zero"` (precedence).
  - omitting `plusdIsZero`/`splusdIsZero` entirely → `"legacy"`, never `"kyb-pending"` (defaults
    must not promote).
- **`packages/frontend/src/components/PortfolioPlaceholderCard.test.tsx`** (extend) —
  `variant="get-plusd"` renders `Total Balance`, the passed `balanceLabel`, and a `Get PLUSD to start`
  link whose `href` resolves to `/deposit?direction=deposit`; renders **no** unrealized-PnL caption
  (`queryByTestId("earning-caption")` is null) and **no** `Connect wallet` control; carries
  `data-node-id="6701:98528"`. Regression: `"connect-wallet"` still renders the `Connect wallet`
  button and `"balance"` still renders the caption + link.
- **`packages/frontend/src/routes/-index.test.tsx`** — new
  `describe("Home page — KYB-pending state (#1423)")` with the `@/auth` mock seeded
  `isAuthenticated: true`, `lpRead: "loaded"`, `kybStatus: "UnderReview"`, wallet **connected**, and
  both token balances `0n`:
  - Top-left card shows `Total Balance`, `$0.00` and a `Get PLUSD to start` link; no `Connect wallet`,
    no `Get Started` / `Sign Up`.
  - `AddUsdCard` renders with `data-variant="verifying"`, heading `Verifying account…`, description
    `We are reviewing your documents.`; clicking `View Status` calls the navigate mock with
    `{ to: "/account", search: { state: undefined } }`.
  - Left stack: `StartHereCard` ( `Get PLUSD`, `Buy` enabled, `Sell` disabled) + `StakeCard` whose
    CTA is disabled, labelled `Nothing to Stake`, and whose className contains
    `disabled:bg-[rgba(184,191,190,0.12)]`.
  - Grid occupancy by `data-testid`: `home-balances-stack` holds StartHere+Stake,
    `home-add-usd-stack` holds AddUsd+Earned; `EarnedCard` reads `Tracked once you stake`.
  - `RecentActivityCard` empty placeholder (`You will see all transactions here`) and `QnaSection`
    render.
  - No 128px circular Stake button is present.
  - The route issues **no** `GET /v1/lps/me` of its own (the provider owns the request).
  - Regression rows, each keeping today's **legacy connected** layout: non-zero PLUSD, non-zero
    sPLUSD, `kybStatus: "Passed"`, `lpRead: "unknown"`, `lpRead: "error"`, and
    `UnderReview` + wallet disconnected. The existing `"zero"`, `"unverified"` and legacy describes
    (including the two `disabled:bg-[rgba(184,191,190,0.12)]` assertions at `:493` and `:1193`) must
    stay green unchanged.
- **Figma verification** — `ux-tester` runs the epic's QA pass against frame `6701:98417`
  (https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-98417&m=dev) using the
  new user-stories doc, verifying composition, copy, colours, typography **and** the per-card
  geometry in the node table above (643×274 / 477.71×634 / 313.14×164 ×2 / 313.14×246 / 313.14×82 /
  1136×89 on a 1136 content box). Expected deviations to accept: `Verifying account…` ships
  typo-corrected (frame says "Veryfying"), and the three 1–3px Shape B deltas
  `bank-transfers.md` already documents for the shared border idiom. Token-exact check: no raw hex,
  font, size or radius literals introduced beyond the one documented disabled-fill literal; the
  `Get PLUSD to start` link resolves `--color-pipeline-brand` and `--text-pipeline-body` from
  `packages/ui/src/styles/theme.css`.

## Docs to Update

- `docs/product-specs/home-screen-states.md` — state-3 status, the precedence clause, the card
  composition row (required by the Issue).
- `docs/frontend/dashboard-components.md` — § "Home route" (kyb-pending grid table +
  `deriveHomeState` inputs); § "PortfolioPlaceholderCard" (`variant="get-plusd"`); § "StakeCard"
  (compact disabled CTA).
- `docs/frontend/bank-transfers.md` — `verifying` now mounted on `/`; `onViewStatus` seam wired by
  #1423 to `/account`.
- `docs/frontend/ui-components.md` — § Button: rectangular `primary-blue` disabled is a call-site
  override.
- `docs/user-stories/epic-1419/1423-home-kyb-pending-state.md` — new.
- `docs/user-stories/index.md` — new row under "Epic #1419 — LP home screen states".
- `docs/exec-plans/tech-debt-tracker.md` — extend TD-121 (in-flight balance flash) and TD-122
  (fourth grid branch).
