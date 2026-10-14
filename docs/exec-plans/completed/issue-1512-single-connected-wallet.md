# Issue #1512: Account: single connected wallet — remove the Ethereum/Stellar tabs, show the connected wallet full-width, active chain = the connected wallet's chain

Source: https://github.com/eq-lab/pipeline/issues/1512 (sub-issue of epic #1494)

## Scope

The current issue body (third revision, 2026-10-14) is authoritative; the two earlier revisions noted in comments are obsolete.

In scope (LP app, `packages/frontend`):

- **One connected wallet at a time.** While an EVM or Stellar wallet is connected, no connect entry point for the other chain is offered. Nothing is ever auto-disconnected on connect; the LP disconnects, then connects again (the connect modal keeps its EVM / Soroban tabs for that choice).
- **`kind` is derived**, not stored: `evm.isConnected` -> `"evm"`, else `stellar.isConnected` -> `"stellar"`, else the deployment default (`"evm"`, today's `DEFAULT_KIND`). `setKind` and `localStorage["pipeline.wallet.view.kind"]` are removed, as is #1475's entry-tab effect in `routes/account.tsx`.
- **Account wallet card:** `SegmentedTabs` / `NAMESPACE_TABS` removed. Connected -> the existing block (icon tile, `Wallet` row, `USDC balance` row, divider, `Disconnect`); not connected -> the existing full-width `Connect Wallet` CTA. Classes, sizes and node ids of these blocks stay as they are; only the tabs wrapper (`6701:98144` and its `px-2` div) goes.

- Spec + user-stories updates.

Out of scope:

- `@pipeline/wallet-connect` (only the Trustee app consumes it; the LP app has its own `ConnectModalProvider`/`ConnectWalletModal`). See Open Questions.
- `AccountDropdown` deletion and its doc cleanup: stays with #1365 (its "view follows connect" part is superseded by this issue).
- #1497 / #1498 behavior: they read `kind` and need no change.

## Assumptions and Risks

- Every connect CTA today (home `routes/index.tsx`, `deposit.tsx`, `stake.tsx`, `transactions.tsx`, Account card) is shown only when the *current `kind`'s* wallet is disconnected. Once `kind` follows the connected wallet, these CTAs disappear automatically whenever any wallet is connected. The extra guard in `ConnectModalProvider.open()` is belt-and-braces (it also covers `AuthFlowProvider`'s call).
- `WalletViewProvider` is mounted inside `EvmWalletProvider` / `StellarWalletProvider` in `main.tsx`, so it can call `useEvmWallet()` / `useStellarWallet()` directly. The outside-provider fallback (`{ kind: "evm" }`) must stay so the many isolated tests mocking `useWalletView` keep working.
- Legacy both-connected state: no winner is picked (decision 2). Once both kits are settled, both are disconnected and the legacy `pipeline.wallet.view.kind` key is deleted; the LP reconnects exactly one wallet.
- Disconnecting during restore must wait until both kits are settled (`useWalletPresence().isSettled`) or a late-restoring kit may slip through.
- While a session restores, `kind` flips from default to the restored chain; consumers already handle `kind` changes (#1475 era), but home/deposit can briefly render the EVM default before a Stellar session settles. Acceptable; same as today's no-storage first visit.
- Tests that call `setKind` (`-deposit.test.tsx`, `-index.test.tsx`, `-account-entry-tab.test.tsx`, `useActiveWalletAccount.test.tsx`, `AccountWalletCard.test.tsx`, `WalletViewContext.test.tsx`, plus `setKind: vi.fn()` in mocks) must be rewritten to drive `kind` by connecting the matching mock wallet.
- No new Figma frame: the user explicitly fixed the styles to today's card minus the tabs. Verification is against the existing frames `6701:98142` (connected) / `6701:98104` (not connected) with the tabs row ignored.

## Open Questions

None open. Resolved by the user on 2026-10-14 (decision log):

1. **Scope:** LP app only. `@pipeline/wallet-connect` stays unchanged (the Trustee logs in by wallet signature, so switching wallets there already requires a disconnect).
2. **Both connected (legacy restored sessions, or both mock keys set):** disconnect BOTH and leave the LP disconnected so they connect exactly one. No "stored kind wins" / "Stellar wins" rule; `kind` falls back to the default (`evm`) when nothing is connected.

## Implementation Steps

1. **Spec first.**
   - `docs/frontend/account-page.md` § Wallet card: delete the "Entry tab (#1475)" table/paragraph and the "view switch / per-tab semantics" text; state the single-wallet rule, the derived `kind`, the two card states (connected block / Connect CTA, no tabs, unchanged sizes); note the reversal of the #444 "both stay live" decision. Update § Verbatim copy / Figma -> token mapping to drop `Ethereum`/`Stellar` tab copy and node `6701:98144`.
   - `docs/frontend/hooks.md`: `useWalletView` (derived, no setter), `useActiveWalletAccount` (no `setKind`), `useWalletPresence` (note `onlyConnectedKind` semantics; it remains used by the restore guard).
   - `docs/frontend/wallet-flows.md`: add a short "Single connected wallet" section (rule, derived `kind`, legacy restore, connect guard).
   - `docs/product-specs/home-screen-states.md` lines ~42-44: remove the "Stellar-connected visitor whose active view is EVM" case.
   - `docs/frontend/dashboard-components.md`: fix any `setKind` / view-toggle wording found by grep.
   - `packages/frontend/src/wallet/README.md` and `packages/frontend/src/api/README.md`: document that `pipeline.mock.wallet.*` + `pipeline.mock.wallet.stellar.*` together is invalid (both report disconnected, one console warning).
2. **`packages/frontend/src/wallet/WalletViewContext.tsx`:** remove `setKind`, storage helpers and the mount sync effect. `WalletViewProvider` computes `kind` from `useEvmWallet().isConnected` / `useStellarWallet().isConnected` (EVM first, else Stellar, else default `evm`; the both-connected state is transient and cleared by step 4). `WalletViewContextValue = { kind }`; fallback `{ kind: "evm" }`. Header is a one-line spec pointer.
3. **`packages/frontend/src/wallet/useActiveWalletAccount.ts`:** drop `setKind` from the result type and return.
4. **Legacy restore guard:** new `packages/frontend/src/wallet/useSingleWalletInvariant.ts`, mounted by `WalletViewProvider`: when `isSettled` and both connected, once per page load, call `disconnect()` on both, then `removeItem` the legacy key (also removed once on mount so it never lingers). Not exported from `wallet/index.ts`.
5. **Mock layer:** `useBothWalletMocksConnected()` in `wallet/stellar/mock.ts`; `useEvmWallet` / `useStellarWallet` report disconnected when both mocks are connected and `console.warn` once.
6. **`packages/frontend/src/wallet/ConnectModalProvider.tsx`:** `open()` becomes a no-op when `evm.isConnected || stellar.isConnected` (read via `useWalletPresence`). Leave the modal's EVM/Soroban tabs as they are.
7. **`packages/frontend/src/components/account/AccountWalletCard.tsx`:** remove `SegmentedTabs` import, `NAMESPACE_TABS`, the tabs wrapper div and `setKind`/`kind` destructuring. Keep the outer card classes (`gap-4 px-2 pt-4 pb-2`) and both state blocks byte-identical. Check in the browser that the removed `gap-4` sibling does not shift the top padding visibly; if the card's top spacing relied on the tabs row, raise it rather than inventing a value.
8. **`packages/frontend/src/routes/account.tsx`:** delete the `entryTabChosen` ref + `useLayoutEffect` and the `useWalletView` import; keep the route gate. Remove `useLayoutEffect`/`useRef` imports if unused.
9. Grep for remaining `setKind` / `pipeline.wallet.view.kind` in `packages/frontend/src` (non-`AccountDropdown`) and fix. `AccountDropdown` takes `kind`/`onKindChange` props only from its own test; leave it for #1365.
10. **User stories:** add/extend `docs/user-stories/epic-1494/` with a story: connect EVM -> Account shows one full-width EVM block, no tabs, no connect offered anywhere; disconnect -> CTA; connect Stellar -> Stellar block, home/deposit follow Stellar; refresh keeps it.

## Test Strategy

- `WalletViewContext.test.tsx`: rewrite — outside provider `kind === "evm"`; inside provider with mocked wallets: none -> `evm`, EVM -> `evm`, Stellar -> `stellar`; no `setKind` exposed.
- Restore-guard test (new, `useSingleWalletInvariant.test.tsx`): both connected + settled -> `disconnect` called on both, legacy key removed; not settled -> no call; one connected -> no call; runs once.
- `ConnectModalProvider.test.tsx` (LP): `open()` does nothing while any wallet connected; opens (through the terms gate) when none.
- `AccountWalletCard.test.tsx`: no tablist/`Ethereum`/`Stellar` tab rendered; none -> Connect CTA calls `connect`; EVM and Stellar connected -> address, balance, Disconnect calls `disconnect`; remove the tab-click test.
- `useActiveWalletAccount.test.tsx`: drop `setKind` cases.
- `-account.test.tsx`, `-account-route-dev-only.test.tsx`, `AccountPage.test.tsx`, `useAccountPage` tests: remove `setKind` from mocks; delete `-account-entry-tab.test.tsx` (behavior removed) or replace with a "card shows the connected chain" case.
- `-deposit.test.tsx`, `-index.test.tsx`: replace the `setKind("stellar")` helper with a Stellar-connected mock wallet (and EVM disconnected).
- `useRequests.test.tsx`, `useStakeFlow.test.tsx`: drop `setKind` from mock return values.
- Mock-layer test: both keys set -> both report disconnected + one warning.
- Run `pnpm` lint, typecheck, `/test-fast` for `packages/frontend`.
- Manual visual check against Figma frames `6701:98142` / `6701:98104` (tabs row excluded) in the user's running dev server: card row heights, paddings, icon tile and button size unchanged.

## Docs to Update

- `docs/frontend/account-page.md` (Wallet card, Verbatim copy, Figma mapping, reversal of #444 / #1475)
- `docs/frontend/hooks.md` (`useWalletView`, `useActiveWalletAccount`, `useWalletPresence`)
- `docs/frontend/wallet-flows.md` (new single-wallet section)
- `docs/product-specs/home-screen-states.md` (two-wallet wording)
- `docs/frontend/dashboard-components.md` (if it references the view toggle)
- `packages/frontend/src/wallet/README.md`, `packages/frontend/src/api/README.md` (invalid both-mock combination)
- `docs/user-stories/epic-1494/` (new story)
