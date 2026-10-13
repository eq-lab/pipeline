# Issue #1475: Account page opens on the connected wallet's tab; LP home heading reads "Welcome back" whenever the header shows the account icon

Source: https://github.com/eq-lab/pipeline/issues/1475

Epic: #1419 (LP home screen states). Follows #1458 (wallet-only Account variant, header account
icon) and #1460 (home state 7).

## Scope

Two behaviour fixes, nothing more.

**1. `/account` entry tab.** On entering `/account`, once wallet state has settled, pick the
wallet card's tab one time:

| Connected namespaces | Entry tab |
|---|---|
| EVM only | `evm` |
| Stellar only | `stellar` |
| both | persisted view (`useWalletView().kind`, unchanged) |
| none | persisted view (unchanged, today's behaviour) |

The chosen kind is persisted through `setKind` (writes `pipeline.wallet.view.kind`). This runs
once per entry. It does not keep the tab in sync afterwards: the LP can still switch tabs, and the
per-tab semantics from #1458 stay (looking at the other namespace's tab shows its own
`Connect Wallet` state). It applies to all three `AccountPage` branches: signed-in
(`ProductionAccountPage`), wallet-only (#1458) and the dev-only `?state=` preview. The preview
fixtures only override the Documents card, and `AccountWalletCard` always reads the real wallets,
so the entry rule holds there unchanged. The effect sits in `AccountRoute`, which renders all three
branches, so no per-branch wiring is needed.

**2. Home heading.** `WelcomeHeader` renders one string at every breakpoint:

- **"Welcome back"** when `isAuthenticated || isAnyConnected`. This is the same condition that
  shows the header account icon (#1458).
- **"Welcome"** otherwise, i.e. zero state only.

The desktop-only "Welcome" branch and the `md:hidden` / `hidden md:inline` span split go away.
`routes/index.tsx` computes the condition and passes it down as a prop. The header component
gets no wallet hooks. The prop no longer takes the active-view `isConnected`.

Figma check (local Dev Mode MCP, cached design context `7149:16035`, the state-7 `Heading`
inside frame `7149:16033`): the heading reads "Welcome back". That matches the other
connected / signed-in frames recorded on #1421–#1424. The earlier "desktop reads Welcome" accepted
difference is retired.

**Out of scope:** making `ConnectWalletModal` call `setKind` on connect; deriving the home grid
from any-wallet presence (the TD-138 product decision); any change to `deriveHomeState`, the
mobile stack's `isConnected` branching, `AccountWalletCard` internals, or the route gate.

## Assumptions and Risks

- **Settle timing (#1458).** On a hard refresh, connection is not known synchronously: wagmi
  reconnects after mount, and Stellar hydrates through `getAddress()` in a mount effect. The
  effect therefore waits for `useWalletPresence().isSettled` before deciding. The decision is
  taken on the first settled render and never again, so it does not fight a later tab click.
  - Residual risk: if a settled render ever reports EVM `disconnected` before wagmi's hydrate
    flips it to `reconnecting`, a both-connected visitor could be moved to `stellar`.
  - The route gate already trusts `isSettled` for its redirect, so this is the same, accepted
    assumption. It is harmless in practice: the moved-to tab is a connected one.
- **One-shot mechanics.** A `useRef` flag guards the effect.
  - React StrictMode keeps refs across its simulated remount, so the effect fires once.
  - Leaving `/account` unmounts `AccountRoute`. Re-entering is a new entry and gets a new decision.
  - A `?state=` search change keeps the component mounted, so it gets no new decision.
- **Flash.** On client-side entry, wallets are already settled. A plain `useEffect` would paint
  the persisted tab for one frame before switching. Use `useLayoutEffect` so the switch commits
  before paint. On a hard refresh the card shows the persisted tab until settle anyway, the same
  unsettled behaviour as today.
- **`setKind` is not memoized** in `WalletViewProvider` (it gets a new identity every render).
  Effect deps re-run harmlessly because the ref guards them. Do not memoize it in this issue.
- **Existing test mocks** of `useWalletPresence` (`-account.test.tsx`,
  `-account-route-dev-only.test.tsx`, `AccountPage.test.tsx`) return no `onlyConnectedKind`.
  `undefined` means "keep persisted", so they keep passing unchanged. They may be extended but
  don't have to be.
- **TD-138 is narrowed, not closed.** Persisting the auto-selected kind makes the home grid agree
  with the header once the visitor has entered `/account`. A visitor who connects Stellar and
  stays on `/` without visiting `/account` still keeps the default EVM view: the header shows the
  account icon (and, after this issue, "Welcome back") over the zero-state grid. Closing TD-138
  still needs the product decision recorded there.
- No dependency on unmerged work. #1458, #1460 and #1473/#1474 are on `main`, and this branch is
  cut after them.

## Open Questions

_None_

## Implementation Steps

1. **`packages/frontend/src/wallet/useWalletPresence.ts`**: expose the single connected
   namespace.
   - Add `onlyConnectedKind: WalletViewKind | undefined` to `UseWalletPresenceResult`. Import the
     type from `./WalletViewContext`.
   - Derive it from the `evm` / `stellar` objects the hook already reads:
     - `"evm"` when `evm.isConnected && !stellar.isConnected`;
     - `"stellar"` when `stellar.isConnected && !evm.isConnected`;
     - `undefined` when both or neither are connected.
   - Keep `isAnyConnected`, `isSettled` and `disconnectAll` unchanged.
   - Keep the single spec-pointer header. No JSDoc.

2. **`packages/frontend/src/routes/account.tsx`**: add the one-shot entry selection in
   `AccountRoute`.
   - Destructure `onlyConnectedKind` alongside `isAnyConnected, isSettled, disconnectAll`.
   - Add `const { kind, setKind } = useWalletView();` (from `@/wallet`).
   - Add `const entryTabChosen = useRef(false);`.
   - Add a `useLayoutEffect` with deps `[isSettled, onlyConnectedKind, kind, setKind]`:
     - If `entryTabChosen.current` is set, or `!isSettled`, return.
     - Otherwise set `entryTabChosen.current = true`.
     - If `onlyConnectedKind && onlyConnectedKind !== kind`, call `setKind(onlyConnectedKind)`.
   - Place it before the `if (blocked) return null` early return (hooks order). When blocked,
     nothing is connected, so it is a no-op.
   - `AccountPage.tsx` and `AccountWalletCard.tsx` need no change. The card already renders
     `activeId={kind}` from `useActiveWalletAccount()`, which reads the same `useWalletView()`
     context.
   - No new comments.

3. **`packages/frontend/src/components/WelcomeHeader.tsx`**: make the heading breakpoint-agnostic.
   - Replace the `isConnected` prop with `isReturning?: boolean` (default `false`). Delete its
     JSDoc block.
   - Render `<h1 …>{isReturning ? "Welcome back" : "Welcome"}</h1>`. This drops both `<span>`s,
     the `md:hidden` / `hidden md:inline` split and the inline JSX comment.
   - Keep `headingClasses`, the `data-testid="home-welcome-header"` passthrough,
     `data-testid="home-welcome-heading"` and the desktop `HomeStatsStrip`.
   - Collapse the two `// spec:` lines into one header:
     `// spec: docs/frontend/dashboard-components.md#welcomeheader`.

4. **`packages/frontend/src/routes/index.tsx`**: pass the header-icon condition.
   - Import `useWalletPresence` from `@/wallet` (the existing import block).
   - `const { isAnyConnected } = useWalletPresence();`
   - Change the JSX to `<WelcomeHeader isReturning={isAuthenticated || isAnyConnected} data-testid="home-welcome-header" />`.
   - Every other use of the active-view `isConnected` stays as is (grid, mobile stack, CTAs).

5. Run `pnpm --filter frontend lint`, the typecheck/build, and the frontend unit tests. Fix any
   test that relied on the old two-span DOM.

## Test Strategy

**`packages/frontend/src/wallet/useWalletPresence.test.tsx`**: add a `onlyConnectedKind`
describe block with these cases, reusing `setWallets`:

| EVM | Stellar | Expected `onlyConnectedKind` |
|---|---|---|
| connected | not connected | `"evm"` |
| not connected | connected | `"stellar"` |
| connected | connected | `undefined` |
| not connected | not connected | `undefined` |

**New `packages/frontend/src/routes/-account-entry-tab.test.tsx`**: the issue's "Done when" for
`/account`.

Setup:
- Mock `@/wallet`'s `useWalletPresence` from hoisted mutable state:
  `{ isAnyConnected, isSettled, onlyConnectedKind, disconnectAll }`.
- Mock `useActiveWalletAccount` to forward the real `useWalletView()`'s `kind` / `setKind`
  (`isConnected: false`, other fields inert), so the real `AccountWalletCard` tabs reflect the
  context.
- Render the route component (same `Route.options.component` pattern as `-account.test.tsx`)
  inside the real `WalletViewProvider`, with an authenticated session (`saveSession`) and a
  mocked `getMyLp`. Mock `useNavigate`.
- Clear `localStorage` between cases.

Cases:
- **Stellar only, persisted `evm`.** The Stellar tab is selected, and
  `localStorage["pipeline.wallet.view.kind"] === "stellar"`.
- **EVM only, persisted `stellar`.** The Ethereum tab is selected, and storage is `"evm"`.
- **Both connected.** Persisted `stellar` stays `stellar`, and persisted `evm` stays `evm`.
- **None connected** (`ENV.IS_DEV` true so the gate admits). The persisted kind is kept.
- **Settle timing.** Start with `isSettled: false, onlyConnectedKind: undefined`. The persisted
  tab stays. Rerender with `isSettled: true, onlyConnectedKind: "stellar"`, and the Stellar tab
  is selected.
- **Still switchable.** Stellar only: after entry, click `Ethereum`. The Ethereum tab stays
  selected across a rerender (one-shot, not a sync), and storage is `"evm"`.
- **Wallet-only variant.** Run the Stellar-only case with no session. Pin the wallet-only
  composition (e.g. the `Add email` row present) to prove the effect covers that branch.
- **Preview.** Run the Stellar-only case with `state: "verified"` under `IS_DEV`. The Stellar
  tab is selected.

Assert tab selection through `SegmentedTabs`' selected state (`aria-selected` / the attribute
`AccountWalletCard.test.tsx` already uses).

**New `packages/frontend/src/components/WelcomeHeader.test.tsx`**:
- `isReturning` true renders "Welcome back" exactly once.
- Default (and `false`) renders "Welcome" exactly once, and "Welcome back" is absent.
- The heading has no `md:hidden` / `hidden` descendants, i.e. one text node for every
  breakpoint.

**`packages/frontend/src/routes/-index.test.tsx`**:
- Keep the three existing "Welcome back" tests.
- Add the per-state heading cases, using the existing mock-localStorage wallet keys
  (`pipeline.mock.wallet.address` / `pipeline.mock.wallet.stellar.address`) and `mockAuthState`.
  Assert `getByTestId("home-welcome-heading")` text content:

| State | Expected heading |
|---|---|
| Zero: `isAuthenticated: false`, no wallet | "Welcome" |
| Wallet-only: no session, EVM mock connected | "Welcome back" |
| Wallet-only, Stellar connected on the default EVM view (the TD-138 combination) | "Welcome back" |
| Signed-in, disconnected | "Welcome back" |
| Signed-in, connected | "Welcome back" |

- jsdom applies no media queries, so "both breakpoints" is proven structurally: there is a
  single string node in `home-welcome-heading` (no responsive variants), and the
  `WelcomeHeader` unit test pins it.

**Live check (ux-tester / QA).** Desktop and 402px mobile `/`: the heading text matches frames
`6701:98220` (zero, "Welcome"), `6701:97538`, `6701:98417`, `6701:97340` and `7149:16033`
("Welcome back"). `/account` with a Stellar-only real wallet opens on the Stellar tab with the
`Disconnect` row.

## Docs to Update

- **`docs/product-specs/home-screen-states.md`**: add a `## Heading` section (after
  `## Precedence rule`):
  - The home heading is independent of the derived state.
  - It reads "Welcome back" at every breakpoint when `isAuthenticated || isAnyConnected` (the
    header account-icon condition, #1458), and "Welcome" otherwise, i.e. state 1 only.
  - Matches Figma for states 1–4 and 7; #1475.
- **`docs/frontend/dashboard-components.md`**:
  - `### WelcomeHeader`: rewrite the responsive behaviour. The 64px desktop / 32px mobile sizes
    are unchanged.
    - Remove "Always renders 'Welcome' — connected desktop states are out of scope for issue
      #466".
    - Remove the "`isConnected` prop is mobile-only … both variants are always rendered in the
      DOM" paragraph.
    - Document the `isReturning` prop: one string at all breakpoints, supplied by the home route.
  - `#home-route` mobile item 1 (line ~1701): replace "On mobile the `isConnected` prop drives …
    ignored on desktop" with: the route passes `isReturning={isAuthenticated || isAnyConnected}`,
    the same string at every breakpoint (#1475).
- **`docs/frontend/account-page.md`**:
  - `## Wallet card`: add an "Entry tab (#1475)" paragraph.
    - The table above.
    - It is decided once, from `useWalletPresence().onlyConnectedKind`, after `isSettled`, in
      `AccountRoute` (a layout effect plus a ref).
    - The choice is persisted via `setKind`, and is not a sync: tabs stay a view switch.
    - It applies to the signed-in, wallet-only and `?state=` preview branches.
  - `## Wallet-only variant (#1458)`: one line saying the card opens on the connected
    namespace's tab (link to the paragraph above).
  - `## Route gate`: mention that the route also owns the entry-tab effect.
- **`docs/frontend/hooks.md`**:
  - `useWalletPresence` row: add `onlyConnectedKind` (`"evm"` / `"stellar"` when exactly one
    namespace is connected, else `undefined`). Add `/account` entry-tab selection to consumers.
  - `useActiveWalletAccount` row: unchanged.
- **`docs/exec-plans/tech-debt-tracker.md` TD-138**: add a "Narrowed by #1475 (2026-10-13)"
  bullet. Keep the entry open.
  - Entering `/account` now persists the single connected namespace as the active view, so the
    grid agrees with the header from then on.
  - The home heading now keys on the header condition.
  - Remaining gap: a visitor who connects one namespace and never opens `/account` still sees
    the zero-state grid under the account icon.
- **`docs/user-stories/epic-1419/1421-home-zero-state.md`**: in the Story 1 grid outcome
  (line ~56), say the welcome heading reads "Welcome".
- **`1422-home-unverified-state.md`**: line ~66, say the heading reads "Welcome back" (signed-in,
  disconnected; matches frame `6701:97540`).
- **`1423-home-kyb-pending-state.md`**: line ~83 already says "Welcome back". Add "(#1475; matches
  the frame)" so QA no longer treats it as aspirational.
- **`1424-home-plusd-held-state.md`**: add the heading "Welcome back" to the Story 1 grid outcome.
  Its two listed deviations are unrelated and stay.
- **`1460-home-wallet-only-state.md`**:
  - Story 1 grid outcome: add the heading "Welcome back".
  - Story 5 (line ~147): replace "(mobile keys the greeting on `isConnected`, independent of
    session)" with "(the heading keys on `isAuthenticated || isAnyConnected` at every breakpoint,
    #1475)".
- **`1458-wallet-only-account.md`** Story 5:
  - Step 1: "Load `/account` — the card opens on the connected EVM tab regardless of the
    persisted view (#1475)".
  - Step 2's other-tab outcome stays true after entry.
- **New `docs/user-stories/epic-1419/1475-account-entry-tab-welcome-back.md`**, with these stories:
  1. Stellar-only visitor lands on the Stellar tab (wallet-only and signed-in).
  2. EVM-only visitor with a persisted `stellar` view lands on Ethereum.
  3. Both connected keeps the persisted tab.
  4. Hard refresh: the tab is chosen after reconnect settles.
  5. The tab is still switchable after entry and is not snapped back.
  6. Returning to `/` after entering `/account` Stellar-only shows the grid on the Stellar view
     (TD-138 narrowed).
  7. The home heading per state, at desktop and 402px.
- **`docs/user-stories/index.md`**: add the #1475 row under `## Epic #1419 — LP home screen
  states`.
