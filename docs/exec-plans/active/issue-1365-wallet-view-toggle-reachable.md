# Issue #1365: Frontend: EVM/Stellar wallet-view toggle unreachable for unauthenticated LPs after #1362

Source: https://github.com/eq-lab/pipeline/issues/1365 (parent epic #1494 — EVM support for the LP app)

## Findings (re-verification against current `main`)

The Issue was filed before #1458/#1466 and #1475 landed. Re-checked on this branch:

1. **The toggle itself is now reachable without a session.** `routes/account.tsx` only blocks when
   `!ENV.IS_DEV && !isAuthenticated && !isAnyConnected`, so any visitor with *either* wallet
   connected reaches `/account` (wallet-only variant, #1458), and `TopBar`/`MobileNavMenu` show the
   account icon on `isAuthenticated || isAnyConnected`. `AccountWalletCard`'s `Ethereum`/`Stellar`
   `SegmentedTabs` call `useWalletView().setKind` there, and each tab offers its own
   `Connect Wallet` / `Disconnect`. #1475 additionally persists the single connected namespace as
   the active view on entering `/account`. The literal problem in the Issue body ("a wallet-only LP
   can no longer switch the active wallet view") is therefore resolved by #1458 + #1475.
2. **A visitor with no wallet and no session does not need the toggle** — `ConnectWalletModal`
   carries its own EVM / Soroban tabs, so choosing a chain happens in the modal.
3. **`AccountDropdown` is mounted nowhere.** `AccountDropdown.tsx` / `useAccountDropdown.ts` are
   imported only by `AccountDropdown.test.tsx`. Tracked as **TD-112** (the Issue's "TD-93" — the
   frontend Known-Gaps numbering was renumbered by #1390; the Issue's "TD-92" is now **TD-111**,
   already resolved by #1458).
4. **Residual gap (TD-138):** connecting a wallet never changes the active view. `setKind` is only
   called by `/account` (tabs + #1475 entry rule). A sessionless visitor whose persisted view is
   `evm` (the default) who connects Freighter from the home page keeps `kind === "evm"`: header shows
   the account icon, but the home grid (`deriveHomeState` reads the active view), `RecentActivityCard`,
   `useDepositFlow`, `useStakeFlow`, `usePnl`, `useRequests` etc. all stay on the disconnected EVM
   view until the visitor happens to open `/account`. Symmetrically, an LP whose persisted view is
   `stellar` who connects MetaMask stays on Stellar — this is exactly the "cannot enter the EVM view"
   concern epic #1494 attached this Issue for. It is the remaining substance of #1365.

## Scope

In scope:

- **A. Active view follows a fresh connect.** When a namespace transitions *disconnected →
  connected* after both wallet stacks have settled (i.e. a connection the visitor just made, not a
  page-load reconnect), set the active wallet view to that namespace via `setKind`. Implemented as
  a root-mounted hook so it covers every connect path (`ConnectWalletModal` per-wallet buttons, the
  AppKit fallback modal, WalletConnect QR) without touching the modal, which sits *above*
  `WalletViewProvider` in `main.tsx` and therefore cannot call `useWalletView()` itself.
  Disconnects never change the view. Page-load restores never change the view (the #1475
  `/account` entry rule keeps handling that case).
- **B. Delete the orphaned `AccountDropdown` (TD-112).** The Issue explicitly invites combining
  with this cleanup; it is pure dead code.
- **C. Docs:** record the rule in specs, close TD-112, narrow/close TD-138, remove stale
  `AccountDropdown` consumer references.

Out of scope:

- Any new UI / toggle placement (no Figma frame exists for a header or deposit-page toggle, and
  none is needed once A ships; per `docs/FRONTEND.md` Figma governs styles only and this change has
  no visual surface).
- Changing the home grid to any-wallet presence or the header to the active view (TD-138's two
  larger product options) — A removes the inconsistency for the common single-wallet case instead.
- `ConnectWalletModal`'s initial tab (always `evm` today) — unchanged.
- Chain-following of stats/dashboard hooks (#1498), chain registry / wrong-network (#1497).

## Assumptions and Risks

- **Assumption:** "the namespace you just connected becomes the active view" is the desired
  behaviour. It matches the #1475 entry-tab rule's intent and the home-screen-states state-7
  definition, but it is a behaviour change to a persisted preference — see Open Questions.
- **Settle detection:** `useEvmWallet().isSettled` / `useStellarWallet().isSettled` (aggregated as
  `useWalletPresence().isSettled`) are false while wagmi / the Stellar kit are restoring a prior
  connection. The hook must snapshot connection state on the first settled render and only react to
  changes after that; otherwise a hard refresh would overwrite a deliberately chosen tab.
- **Both connected:** if an LP already has Stellar connected and then connects EVM, the view moves
  to EVM (the newly connected one). If both flip in the same render (not expected in practice),
  the hook does nothing.
- **StrictMode** double-invokes effects in dev; use a ref for the previous snapshot and make the
  effect idempotent (`setKind` only when `kind` differs).
- **Mock wallets** (`pipeline.mock.wallet.*`) are connected and settled from the first render, so
  they produce no transition — no change to existing mock-driven tests/QA.
- **Test fallout from deleting `AccountDropdown`:** only its own test imports it. `truncateAddress`
  (also used by `useWithdrawalQueuePanel`) and `networkSwitcher.ts` (used by `TopBar`) stay.
- `-root.test.tsx` mocks `useWalletPresence` without the new fields; `undefined` reads as falsy, so
  no transition fires and the test is unaffected — still, update the mock to include them
  explicitly.
- No dependency on unmerged work.

## Open Questions

- Confirm the behaviour in Scope A: after a fresh wallet connect, the active EVM/Stellar view
  switches to the namespace just connected (overriding the persisted choice), while page-load
  reconnects and disconnects leave it untouched. Alternative the human may prefer instead: close
  #1365 as resolved by #1458/#1475 with only the TD-112 deletion + docs, leaving TD-138 open as a
  separate product decision. TD-138 currently labels the fix as "a product decision, not
  mechanical", so the planner is not choosing this unilaterally.

## Implementation Steps

1. **Expose per-namespace presence** — `packages/frontend/src/wallet/useWalletPresence.ts`: add
   `isEvmConnected: boolean` and `isStellarConnected: boolean` to `UseWalletPresenceResult`
   (from the existing `evm.isConnected` / `stellar.isConnected`). No other behaviour change.
2. **New hook** — `packages/frontend/src/wallet/useActiveViewFollowsConnect.ts`
   (one-line spec-pointer header to `docs/frontend/wallet-flows.md#active-wallet-view`, no other
   comments per project convention):
   - reads `useWalletPresence()` (`isSettled`, `isEvmConnected`, `isStellarConnected`) and
     `useWalletView()` (`kind`, `setKind`);
   - `prev = useRef<{ evm: boolean; stellar: boolean } | null>(null)`;
   - in a `useEffect` on `[isSettled, isEvmConnected, isStellarConnected]`: if `!isSettled`
     return; if `prev.current === null` store the snapshot and return; compute
     `evmNew = isEvmConnected && !prev.evm`, `stellarNew = isStellarConnected && !prev.stellar`;
     store the new snapshot; if exactly one is new and it differs from `kind`, `setKind(it)`.
   - export from `packages/frontend/src/wallet/index.ts`.
3. **Mount it once** — `packages/frontend/src/routes/__root.tsx` `RootLayout`: call
   `useActiveViewFollowsConnect()` next to `useSessionEndSignOut()` (inside `WalletViewProvider`
   via `RouterProvider`, so `setKind` is the real one).
4. **Delete dead code (TD-112)** — remove
   `packages/frontend/src/components/AccountDropdown.tsx`,
   `packages/frontend/src/components/AccountDropdown.test.tsx`,
   `packages/frontend/src/components/useAccountDropdown.ts`. Then fix stale references:
   - `packages/frontend/src/utils/truncateAddress.ts` header (drop the `useAccountDropdown` origin note
     or repoint it at the spec);
   - `packages/frontend/src/wallet/networkSwitcher.ts` comment ("Shared by `TopBar` … and
     `useAccountDropdown`") → `TopBar` only;
   - comments in `packages/frontend/src/components/TopBar.test.tsx` (line ~63) and
     `packages/frontend/src/components/ErrorDetailsDialog.dom.test.tsx` (line ~108) that cite
     `AccountDropdown.test.tsx` as a precedent — remove the citation.
   - `grep -rn "AccountDropdown\|useAccountDropdown" packages/` must return nothing afterwards.
5. **Update the `-root.test.tsx` `useWalletPresence` mock** to include
   `isEvmConnected: false, isStellarConnected: false, onlyConnectedKind: undefined`.
6. Run `yarn workspace @pipeline/frontend lint`, `typecheck`, `test`, `build` (or the repo's
   `/test-fast`).

## Test Strategy

- **New** `packages/frontend/src/wallet/useActiveViewFollowsConnect.test.tsx` (renderHook inside a
  real `WalletViewProvider`, `useWalletPresence` mocked with a mutable state object, rerender to
  drive transitions; clear `localStorage` per test):
  - not settled → settled with Stellar already connected (page-load restore): `kind` unchanged
    (stays persisted `evm`).
  - settled, nothing connected → Stellar connects: `kind` becomes `stellar` and
    `localStorage["pipeline.wallet.view.kind"] === "stellar"`.
  - settled, nothing connected, persisted `stellar` → EVM connects: `kind` becomes `evm`.
  - Stellar connected (snapshot) → EVM also connects: `kind` becomes `evm`.
  - connected → disconnected: `kind` unchanged.
  - both flip in one rerender: `kind` unchanged.
  - user calls `setKind("evm")` after a Stellar connect (tab click on `/account`): next rerender
    with unchanged presence does not flip it back.
- **Update** `packages/frontend/src/wallet/useWalletPresence.test.tsx`: assert `isEvmConnected` /
  `isStellarConnected` for the four EVM/Stellar connection combinations.
- **Regression:** existing `-account-entry-tab.test.tsx`, `AccountWalletCard.test.tsx`,
  `-index.test.tsx`, `-deposit.test.tsx`, `TopBar.test.tsx`, `-root.test.tsx` stay green.
- **Manual (human, no browser automation on the user's session):** on the dev server with no
  session and persisted view `evm`, connect Freighter from the home Connect CTA → home grid shows
  state 7 (wallet-only) without visiting `/account`; disconnect from `/account`, switch the
  persisted view to `stellar`, connect MetaMask → home reflects the EVM view. Hard refresh keeps a
  manually chosen `/account` tab only when the #1475 entry rule does not apply.
- No Figma verification step: no visual change (Issue has no Figma reference).

## Docs to Update

- `docs/frontend/wallet-flows.md`: add an `### Active wallet view` subsection (or extend the
  existing wallet-view text) stating who calls `setKind`: `/account` tabs, the #1475 entry rule,
  and the new fresh-connect rule (settled-only, disconnect never changes it). Replace the
  Network-switcher "Consumers" line and the "LP `AccountDropdown` keeps its network row too"
  sentence with `TopBar` only.
- `docs/frontend/hooks.md`: add `useActiveViewFollowsConnect`; update the `useWalletPresence` row
  with `isEvmConnected` / `isStellarConnected`; drop `useAccountDropdown` from the
  `getNetworkSwitcherState` row.
- `docs/frontend/utils.md`: `truncateAddress` "Used by" → `useActiveWalletAccount` and
  `useWithdrawalQueuePanel`.
- `docs/frontend/dashboard-components.md`: delete the `### AccountDropdown` section (or reduce it
  to a one-line "removed in #1365" note); fix the line ~673 / ~487 references if they mention it.
- `docs/FRONTEND.md` line ~154: remove the `WalletPill` / `AccountDropdown` sentence (stale since
  #1362).
- `docs/frontend/ui-components.md` line ~1240: drop the `AccountDropdown` pointer.
- `docs/frontend/account-page.md` (~line 182): drop "the same state `AccountDropdown`'s segmented
  control drives"; note in the Wallet card section that a fresh connect anywhere also sets the
  view, so the entry rule is now mostly a page-load safety net.
- `docs/product-specs/home-screen-states.md` (~lines 42–45): replace "a Stellar-connected visitor
  whose active view is EVM still sees state 1 … tracked as tech debt" with the new rule (the view
  follows a fresh connect; the residual case is only a page-load restore where the persisted view
  points at the other namespace, which `/account` corrects).
- `docs/exec-plans/tech-debt-tracker.md`: mark **TD-112** `[RESOLVED <date> / #1365]`; append a
  "Narrowed by #1365" note to **TD-138** (or mark resolved if the human agrees the residual
  page-load case is acceptable).
- `docs/STORIES.md` TC-450-* `AccountDropdown` stories: mark obsolete (component removed).
