# Issue #1458: Header + Account: wallet connected without a session shows the account icon; Account page wallet-only variant with Add email and Disconnect

Source: https://github.com/eq-lab/pipeline/issues/1458

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)

Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-98137&m=dev
— frame `6701:98137` "No Verified Account" (header `6701:98162`, account icon `6701:98174`; wallet
card `6701:98142` → rows frame `6701:98145` with divider `7127:15564` + `Disconnect` row
`7127:15570`; Corporate email block `7129:15858` with the `Email / Add email` row `7129:15860`).
The `Disconnect` row and its divider also exist on every other connected Account frame
(`6701:97942`/`7127:15605`, `6701:97982`/`15609`, `6701:98022`/`15611`, `6701:98175`/`15603`,
`6701:98061`/`15607`), so it ships for signed-in LPs too.

## Scope

**In scope**

1. **Header rule.** `TopBar` and `MobileNavMenu` show the 48×48 account icon whenever a wallet is
   connected **or** a session exists; Sign In / Sign Up only when neither. Same-tab reactive.
2. **`/account` route gate.** Admit a wallet-connected visitor with no session; keep the production
   redirect to `/` for a visitor with neither. `?state=` preview stays dev-only.
3. **Wallet-only Account variant** (frame `6701:98137`): wallet card with the new divider +
   `Disconnect` row, `Corporate email` block whose `Email / Add email` row opens the Add email flow,
   `Documents` card in its `verify` composition with `Upload` routed into the Add email flow and a
   disabled `Save`, and `Log Out`. No profile card (hidden in the frame — node `6701:98148`).
4. **`Disconnect` row on every connected Account state** — it lives in `AccountWalletCard`'s
   connected branch, so the signed-in variants get it for free. Closes TD-111.
5. **Wallet disconnect primitives** surfaced to the UI: `useActiveWalletAccount` gains `disconnect`;
   a new narrow `useWalletPresence()` hook gives the header and the route gate a namespace-agnostic
   `isAnyConnected` / `isSettled` / `disconnectAll` without pulling token-balance reads into the
   global header.

**Out of scope**

- The Add email screen itself and the OTP hand-off — **#1459**. This issue ships only the entry
  seam (`useAuthFlow().openAddEmail()`).
