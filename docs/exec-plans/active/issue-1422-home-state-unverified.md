# Issue #1422: Home state 2: account created but not verified — KYB not completed, wallet not connected

Source: https://github.com/eq-lab/pipeline/issues/1422

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-97538&m=dev — frame `6701:97538` ("No Verified Account, No Connected Wallet")
Branch: `feat/home-state-unverified` · draft PR #1428

## Scope

Render the LP home route `/` (`packages/frontend/src/routes/index.tsx`) per Figma frame `6701:97538` when the
visitor **has an auth session**, has **not completed KYB**, and has **no wallet connected**, by extending the
`deriveHomeState` seam that #1421 introduced.

In scope:

- A third `HomeState` member (`"unverified"`) in `packages/frontend/src/components/homeState.ts`, derived from
  backend-served values only: auth session, wallet connection, and `kyb_status` from `GET /v1/lps/me`.
- Exposing the LP read (`kyb_status` + read state) and a "reopen account setup" seam through the existing
  `AuthFlowProvider`, which **already** issues `GET /v1/lps/me` on every token change — no second fetch.
- A `"connect-wallet"` variant of `PortfolioPlaceholderCard` (Total Balance card with a `Connect wallet` link
  in the subtitle slot instead of the unrealized-PnL caption).
- The desktop unverified composition (same 7-column grid as the zero state, two card swaps).
- The precedence rule for state 2 recorded in `docs/product-specs/home-screen-states.md`.
- A user-stories doc at `docs/user-stories/epic-1419/1422-home-unverified-state.md`.

Out of scope:

- Header auth buttons, the composite Total-Balance graph, the merged activity feed (#1282 and its backend
  blockers #1313, #1314, #1285). Frame node `6701:97929` (header) is not touched.
- Home states 3–6 (#1423–#1426). They keep falling through to `"legacy"`.
- Building any KYB modal (epic #1247) or Account-page work — this issue only *wires a CTA* to the
  already-mounted `CompanyDocsModal`.
- Mobile. Per the human decision on #1421 (2026-10-07) there is no mobile layout for these states yet; the
  `md:hidden` block stays untouched and keeps its `isConnected`-only rendering.
- Pixel-exact restyling of the shared cards. Per the human decision on #1421 (2026-10-07) this epic is about
  state **composition**; the accepted differences recorded there (card heights, promo padding, button sizes,
  the `Welcome` vs `Welcome back` heading, the page's extra 32px side padding) apply unchanged here and are
  **not** re-opened.

## Figma delta (what actually differs from today)

Read from the local Dev Mode MCP (`get_metadata` + `get_screenshot` + `get_variable_defs` on `6701:97538`).
The frame uses the **same 7-column grid at the same coordinates** as the zero-state frame `6701:98220`
(Portfolio col 1–4 row 1 at 643×274; Section col 5–7 rows 1–2 at 477.7×634; `Frame 1984078735` col 1–2 row 2;
`Frame 1984078736` col 3–4 row 2; FAQ col 1–7 row 3). Container, gaps and `max-w-[1200px]` are unchanged.

| Figma node | Slot | Zero state (shipped #1421) | Unverified state (this issue) |
| --- | --- | --- | --- |
| `6701:97540` Title row | heading + stats cell | `WelcomeHeader` + `HomeStatsStrip` | unchanged — no work (frame reads "Welcome back" in **both** frames; accepted difference per #1421) |
| `6701:97649` Portfolio, col 1–4 row 1 | `ConnectWalletPromoCard variant="get-started"` | **`PortfolioPlaceholderCard`** — "Total Balance" / "$0.00" / **"Connect wallet"** link, period tabs, flat placeholder chart, dates row |
| `6701:97548` Section, col 5–7 rows 1–2 | `RecentActivityCard` empty | unchanged |
| `6701:97659` col 1–2 row 2 | `StartHereCard` + `StakeCard` | unchanged composition; **CTAs rewired** — Buy/Stake open the connect modal (not the auth flow), Sell disabled |
| `6701:97695` col 3–4 row 2 | `AddUsdCard variant="locked"` + `EarnedCard` | **`AddUsdCard variant="verify"`** ("Verify your account" / "Complete KYB to unlock bank transfers." / "Start Verification") + `EarnedCard` |
| `6701:97650` FAQ, col 1–7 row 3 | `QnaSection` | unchanged |
| `6701:97929` header | `TopBar` | out of scope (#1282) |

Two deltas need component work; everything else is composition and wiring:

1. **`AddUsdCard variant="verify"` already exists** and its `data-node-id` is literally `6701:97695` — this
   frame's node (`docs/frontend/bank-transfers.md` § "Per-variant presence table"). Copy, illustration
   (`CheckIllustration` / `striped-check.svg`) and the `Start Verification` button are already Figma-verified.
   **No component work, no new copy, no new asset.**
2. **`PortfolioPlaceholderCard` needs a disconnected variant.** In the frame the heading component's
   `SubtitleCont` (`I6701:97649;1100:74697;6539:2331`) holds exactly one line — `Connect wallet` — where the
   connected card puts the unrealized-PnL caption. Today the component renders *both* the caption and a
   router `Link` ("Get PLUSD to start").

**No new assets.** Every illustration in the frame (`CheckIllustration`, the Recent-activity empty art, the
coin glyph, nav icons) is already committed. Nothing needs exporting from Figma.

Design tokens resolve onto the existing theme — `get_variable_defs` on `6701:97649` returns
`content-test/brand` `#000080` → `--color-pipeline-brand` (the `Connect wallet` link colour),
`content-test/primary` `#262524` → `--color-pipeline-ink`, `content-test/secondary` `#38373599` →
`--color-pipeline-ink-muted`, `border-test/secondary` `#3837352e` → `--color-pipeline-line`,
Body 16/22 → `--text-pipeline-body`, Heading M 28/36 → `--text-pipeline-heading-m`. **No new tokens.**

## Assumptions and Risks

- **`AuthFlowProvider` already fetches `GET /v1/lps/me`.** `packages/frontend/src/auth/AuthFlowProvider.tsx`
  runs `getMyLp` in a `useEffect` keyed on `token` and holds `{ status: "loading" | "absent" | "loaded" |
  "error", lp }`. The home route must read that, not add a second request. This is the "existing hook" the
  issue's "check before proposing a new fetch" instruction points at.
- **Decision — an absent LP (404) counts as "not verified".** `AuthFlowProvider` models a 404 as
  `status: "absent"`. The issue's render condition is "KYB bypassed **or** not completed during
  registration"; a user who dismissed the setup modal never POSTs an LP, so `absent` is precisely the
  "bypassed" case. `absent` and `loaded` + `kyb_status === "NotStarted"` therefore both select state 2.
  Recorded in the product spec.
- **Decision — `"Start Verification"` reopens the account-setup modal.**
  `docs/product-specs/kyb-lp-verification.md` § "LP Entity Registration and KYB Documents" makes the
  dismissible "Finish account setup" modal (`CompanyDocsModal`) the LP app's KYB entry point, and
  `AuthFlowProvider` already mounts it globally whenever `status` is `absent`/`loaded`. The CTA re-opens that
  same modal rather than navigating to `/account`. No modal is built — only a seam is exposed.
- **Decision — an unknown or failed LP read renders `"legacy"`.** There is no designed loading state for the
  home grid, and `kyb-lp-verification.md` is explicit that "request failures do not imply an empty account".
  While the read is in flight a signed-in, wallet-disconnected user briefly sees today's legacy layout before
  the grid swaps. The request starts at app mount (`AuthFlowProvider` sits above the router in `main.tsx`), so
  the window is one RTT. Logged as tech debt rather than papered over with a fabricated skeleton.
- **Decision — `$0.00` on the Total Balance card is the designed zero default, not a fabricated balance.**
  `PortfolioPlaceholderCard` already documents `balanceLabel = "$0.00"` as its default and the frame shows it
  verbatim. No wallet is connected, so no balance query runs and no value is client-derived; the chart stays
  in its documented `series === null` placeholder mode. Nothing is scaled or normalised.
- **Risk — the existing auth modal opens over this state.** `AuthFlowProvider` auto-opens `CompanyDocsModal`
  when the LP is absent or has no documents, so a fresh signed-in user may see the modal over the new grid on
  first load. That is shipped #1247 behaviour, not a regression; the user-stories doc dismisses the modal
  before asserting the grid.
- **Risk — test-mock surface.** `packages/frontend/src/routes/-index.test.tsx` mocks `@/auth` with an object
  literal (`useAuthSession`, `useAuthFlow`). Widening `AuthFlowContextValue` means that mock — and
  `AuthFlowProvider.test.tsx` / `AuthFlowProvider.setup.test.tsx` — must be updated, not just extended.
- **Risk — three near-identical desktop grid branches.** After this issue `index.tsx` holds `legacy`, `zero`
  and `unverified` JSX. Following #1421's precedent ("adds a branch, does not refactor") this issue adds the
  third branch verbatim rather than extracting a shared grid; extraction is logged as tech debt for when
  states 3–6 would make it seven.
- **Risk — `docs/frontend/bank-transfers.md` is stale.** Its header still claims "**Nothing here is mounted
  on `/`.**" That stopped being true when #1421 mounted `AddUsdCard variant="locked"`; this issue mounts
  `verify`. The sentence must be corrected in this PR.
- **Pre-existing copy mismatch found (do not fix inline).** `RecentActivityCard` renders "You will see **your**
  transactions here"; both Figma frames `6701:97538` and `6701:98220` read "You will see **all** transactions
  here". Shared component, present before this issue — log in `docs/exec-plans/known-bugs.md` per `AGENTS.md`.
- **Dependency.** None unmerged. #1421 is merged (`296f55b6`); branch `feat/home-state-unverified` and draft
  PR #1428 already exist. Do not touch the unrelated working-tree changes (`.mcp.json`, `Cash management.md`,
  `trustee-new.md`).

## Open Questions

_None_ — the three decisions #1421 parked for a human (state-machine ownership, `!session` precedence, no
mobile layout) are answered on that Issue and applied here; the remaining choices above are grounded in
`docs/product-specs/kyb-lp-verification.md`, `docs/frontend/bank-transfers.md` and the Figma frame itself.

## Implementation Steps

1. **Extend the state seam.** `packages/frontend/src/components/homeState.ts`:

   ```ts
   export type HomeState = "zero" | "unverified" | "legacy";
   export type LpReadState = "unknown" | "absent" | "loaded" | "error";

   export interface DeriveHomeStateInput {
     hasSession: boolean;
     isConnected: boolean;
     lpRead?: LpReadState;   // default "unknown"
     kybStatus?: string;     // only meaningful when lpRead === "loaded"
   }
   ```

   Ordered rules (first match wins), mirroring the spec's precedence list:
   - `!hasSession` → `"zero"` (unchanged; wallet ignored).
   - `hasSession && !isConnected && (lpRead === "absent" || (lpRead === "loaded" && kybStatus === "NotStarted"))`
     → `"unverified"`.
   - otherwise → `"legacy"` (covers `unknown`/`error`, a connected wallet, and every other `kyb_status`).

   Do **not** treat `"InProgress"` as unverified — `kyb-lp-verification.md` records it as unreachable.

2. **Expose the LP read through the auth flow context.**
   `packages/frontend/src/auth/AuthFlowContext.ts` — widen `AuthFlowContextValue`:

   ```ts
   lpRead: LpReadState;
   kybStatus?: string;          // setup.lp?.kyb_status, undefined unless lpRead === "loaded"
   openAccountSetup(): void;    // re-opens CompanyDocsModal
   ```

   `packages/frontend/src/auth/AuthFlowProvider.tsx` — map the existing `SetupState.status`
   (`loading` → `"unknown"`, `absent`, `loaded`, `error`; `null` setup → `"unknown"`) into the provider value,
   pass `setup?.lp?.kyb_status`, and implement `openAccountSetup` as
   `setSetup((previous) => (previous ? { ...previous, open: true } : previous))` wrapped in `useCallback`.
   Memoize the context value with `useMemo` so the added fields do not re-render every consumer each tick.
   **No new request, no new state machine** — this only publishes what the provider already holds.

3. **Add the `PortfolioPlaceholderCard` disconnected variant.**
   `packages/frontend/src/components/PortfolioPlaceholderCard.tsx`:

   ```ts
   export type PortfolioPlaceholderCardVariant = "balance" | "connect-wallet";
   variant?: PortfolioPlaceholderCardVariant;   // default "balance" — every existing call site unchanged
   onConnectWallet?: () => void;
   ```

   When `variant === "connect-wallet"`: render the `Total Balance` eyebrow and `balanceLabel` as today, then —
   in place of both the `unrealizedPnlLabel` caption **and** the router `Link` — a single
   `<button type="button" onClick={onConnectWallet}>Connect wallet</button>` styled Body 16/22
   (`--text-pipeline-body`), `text-[color:var(--color-pipeline-brand)]`, `underline underline-offset-2`,
   `bg-transparent p-0 cursor-pointer` (the `withdrawClasses` idiom in `AddUsdCard.tsx`). `mobileHomeState` is
   ignored in this variant. Set `data-node-id="6701:97649"` and `data-variant` on the `Card` for this variant;
   keep `1497:95048` for `"balance"`. Tabs, chart, dates row and the `role="img"` aria-label are untouched
   (drop the PnL clause from the aria-label in this variant since no caption renders).

4. **Add the unverified desktop branch.** `packages/frontend/src/routes/index.tsx`:
   - `const { open: openAuthFlow, lpRead, kybStatus, openAccountSetup } = useAuthFlow();`
   - feed `lpRead` and `kybStatus` into the existing `deriveHomeState({ hasSession, isConnected, ... })` call.
   - inside the `hidden md:block` outer `Card`, add a third branch for `homeState === "unverified"`, built
     from the zero branch with exactly two swaps and the CTA rewiring:
     - col 1–4 row 1: `PortfolioPlaceholderCard variant="connect-wallet"` with `onConnectWallet={openConnectModal}`,
       `activePeriodId`/`onActivePeriodChange`/`series`/`yAxis`/`yAxisDomainMax` passed exactly as the legacy
       branch does (they resolve to the placeholder chart with no wallet), `data-testid="home-portfolio-placeholder"`.
     - col 5–7 rows 1–2: `RecentActivityCard` (unchanged).
     - col 1–2 row 2 (`data-node-id="6701:97659"`): `StartHereCard` + `StakeCard`, `gap-4`, wired to the
       route's existing `onBuy` / `onSell` / `onStake` (which already open the connect modal while
       disconnected, per the documented "Disconnected CTA rule") with `sellDisabled` from the existing
       `sellDisabled` expression — **not** `onSignUp`.
     - col 3–4 row 2 (`data-node-id="6701:97694"`): `AddUsdCard variant="verify"` with
       `onStartVerification={openAccountSetup}`, stacked above `EarnedCard`, `gap-4`.
     - col 1–7 row 3: `QnaSection` (unchanged).
   - Leave the `md:hidden` mobile block and the `"legacy"` branch byte-identical.

5. **Record the precedence rule.** `docs/product-specs/home-screen-states.md` (35 lines, well under the 200-line
   cap): flip row 2's Status to `Implemented (#1422)`, and extend `## Precedence rule` with the state-2 clause —
   wallet-not-connected is part of the condition (`NotStarted` + a connected wallet stays `"legacy"` until that
   combination is designed); an absent LP (404) is equivalent to `NotStarted`; an unknown or failed
   `GET /v1/lps/me` read renders `"legacy"`.

6. **Update the frontend docs.**
   - `docs/frontend/dashboard-components.md` § "Home route": add the unverified grid table and update the
     "Home state derivation" paragraph for the widened union, the new inputs, and the fact that `kyb_status`
     now reaches the route from `AuthFlowProvider` (no route-level `getMyLp`).
     § "PortfolioPlaceholderCard": document `variant` / `onConnectWallet`.
   - `docs/frontend/auth-components.md` § "AuthFlowProvider": document the widened `AuthFlowContextValue`.
   - `docs/frontend/bank-transfers.md`: correct the stale "Nothing here is mounted on `/`" claim — `locked`
     ships on `/` from #1421 and `verify` from #1422; the variant derivation lives in `homeState.ts`.
7. **User stories.** New `docs/user-stories/epic-1419/1422-home-unverified-state.md` in the #1421 format
   (Persona / Pre-conditions / Steps / Expected outcomes, desktop-only note), plus a row in
   `docs/user-stories/index.md` under "Epic #1419".
8. **Log, do not fix.** Add the `RecentActivityCard` "your" vs "all" copy mismatch to
   `docs/exec-plans/known-bugs.md`, and add two entries to `docs/exec-plans/tech-debt-tracker.md`: the
   legacy-layout flash while `GET /v1/lps/me` is in flight, and extracting the shared epic-#1419 desktop grid
   once states 3–6 land.
9. **Lint and build.** `yarn workspace @pipeline/frontend lint`, `yarn workspace @pipeline/frontend build`,
   `npx tsx scripts/lint-docs.ts`. Keep the comment-minimal rule: one 2–3-line spec-pointer header per file,
   no field/function JSDoc, no body or test comments in new code.

## Test Strategy

Vitest + React Testing Library, colocated. Commands: `yarn workspace @pipeline/frontend test`,
`yarn workspace @pipeline/frontend lint`, `yarn workspace @pipeline/frontend build`,
`npx tsx scripts/lint-docs.ts`.

- **`packages/frontend/src/components/homeState.test.ts`** (extend) — full truth table, keeping the four
  existing rows green:
  - no session → `"zero"` regardless of `isConnected`, `lpRead`, `kybStatus`.
  - session + disconnected + `lpRead: "loaded"` + `kybStatus: "NotStarted"` → `"unverified"`.
  - session + disconnected + `lpRead: "absent"` → `"unverified"`.
  - session + disconnected + `lpRead: "unknown"` / `"error"` → `"legacy"` (loading and failure never
    promote).
  - session + **connected** + `"NotStarted"` → `"legacy"` (wallet-connected is part of the condition).
  - session + disconnected + `"UnderReview"` / `"Passed"` / `"ChangesRequested"` / `"Failed"` /
    `"InProgress"` → `"legacy"` (states 3–6 not yet implemented; `InProgress` is unreachable).
- **`packages/frontend/src/components/PortfolioPlaceholderCard.test.tsx`** (extend) —
  `variant="connect-wallet"` renders a `Connect wallet` button, fires `onConnectWallet` on click, and renders
  **no** unrealized-PnL caption and **no** "Get PLUSD to start" link; the default variant still renders the
  caption and the link (regression).
- **`packages/frontend/src/auth/AuthFlowProvider.test.tsx` / `.setup.test.tsx`** (extend) — the context
  publishes `lpRead`/`kybStatus` for each of the four `getMyLp` outcomes (loading, 404, success, failure), and
  `openAccountSetup()` re-opens `CompanyDocsModal` after the user dismissed it.
- **`packages/frontend/src/routes/-index.test.tsx`** — new `describe("Home page — unverified state (#1422)")`
  with the `@/auth` mock seeded `isAuthenticated: true`, `lpRead: "loaded"`, `kybStatus: "NotStarted"`, wallet
  disconnected:
  - Top-left card shows `Total Balance`, `$0.00` and a `Connect wallet` control; clicking it calls the
    connect-modal mock. Neither `Get Started` nor `Sign Up` appears.
  - `AddUsdCard` renders with `data-variant="verify"`, heading "Verify your account", description
    "Complete KYB to unlock bank transfers."; clicking `Start Verification` calls the `openAccountSetup` mock.
  - Grid occupancy: `StartHereCard` + `StakeCard` in `home-balances-stack`; `AddUsdCard` + `EarnedCard` in
    `home-add-usd-stack`.
  - CTA wiring: `Buy` and `Stake` call the connect-modal mock (not the auth-flow mock); `Sell` is disabled.
  - `RecentActivityCard` empty placeholder and `QnaSection` render.
  - The route issues **no** `GET /v1/lps/me` of its own (`expect(mockGetMyLp).not.toHaveBeenCalled()` — the
    provider owns the request).
  - Regression rows: `lpRead: "unknown"`, `lpRead: "error"`, `kybStatus: "Passed"`, and wallet-connected each
    keep today's legacy rendering; the existing zero-state and legacy describes stay green unchanged.
- **Figma verification** — `ux-tester` runs the epic's QA pass against frame `6701:97538`
  (https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-97538&m=dev) using the new
  user-stories doc, verifying **composition, copy, colours and typography** — not the card dimensions the
  human accepted on #1421. Token-exact check: no raw hex, font, size or radius literals introduced; the
  `Connect wallet` link resolves `--color-pipeline-brand` and `--text-pipeline-body` from
  `packages/ui/src/styles/theme.css`.

## Docs to Update

- `docs/product-specs/home-screen-states.md` — state-2 status + the precedence clause (required by the Issue).
- `docs/frontend/dashboard-components.md` — § "Home route" (unverified grid table + `deriveHomeState` inputs);
  § "PortfolioPlaceholderCard" (`variant` / `onConnectWallet`).
- `docs/frontend/auth-components.md` — § "AuthFlowProvider" (widened `AuthFlowContextValue`).
- `docs/frontend/bank-transfers.md` — correct the stale "Nothing here is mounted on `/`" claim.
- `docs/user-stories/epic-1419/1422-home-unverified-state.md` — new.
- `docs/user-stories/index.md` — new row under "Epic #1419 — LP home screen states".
- `docs/exec-plans/known-bugs.md` — `RecentActivityCard` "your" vs "all" copy mismatch.
- `docs/exec-plans/tech-debt-tracker.md` — the in-flight-LP-read layout flash; extracting the shared
  epic-#1419 desktop grid once states 3–6 land.
