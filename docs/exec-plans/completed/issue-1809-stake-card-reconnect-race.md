# Issue #1809: LP home: Stake card opens the connect/sign-in flow for an already-connected wallet, then jumps to /stake a few seconds later

Source: https://github.com/eq-lab/pipeline/issues/1809

Labels: `frontend`, `bug`. Parent epic: #463 (Home page). Branch `fix/1809-stake-card-reconnect-race`,
draft PR #1861. No Figma reference: a behaviour fix with no new UI. The only visual change is the
existing `"loading"` skeleton (#1576) showing for longer; no new tokens, components or copy.

## Scope

### Root cause (what the code does today)

- `packages/frontend/src/routes/index.tsx` gates `onBuy` / `onSell` / `onStake` on
  `isConnected = kind === "stellar" ? stellar.isConnected : evm.isConnected`. After a reload,
  wagmi's `useAccount()` reports `isConnected: false` while `status` is `"connecting"` or
  `"reconnecting"`. That covers the time it takes to run the Hydrate effect and then
  `reconnect(config)`, which awaits `getProvider()` / `isAuthorized()` for every connector,
  WalletConnect included, so it can take seconds. Stellar's `connectionStore` address stays
  `undefined` until the mount effect's `StellarWalletsKit.getAddress()` resolves. A click in that
  window calls `useConnectModal().open()`.
- `ConnectModalProvider.open()` returns early only when `isAnyConnected` is true, and
  `isAnyConnected` is still `false` during the window. So the wallet picker (or the terms gate)
  opens for a wallet that is about to reconnect.
- The desktop grid has a second route into a modal. `deriveHomeState` returns `"zero"` for a
  sessionless visitor whose wallet has not reconnected yet, and the zero-state `CompactBalances`
  wire Stake / Buy / Sell to `onSignUp`, which opens `EmailAuthFlow` ("create-account"). That is the
  "sign-in flow" half of the report. It also breaks the precedence rule "zero state = no session
  AND no wallet" for the length of the reconnect. A signed-in LP whose wallet is still reconnecting
  falls into `"unverified"` (which opens the connect modal) or `"legacy"` for the same window.
- A signal for the window already exists: `useEvmWallet().isSettled` (wagmi status is not
  `connecting` / `reconnecting`), `useStellarWallet().isSettled` (the `connectionStore` settled
  flag) and `useWalletPresence().isSettled`. Today only `/account` and `useSingleWalletInvariant`
  read it. The home CTAs, the connect modal and the `/stake` and `/deposit` steps-card row ignore
  it.
- **Delayed navigation.** A full search of `packages/frontend/src` turns up no code path that goes
  to `/stake` without a user click. The searches covered `navigate(`, `<Link to="/stake"`,
  `redirect(`, `history.*`, `window.location`, and every effect in `ConnectWalletModal`,
  `ConnectModalProvider`, `WalletGateProvider`, `AuthFlowProvider`, `useEmailAuthFlow` and
  `useSessionEndSignOut`. The only `/stake` navigations are `onStake` / `onUnstake`, the
  `PortfolioPlaceholderCard` "Stake PLUSD" links, the TopBar / MobileNavMenu "Earn" items and the
  claim toast in `deposit.tsx`. No connect-flow effect is keyed on `isConnected`, so the plan has
  no auto-navigation code to remove. See Open Questions and Assumptions and Risks.

### In scope

1. **One "connection pending" signal.** Add `isConnectionPending` to `useWalletPresence()`, defined
   as `!isAnyConnected && !isSettled`. It is true only while no wallet has reported connected and
   at least one kit is still restoring or establishing a connection. If any wallet is already
   connected, the state is not pending: the single-wallet rule (#1512) means that wallet is the
   active one, so a Stellar user is not held up by wagmi's slow connector scan.
2. **Home CTAs treat a pending reconnect as connected** (the issue's second option). `onBuy`,
   `onSell` and `onStake` navigate when `isConnected || isConnectionPending` and open the connect
   modal only when the wallet layer has settled with nothing connected. The navigation is
   immediate, never deferred, so nothing navigates later. `/deposit` and `/stake` have no auth or
   connection guard, and the next item stops them flashing their connect row while pending.
   `sellDisabled` and `stakeDisabled` keep their current formulas.
3. **The steps-card connect row on `/stake` and `/deposit`** (the "Connect your wallet first" row
   that TopBar "Earn" and the home Buy / Sell / Stake land on) renders nothing while
   `isConnectionPending`, the same way `deposit.tsx` already renders `null` for
   `isInitialDataLoad`. It appears only once the layer has settled with no wallet, so its
   `Connect` button can never open the modal for a reconnecting wallet. This follows the
   no-standalone-banner rule: the fix stays inside the existing steps-card slot.
4. **`ConnectModalProvider.open()` waits for the pending state to settle.** A call made while
   `isConnectionPending` is remembered, not acted on. When the state settles:
   - if a wallet connected, the request is dropped and no modal opens;
   - if nothing connected, the normal path runs (terms gate first when terms are not
     acknowledged, then `ConnectWalletModal`).

   This one choke point covers every other connect CTA: the mobile `ConnectWalletPromoCard`, the
   hero `onConnectWallet` variants, `transactions.tsx`, `useActiveWalletAccount`, and
   `EmailAuthFlow`'s `onConnectWallet`. The connect modal never opens for a wallet that is about to
   reconnect. What runs after settling is a modal open the user asked for. It is not a navigation.
5. **`deriveHomeState` gets a `walletPending` input**, checked first, before the `hasSession`
   branch, and returns `"loading"`. A pending reconnect then renders the existing #1576 skeleton
   (no CTAs) instead of flashing `"zero"`, `"unverified"` or `"legacy"`. This keeps "zero state =
   no session AND no wallet" true. `walletPending` defaults to `false`, so other callers are
   unaffected.

### Out of scope

- `@pipeline/wallet-connect`'s own `ConnectModalProvider` (Trustee app). wallet-flows.md already
  scopes #1512 to the LP app.
- The mobile hero swap (`isConnected ? PortfolioPlaceholderCard : ConnectWalletPromoCard`): during
  a pending reconnect it still shows the promo card. Its `Connect` is covered by item 4, so this is
  cosmetic only. Not changed, because the spec keeps mobile branching on `isConnected` alone.
- Other connect rows that flash during reconnect (e.g. `transactions.tsx`). These are covered
  behaviourally by item 4. Hiding them while pending is not requested by the issue.
- Any change to the staging basic-auth double boot (see Risks). The user has rejected app-side
  boot guards.

## Assumptions and Risks

- **Assumption: the pending window is what the reporter hit.** The fix removes the connect / sign-up
  modal for a reconnecting wallet and makes Stake go straight to `/stake`. The delayed jump has no
  code source (see Root cause). If it still reproduces after this change on a clean URL, it is
  outside this fix and needs a follow-up Issue.
- **Risk: two app copies on staging.** Memory `staging-basic-auth-url-double-boot` says the LP
  bundle also boots twice when the URL carries `user:pass@`, with each copy running its own
  wagmi/Stellar state and router. Two copies handling one click could explain a modal from a copy
  that is still reconnecting plus a later `/stake` from a copy that already settled. This is not
  proven. Do not propose index.html scripts or boot guards. Verify on a clean URL.
- **Risk: wagmi's first frame.** Before WagmiProvider's Hydrate `onMount` effect calls
  `reconnect()`, the wagmi store reports `status: "disconnected"`. EVM `isSettled` is therefore
  `true` for the first commit, so for one frame `isConnectionPending` depends on Stellar's settled
  flag alone. A click cannot land in that frame, so the race in the issue is closed. If a one-frame
  zero-state flash is visible in the browser, note it in the PR. Do not add a boot guard.
- **Risk: user-initiated connects.** wagmi also reports `"connecting"` while the user approves a
  wallet picked in `ConnectWalletModal`, so during that time the home grid shows the loading
  skeleton behind the wallet prompt. This is accepted: a connection really is pending. A rejection
  returns to `"disconnected"` and the state the user had before.
- **Risk: sessionless visitors with no wallet** see the skeleton until wagmi's connector scan
  finishes (up to a second or two with WalletConnect) instead of the zero state straight away. This
  follows the zero-state precedence rule. Mention it in the PR so the reviewer sees it in the
  browser.
- **Risk: existing tests.** `routes/-index.test.tsx` mocks `wagmi.useAccount` without `status`,
  so EVM reads as settled. It uses the real `useStellarWallet`, whose settled flag flips only after
  the mocked `getAddress()` resolves, so the first render is now `"loading"` for disconnected
  cases. Assertions that run synchronously on the first render may need `findBy*` / `waitFor`, or
  the Stellar connection store must be marked settled in `beforeEach`. Fix the setup. Do not weaken
  assertions. The same applies to `-stake.test.tsx`, `-deposit.test.tsx` and
  `ConnectModalProvider.test.tsx`, whose `presence` mock must gain `isConnectionPending: false`.
- **Doc cap.** `docs/product-specs/home-screen-states.md` is at 198 lines and `scripts/lint-docs.ts`
  errors above 200. Add the new sentence to an existing paragraph line. Do not add lines.
- No dependency on #1810 (stale activity, different files) or on other open work.

## Open Questions

- Was the report reproduced from a staging URL that carries basic-auth credentials (`user:pass@`)?
  If so, the delayed jump to `/stake` is probably the known LP double boot, and the click-time race
  fixed here is the only in-app defect. If it was a clean URL, the delayed navigation has no code
  path in `packages/frontend/src`, and a short screen recording or console log of the jump would be
  needed to chase it. Non-blocking: the implementation below is the same either way, and the
  regression test pins "nothing navigates after the modal opens".

## Implementation Steps

1. **`packages/frontend/src/wallet/useWalletPresence.ts`**
   - Add `isConnectionPending: boolean` to `UseWalletPresenceResult` and return
     `!(evm.isConnected || stellar.isConnected) && !(evm.isSettled && stellar.isSettled)`. Reuse
     the existing `isAnyConnected` / `isSettled` expressions; do not duplicate them.
   - Keep the single `// spec:` header. Add no comments.
2. **`packages/frontend/src/components/homeState.ts`**
   - Add `walletPending?: boolean` to `DeriveHomeStateInput`, defaulting to `false`.
   - First line of `deriveHomeState` body after destructuring:
     `if (walletPending) return "loading";`.
3. **`packages/frontend/src/routes/index.tsx`**
   - Destructure `isConnectionPending` from the existing `useWalletPresence()` call.
   - Pass `walletPending: isConnectionPending` to `deriveHomeState`.
   - Add `const canProceed = isConnected || isConnectionPending;` and use it in `onBuy`, `onSell`
     and `onStake` in place of `isConnected` for the gate. Each handler still calls
     `openConnectModal()` and returns when `!canProceed`, otherwise navigates as today
     (`/deposit?direction=deposit|withdraw`, `/stake?tab=stake`).
   - Leave unchanged: `sellDisabled`, `stakeDisabled`, `mobileHomeState`, the zero-state
     `onSignUp` wiring (unreachable while pending because the state is `"loading"`), and every
     other `isConnected` read.
4. **`packages/frontend/src/wallet/ConnectModalProvider.tsx`**
   - Read `isConnectionPending` alongside `isAnyConnected` from `useWalletPresence()`.
   - Add a `useRef<boolean>(false)` "requested while pending" flag.
   - `open()`:
     1. return if `isAnyConnected`;
     2. if `isConnectionPending`, set the flag and return;
     3. otherwise run the current terms-gate / `openModal` branch.

     Move that branch into one `useCallback` (e.g. `openNow`) so `open()` and the settle effect
     share it.
   - `useEffect` on `[isConnectionPending, isAnyConnected, openNow]`: when
     `!isConnectionPending` and the flag is set, clear the flag, then call `openNow()` only if
     `!isAnyConnected`.
   - Add one `// spec: docs/frontend/wallet-flows.md#single-connected-wallet` header and drop the
     narrative JSDoc block and inline comments in this file. Check
     `scripts/lint-comments.baseline.json` and shrink its entry if this file is listed.
5. **`packages/frontend/src/routes/stake.tsx`** (around line 344)
   - Destructure `isConnectionPending` from `useWalletPresence()` (import from `@/wallet`).
   - Change the steps slot to
     `isConnectionPending ? null : !flow.isConnected ? <connect row> : …`, leaving the remaining
     branches unchanged.
6. **`packages/frontend/src/routes/deposit.tsx`** (around line 591)
   - Same change: `isConnectionPending ? null : !flow.isConnected ? <connect row> : isInitialDataLoad ? null : …`.
   - Do not touch the per-button `!flow.isConnected` disables (lines ~520/548/702/713): the action
     buttons stay disabled while pending, which is correct.
7. **`packages/frontend/src/wallet/index.ts`**
   - No new export is needed, since `useWalletPresence` is already exported. Confirm `stake.tsx`
     and `deposit.tsx` import it from `@/wallet`.
8. **Lint and build**:
   - `npx tsx scripts/lint-docs.ts`
   - `npx tsx scripts/lint-comments.ts`
   - `yarn workspace @pipeline/frontend lint`
   - the frontend unit tests
   - `yarn build` for the frontend workspace (no new route, so no routeTree regeneration is
     needed)
9. **Manual verification**, by the user in their own browser (do not drive it; ask them to report).
   Hard-refresh the LP home on a clean URL (no `user:pass@`):
   - with a Stellar wallet connected, click Stake as soon as it appears: `/stake?tab=stake` opens,
     there is no connect / sign-up modal, and no later navigation;
   - repeat with an EVM wallet;
   - with no wallet, click Stake once the grid renders: the connect modal (or terms gate) opens,
     and nothing navigates after dismissing it or after waiting about 10 s;
   - click TopBar "Earn" right after the reload: `/stake` shows no "Connect your wallet first" row
     flash for a connected wallet.

## Test Strategy

- **`wallet/useWalletPresence.test.tsx`**: test `isConnectionPending` across these cases:
  - neither connected, both settled → `false`;
  - neither connected, EVM unsettled → `true`;
  - neither connected, Stellar unsettled → `true`;
  - Stellar connected, EVM unsettled → `false`;
  - EVM connected, Stellar unsettled → `false`.
- **`components/homeState.test.ts`**:
  - `walletPending: true` returns `"loading"` for a sessionless visitor (instead of `"zero"`) and
    for a session with `lpRead: "loaded"` and each KYB status, including `NotStarted`, which would
    otherwise be `"unverified"`;
  - omitted or `false` leaves every existing expectation unchanged.
- **`wallet/ConnectModalProvider.test.tsx`** (extend the `presence` mock with
  `isConnectionPending`):
  - `open()` while pending renders no modal and no gate;
  - flipping to settled with `isAnyConnected: true` never opens either;
  - flipping to settled with nothing connected opens the terms gate when terms are not
    acknowledged and `ConnectWalletModal` when they are;
  - `open()` when settled and disconnected behaves exactly as before;
  - a second `open()` while pending still yields a single open after settling.
- **`routes/-index.test.tsx`**:
  - Pending (mock `useAccount` with `status: "reconnecting"`, `isConnected: false`, no mock
    wallet): the desktop grid renders `home-loading-block`, not `home-connect-wallet-card`.
  - Pending: mobile Stake / Buy call `navigate` with `/stake?tab=stake` and
    `/deposit?direction=deposit`, and `mockConnectModalOpen` is not called.
  - Settled and disconnected: clicking Stake calls `mockConnectModalOpen` and not `navigate`. Then
    rerender as connected (mock wallet keys); `navigate` is still not called. This is the regression
    test for "nothing navigates after the modal opened".
  - Settled and connected: Stake navigates immediately (existing behaviour).
  - Fix any existing tests that now see the `"loading"` first render (see Risks) with `findBy*` or
    by marking the Stellar store settled. Do not delete assertions.
- **`routes/-stake.test.tsx` / `routes/-deposit.test.tsx`**:
  - pending → no `connect-wallet-banner`;
  - settled and disconnected → `connect-wallet-banner` present (existing).

## Docs to Update

- **`docs/product-specs/home-screen-states.md`** (must stay ≤ 200 lines, so extend existing lines):
  - In the "State 1 (zero state) requires both no auth session and no connected wallet"
    paragraph, add: while the wallet layer is still restoring a connection
    (`useWalletPresence().isConnectionPending`), `deriveHomeState` returns `"loading"` ahead of
    every branch, so a reconnecting wallet never renders state 1, state 2 or legacy (#1809).
  - Check with `wc -l` and `npx tsx scripts/lint-docs.ts`.
- **`docs/frontend/dashboard-components.md`**:
  - "Disconnected CTA rule (#1152, #1151)": Buy / Sell / Stake treat a pending reconnect as
    connected and navigate. The connect modal opens only once the wallet layer has settled with no
    wallet (#1809).
  - "Home state derivation": add `walletPending?` to the signature and the precedence sentence
    ("`"loading"` first when `walletPending`").
  - "Loading composition (#1576)": add that it also covers a pending wallet reconnect.
  - The `/stake` and `/deposit` steps-slot descriptions (banner precedence): the connect row is
    hidden while pending.
- **`docs/frontend/hooks.md`**, `useWalletPresence` row: add `isConnectionPending` (definition and
  consumers: home route, `ConnectModalProvider`, `/stake`, `/deposit`).
- **`docs/frontend/wallet-flows.md#single-connected-wallet`**: `ConnectModalProvider.open()` is a
  no-op while `isAnyConnected`. A call made while `isConnectionPending` waits until the state
  settles and opens only if nothing connected (#1809).
- No known-bugs or tech-debt entries are expected. If the double-boot explanation is confirmed,
  note it on the Issue, not in code.