- The home grid for a wallet-only visitor (home state 7) — **#1460**. `deriveHomeState` is not
  touched; a wallet-only visitor keeps rendering the zero-state grid on `/` until #1460 lands
  (already documented in `home-screen-states.md`'s precedence rule).
- Any link between the connected wallet address and the account. Per the user's 2026-10-12
  clarification the wallet is **display-only, not a credential**; nothing is sent to or stored by
  the backend.
- Deleting `AccountDropdown` (TD-112) — unrelated to this change; TD-112 stays open.

## Decisions

These are settled; the coder implements them as written.

1. **The header and the route gate key on "any namespace connected", not the active tab.** The
   existing `useActiveWalletAccount().isConnected` is scoped to `useWalletView().kind`. Using it for
   the header would mean a wallet-only visitor who clicks the `Stellar` tab on `/account` (while
   connected on EVM) instantly loses the account icon **and trips the route gate, ejecting them to
   `/`**. The gate and the header therefore use `evm.isConnected || stellar.isConnected`. The wallet
   **card** keeps today's per-tab view semantics unchanged.
2. **The route gate moves out of `beforeLoad` into the route component.** Wallet connection is not
   synchronously readable in `beforeLoad`: EVM reconnects through wagmi after mount and Stellar
   hydrates asynchronously via `StellarWalletsKit.getAddress()` in a mount effect
   (`wallet/stellar/useStellarWallet.ts`). A `beforeLoad` check would bounce a connected visitor who
   hard-refreshes `/account`. The component renders nothing and redirects **only once wallet state
   has settled**, so there is no flash and no bounce.
3. **The Add email row opens the normal create-account registration through a named seam.** The
   issue comment states the visitor "goes through the normal create-account registration from the
   `Add email` row (#1459, same signup → OTP → session flow)". So the seam is a real action, not a
   no-op: `AuthFlowContextValue` gains `openAddEmail()`, implemented today as
   `open("create-account")`. #1459 re-points that one call site to its `"add-email"` screen without
   touching `AccountEmailCard`. Do **not** add an `"add-email"` member to `EmailAuthScreen` here —
   that union is #1459's to extend.
4. **`Log Out` on the wallet-only variant disconnects every connected namespace, then navigates to
   `/`** (issue assumption: "behaves like Disconnect"). `disconnectAll` rather than "the active
   namespace" so the stated outcome — the header reverts to Sign In / Sign Up — always holds, even
   when the visitor is sitting on a tab whose namespace is not the connected one. The signed-in
   variant's `Log Out` is unchanged (`signOut()` + navigate; the wallet is left connected, the
   `Disconnect` row handles it).
5. **`Save` and `Submit for review` need no interception.** In the wallet-only variant `canSave` is
   `false` (nothing can be staged) so `Save` is rendered disabled exactly as the frame shows, and
   `Submit for review` does not render at all (`AccountDocumentsCard` gates it on
   `production && documents.length > 0`). The only reachable write affordance is the `Upload`
   button, which is the one that routes into the Add email flow.
6. **The connected wallet rows frame has no gap** — `get_metadata` on `6701:98145` puts the rows at
   `y=0 (h=56)`, `y=56 (h=56)`, divider at `y=112 (h=24)`, Disconnect at `y=136 (h=40)`, total 176;
   same geometry on `6701:97950` (frame `6701:97942`). Today's `gap-2` on that container is 8px too
   much. Corrected to `gap-0` in the same pass, since this issue is adding children to that exact
   container.
7. **No new `?state=` fixture.** The wallet-only variant is fully reachable for real (connect a
   wallet, no session), so QA exercises it live rather than through a preview. Per the project's
   no-mocks rule, nothing about this variant is faked.

## Assumptions and Risks

- **#1459 may land before or after this issue.** Both orders work: the `openAddEmail()` seam calls
  the already-shipped create-account screen, so the row is functional either way.
- **TopBar re-acquires wallet hooks.** #1362 removed every wallet hook from `TopBar`; this change
  puts `useWalletPresence()` (and so `useEvmWallet` + `useStellarWallet`) back. It adds **no wallet
  UI** — no pill, no Connect button — and deliberately avoids `useActiveWalletAccount`, which would
  mount `useEvmToken` / `useStellarToken` contract reads in the global header on every route. The
  TopBar/MobileNavMenu unit tests must mock `@/wallet`'s `useWalletPresence` rather than stand up
  wagmi/AppKit/Stellar scaffolding; `TopBar.test.tsx`'s file header comment ("no wagmi/AppKit/
  Stellar-wallets-kit scaffolding is needed here any more") must be corrected.
- **`isSettled` plumbing touches the wallet layer.** `useEvmWallet` gains `isSettled` from wagmi's
  `useAccount().status`; `useStellarWallet` gains `isSettled` backed by a new reactive flag in
  `stellar/connectionStore.ts`. The existing `hydrated` flag is **not** reusable: it is set *before*
  the async `getAddress()` resolves, purely as a re-entry guard. Mocked wallets
  (`pipeline.mock.wallet.*`) are settled immediately.
- **Production redirect is now asynchronous.** `/account` in production for a visitor with neither
  session nor wallet renders nothing for a tick, then redirects. Previously `beforeLoad` redirected
  before any render. Story 7 of `1362-header-auth-entry.md` (which already notes it is not
  browser-drivable on a dev deployment) needs rewording, not re-testing.
- **Dev behaviour change.** On a dev deployment, `/account` with neither session nor wallet today
  renders `useAccountPage`'s read error ("Sign in to view your account."). It will now render the
  wallet-only variant with the wallet card in its disconnected `Connect Wallet` form — closer to the
  design and a strictly better dev surface.
- **`AccountListRow` becomes focusable when interactive.** Making the root a real `<button>`
  requires its inner `<p>`/`<div>` descendants to become `<span class="block">` / `<span class="flex">`
  (phrasing-content rule). Tailwind preflight already zeroes `<p>` margins, so this is visually a
  no-op for the existing wallet/email/document rows — but it touches a shared primitive, so the
  existing `AccountWalletCard.test.tsx` / `AccountEmailCard.test.tsx` assertions are the regression
  guard.

## Open Questions

- A wallet-only visitor connected on **one** namespace who is looking at the **other** namespace tab
  (default view kind is `"evm"`, persisted at `pipeline.wallet.view.kind`) sees the wallet card's
  `Connect Wallet` state with no `Disconnect` row, while the header shows the account icon and the
  page stays reachable. Should the wallet card auto-select the connected namespace for this visitor,
  or keep today's per-tab semantics? **Proposed default: keep today's semantics** (the tab is a view
  switch, identical to the signed-in behaviour #1284 shipped) — the coder should proceed on that if
  there is no answer.

## Implementation Steps

### A. Wallet layer — disconnect + presence (closes TD-111)

1. `packages/frontend/src/wallet/evm/useEvmWallet.ts` — add `isSettled: boolean` to `WalletState`:
   take `status` from wagmi's `useAccount()`; `isSettled` is `true` when a mock address is present,
   otherwise `status !== "connecting" && status !== "reconnecting"`. `disconnect()` already exists —
   unchanged.
2. `packages/frontend/src/wallet/stellar/connectionStore.ts` — add a module-level `settled` flag
   alongside `hydrated`, with `markStellarConnectionSettled()` (notifies the existing listener set),
   `isStellarConnectionSettled()`, and a reactive `useStellarConnectionSettled()` built on
   `useSyncExternalStore` with the same `subscribeStellarConnection` subscribe function and an SSR
   snapshot of `false`. Reset it in `_resetStellarConnectionStoreForTests()`.
3. `packages/frontend/src/wallet/stellar/useStellarWallet.ts` — call
   `markStellarConnectionSettled()` in a `finally` around the mount-effect `getAddress()` call (both
   success and failure settle), and add `isSettled` to `StellarWalletState`: `true` when a mock
   address is present, otherwise `useStellarConnectionSettled()`.
4. New `packages/frontend/src/wallet/useWalletPresence.ts`:

   ```ts
   export interface UseWalletPresenceResult {
     isAnyConnected: boolean;
     isSettled: boolean;
     disconnectAll: () => void;
   }
   ```

   Calls `useEvmWallet()` and `useStellarWallet()` only — **no** token or contract reads.
   `isAnyConnected = evm.isConnected || stellar.isConnected`;
   `isSettled = evm.isSettled && stellar.isSettled`; `disconnectAll()` calls each namespace's
   `disconnect()` when that namespace reports connected.
5. `packages/frontend/src/wallet/useActiveWalletAccount.ts` — add `disconnect: () => void` to
   `UseActiveWalletAccountResult`, dispatching to `evm.disconnect` / `stellar.disconnect` by `kind`
   (the same branch shape the hook already uses for `isConnected`/`address`).
6. `packages/frontend/src/wallet/index.ts` — export `useWalletPresence` and
   `UseWalletPresenceResult` under a new "Wallet presence (issue #1458)" section.

### B. Header

7. `packages/frontend/src/components/TopBar.tsx` — read
   `const { isAnyConnected } = useWalletPresence()` next to `useAuthSession()`; derive
   `const showAccountIcon = isAuthenticated || isAnyConnected` and use it for the desktop right slot
   branch (account icon vs. Sign In / Sign Up) and for the `isAuthenticated` prop passed to
   `MobileNavMenu`. Rename that prop to `showAccount` in both files so the name stops implying a
   session. Keep `data-testid="topbar-account-button"`; the icon is `6701:98174` (same 48×48
   `AccountGlyph` as `6701:97941`) — add it to the existing `data-node-id` comment trail only, no
   geometry change. `NetworkSwitcher` is untouched.
8. `packages/frontend/src/components/MobileNavMenu.tsx` — rename the `isAuthenticated` prop to
   `showAccount` and use it to pick between the account row (`mobile-account-button`) and the
   Sign In / Sign Up pair. No other change; no mobile Figma frame exists (same judgment basis as
   #1362).

### C. Route and gate

9. `packages/frontend/src/routes/account.tsx`:
   - Delete the `beforeLoad` redirect (drop the `readSession` import). Keep `validateSearch` and its
     `ENV.IS_DEV` gate on `parseAccountStatePreview` exactly as they are.
   - In `AccountRoute`: `const { isAuthenticated, signOut } = useAuthSession();` and
     `const { isAnyConnected, isSettled, disconnectAll } = useWalletPresence();`.
   - `const blocked = !ENV.IS_DEV && !isAuthenticated && !isAnyConnected;`
     `useEffect(() => { if (blocked && isSettled) void navigate({ to: "/", replace: true }); }, [blocked, isSettled, navigate]);`
     and `if (blocked) return null;` before rendering `AccountPage`.
   - `onLogOut`: when `isAuthenticated`, `signOut()`; otherwise `disconnectAll()`. Either way,
     `void navigate({ to: "/" })`.

### D. Account page — wallet-only variant

10. `packages/frontend/src/components/account/AccountPage.tsx`:
    - `const { token, isAuthenticated } = useAuthSession();`
    - Branch order: `previewState` → today's preview path; else `isAuthenticated` →
      `ProductionAccountPage` (unchanged, keeps `key={token ?? "signed-out"}`); else
      `<AccountPageContent walletOnly />` — **no `useAccountPage()` call**, so no `GET /v1/lps/me`
      without a session.
    - `AccountPageContent` gains `walletOnly?: boolean`: include it in `ready`
      (`Boolean(previewState || walletOnly || account?.readState === …)`), pass
      `onAddEmail={openAddEmail}` to `AccountEmailCard` when `walletOnly`, and pass
      `onUploadIntercept={openAddEmail}` to `AccountDocumentsCard` when `walletOnly`. `openAddEmail`
      comes from `useAuthFlow()`. The profile card is already gated on `account`, so it stays absent
      — matching the frame's hidden `6701:98148`. `documentsState` already derives to `"verify"`
      for `{ kybStatus: "NotStarted", documents: [], stagedCount: 0 }`.
11. `packages/frontend/src/auth/AuthFlowContext.ts` + `AuthFlowProvider.tsx` — add
    `openAddEmail(): void` to `AuthFlowContextValue`, implemented as `open("create-account")` and
    memoised into the context value alongside the existing callbacks. One-line comment-free change;
    the rationale lives here and in `auth-components.md`.

### E. Account components — Figma-exact

12. `packages/frontend/src/components/account/AccountWalletCard.tsx` (connected branch, container
    `6701:98145`):
    - `gap-2` → `gap-0` on the rows container (decision 6).
    - After the two rows, render the divider: a 24px box with a centered 1px rule —
      `<div aria-hidden="true" className="flex h-6 w-full items-center" data-node-id="7127:15564"><span className="h-px w-full bg-[color:var(--color-pipeline-line)]" /></div>`
      (`border-test/secondary` = `#323837` @ 0.18 = `--color-pipeline-line`).
    - Then the `Disconnect` row: a full-width `<button type="button">` carrying the row chrome
      `flex w-full items-center gap-3 rounded-[var(--radius-pipeline-card)] p-2 text-left` with the
      body typography block already used by `AccountListRow`'s title (`--font-body`,
      `--text-pipeline-body` / its line height, `--color-pipeline-ink`) and the project's
      `focus-visible:ring-2 … ring-[var(--color-pipeline-brand)]` convention. No leading tile, no
      caption, no trailing control (frame `7127:15570` has only a `TitleCont`). 40px tall = `p-2` +
      the 24px min-height title line. `data-testid="account-disconnect-row"`,
      `data-node-id="7127:15570"`. `onClick` calls `useActiveWalletAccount().disconnect` — the
      **active namespace**, per the Issue.
    - It is **not** an `AccountListRow` (that primitive requires `leading` and `caption`); keep it
      local to this card.
13. `packages/frontend/src/components/account/AccountListRow.tsx` — add optional
    `onActivate?: () => void`. When present the root renders `<button type="button">` with the same
    composed classes plus `text-left` and the focus-visible ring; when absent, today's `<div>`.
    Swap the inner content wrapper `<div>` → `<span className="flex …">` and the two `<p>` elements
    → `<span className="block …">` so the button's content model is valid. No visual change
    (Tailwind preflight already zeroes `<p>` margins).
14. `packages/frontend/src/components/account/AccountIconTile.tsx` — render a `<span>` instead of a
    `<div>` (keeps `flex` via the existing classes) for the same reason. Both other consumers
    (`AccountWalletCard`, `AccountUploadRow`) are unaffected.
15. `packages/frontend/src/components/account/AccountEmailCard.tsx` — add optional
    `onAddEmail?: () => void`. When `email` is falsy **and** `onAddEmail` is supplied, render the
    row with `title="Add email"`, `onActivate={onAddEmail}`, `data-node-id="7129:15860"`,
    `data-testid="account-add-email-row"`. Otherwise today's read-only row (`email ?? "—"`,
    `6701:98112`) — the authenticated path never passes `onAddEmail`, so it is unchanged.
    Caption stays `Email`; section label stays `Corporate email` (`7129:15859`).
16. `packages/frontend/src/components/account/AccountUploadRow.tsx` — add optional
    `onIntercept?: () => void`. When supplied, the `Upload` button calls it instead of
    `inputRef.current?.click()`; the hidden file input is not rendered in that case. Everything else
    (tile, copy, bordered compact `Upload`, touch-target wrapper) is unchanged.
17. `packages/frontend/src/components/account/AccountDocumentsCard.tsx` — add optional
    `onUploadIntercept?: () => void` and forward it to `AccountUploadRow`. No other branch changes:
    `verify` already renders banner + upload row + requirements + disabled `Save`, and the
    `Submit for review` block stays gated on `production && documents.length > 0`.

## Test Strategy

Vitest + Testing Library, co-located with each file, following the existing mocking patterns
(`routes/-index.test.tsx` for wagmi/AppKit/Stellar-kit scaffolding; module-level `vi.mock("@/auth")`
for TopBar).

1. **`wallet/useWalletPresence.test.tsx` (new)** — connected on EVM only, Stellar only, both,
   neither → `isAnyConnected`; `isSettled` false while EVM status is `reconnecting` or Stellar has
   not settled, true once both have; `disconnectAll` calls only the connected namespaces' disconnect.
   Mock-key path (`pipeline.mock.wallet.address`) settles immediately.
2. **`wallet/useActiveWalletAccount.test.tsx`** — extend: `disconnect` routes to the EVM wallet when
   `kind === "evm"` and to the Stellar wallet when `kind === "stellar"`; switching `kind` never
   disconnects (regression guard for the existing view-switch contract).
3. **`wallet/stellar/useStellarWallet.test.tsx`** — `isSettled` is `false` before the mount-effect
   `getAddress()` resolves and `true` after, including when it rejects.
4. **`components/TopBar.test.tsx`** — mock `@/wallet`'s `useWalletPresence`. Matrix: (no session, no
   wallet) → Sign In + Sign Up; (no session, wallet connected) → account icon,
   `topbar-account-button` navigates to `/account`; (session, no wallet) → account icon (regression);
   (session, wallet) → account icon. Flipping `isAnyConnected` false re-renders Sign In / Sign Up
   without a remount (same-tab reactivity). Update the file-header comment.
5. **`components/MobileNavMenu.test.tsx`** — the same matrix on `showAccount`:
   `mobile-account-button` vs. `mobile-sign-in-button` / `mobile-sign-up-button`.
6. **`routes/-account.test.tsx`** (or the existing account route test file) — production
   (`ENV.IS_DEV` false): no session + no wallet + settled → navigates to `/`; no session + no wallet
   + **not** settled → renders nothing and does **not** navigate (the hard-refresh regression guard);
   no session + wallet connected → renders the page, no navigation; session + no wallet → renders
   the page. `?state=verified` still ignored when `ENV.IS_DEV` is false.
7. **`components/account/AccountPage.test.tsx`** — wallet-only (no session, wallet connected):
   renders the wallet card, the `Add email` row, the Documents card in `verify`, a disabled `Save`,
   no profile card, no `Submit for review`, no "Sign in to view your account." text, and **no
   `GET /v1/lps/me` request** (assert the API module's fetch seam is never called). Clicking the
   `Add email` row calls `useAuthFlow().openAddEmail`. Clicking `Upload` calls `openAddEmail` and
   does **not** open the file input.
8. **`components/account/AccountWalletCard.test.tsx`** — connected: the `Disconnect` row renders
   after the divider and calls `disconnect`; disconnected: no divider and no `Disconnect` row.
   Present in both the wallet-only and the signed-in composition.
9. **`components/account/AccountEmailCard.test.tsx`** — with an email: read-only row, no button;
   without an email and with `onAddEmail`: an `Add email` button that calls the handler; without an
   email and without `onAddEmail`: today's `—` (authenticated-path regression).
10. **`routes/account.tsx` log-out behaviour** — authenticated: `signOut` called, `disconnectAll`
    not; wallet-only: `disconnectAll` called, `signOut` not; both navigate to `/`.
11. **Figma verification** (ux-tester / manual): compare the rendered wallet-only `/account` against
    `6701:98137` — wallet card 480×252 with the 176px rows frame (56/56/24/40, no inter-row gap),
    divider at the card's inner width in `--color-pipeline-line`, `Disconnect` in ink body type,
    `Corporate email` + `Email / Add email` row (`7129:15860`, 72px card row with the envelope tile),
    `Documents` in the `verify` composition, disabled `Save`, full-width `Log Out`; and the header
    `6701:98162` showing only the 48×48 account icon in the right slot. Also check one signed-in
    connected frame (`6701:98061` or `6701:97942`) for the same divider + `Disconnect` geometry.
12. `yarn lint`, `yarn build`, `npx tsx scripts/lint-docs.ts`, and the frontend test suite green.

## Docs to Update

- **`docs/frontend/account-page.md`**
  - Rename and rewrite "Route and dev-only guard" → the gate now lives in the route component, keyed
    on session **or** any connected wallet, redirecting only once wallet state has settled, and why
    `beforeLoad` cannot do it. Keep the `?state=` dev-only note.
  - New "Wallet-only variant (#1458)" section: when it renders, what it composes (frame `6701:98137`,
    no profile card — `6701:98148` is hidden in the frame), the `Add email` entry seam, the `Upload`
    interception and why `Save` / `Submit for review` need none, and `Log Out` = disconnect-all.
  - "Wallet card": the divider + `Disconnect` row on every connected frame, the active-namespace
    disconnect, and the `gap-0` geometry correction with its node evidence.
  - "Verbatim copy": add `Disconnect` and `Add email`.
  - "Accessibility": the `Disconnect` row and the `Add email` row are real `<button>` elements;
    `AccountListRow`'s interactive form and the `<span>` swaps.
- **`docs/frontend/dashboard-components.md#topbar`** — the header rule is now "session **or**
  connected wallet"; `TopBar` reads `useWalletPresence()` (no wallet UI, no token reads); update the
  "Where wallet-connect entry points still live" note — disconnect is reachable again on `/account`.
  Mirror the rule in the `### MobileNavMenu` auth section (`showAccount` prop).
- **`docs/frontend/auth-components.md#authflowprovider`** — document `openAddEmail()`: what it does
  today (`open("create-account")`), who calls it (`AccountEmailCard`'s `Add email` row), and that
  #1459 re-points it.
- **`docs/frontend/hooks.md`** — new `useWalletPresence` row; update the `useActiveWalletAccount`
  row for `disconnect` and drop its stale "TopBar is not yet migrated onto it (tech debt)" clause.
- **`docs/product-specs/home-screen-states.md`** — in the precedence rule, change the header
  sentence from pending to shipped (#1458); the state-7 home grid stays #1460's.
- **`docs/exec-plans/tech-debt-tracker.md`** — resolve/remove **TD-111**. Leave TD-112
  (`AccountDropdown` dead code) open.
- **`docs/user-stories/epic-1419/1458-wallet-only-account.md`** (new) — stories for: header icon
  with a wallet and no session; Sign In / Sign Up return on disconnect; `/account` reachable for a
  wallet-only visitor and the production redirect with neither; the wallet-only page composition;
  `Add email` opening the registration flow; `Upload` routing into it; `Disconnect` on both the
  wallet-only and a signed-in state; `Log Out` disconnecting. Register it in
  `docs/user-stories/index.md` under Epic #1419.
- **`docs/user-stories/epic-1247/1362-header-auth-entry.md`** — Story 1 asserts the signed-out
  header shows Sign In / Sign Up; add the "no wallet connected" pre-condition. Story 7 (production
  redirect) — restate against the new component-level gate.
- **`docs/user-stories/epic-1247/1284-lp-account-page.md`** — Story 10 (wallet card) gains the
  `Disconnect` row; Story 12 (`Corporate email` renders `—`) is now the authenticated-path story and
  must say the wallet-only variant shows `Add email` instead.
