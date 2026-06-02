# Issue #450: [FE] [Stellar] UI wiring: dropdown toggle, TopBar pill, connect chooser modal

Source: https://github.com/eq-lab/pipeline/issues/450

Epic: #444 (Stellar/Soroban support — multi-chain wallet). Sub-issue 3 of the first
milestone. Dependency #449 (`useStellarWallet` + `useStellarToken`) merged via PR #454
and is present on this branch base.

## Scope

Wire the Stellar namespace into the UI so a user can view their connected Stellar
account and USDC balance, switching between EVM and Stellar via a view-only toggle.

**In scope**

- New `src/wallet/WalletViewContext.tsx` — `{ kind: 'evm' | 'stellar', setKind }` view
  selection context + `WalletViewProvider`, mounted in `main.tsx` under
  `StellarWalletProvider`. Selecting a namespace is a view switch only; it never
  disconnects the other.
- `AccountDropdown` — segmented control (`[ EVM ] [ Stellar ]`) at the top of the panel,
  driven by `WalletViewContext`. The address / USDC balance / Disconnect rows render the
  **active** namespace. Disconnect is scoped to the active namespace only.
- `TopBar`:
  - Read both namespaces (`useEvmWallet`/`useEvmToken` and
    `useStellarWallet`/`useStellarToken`) plus `WalletViewContext`.
  - `WalletPill` shows the **active** namespace's `formattedBalance`.
  - When **neither** wallet is connected, the "Connect Wallet" button opens a small
    chooser modal with **Connect EVM** / **Connect Stellar**, each invoking the matching
    `connect()`. Either or both can be connected.
- New `ConnectChooserModal` component (+ co-located logic hook if non-trivial) for the
  EVM/Stellar chooser.
- Widen address-handling types (`AccountDropdown` props, `useAccountDropdown`,
  `truncateAddress`) to accept Stellar `G…` strkeys as well as EVM `0x…` addresses.
- Updated `AccountDropdown` tests (toggle + per-namespace disconnect) and `TopBar` tests
  (pill reflects active namespace; chooser modal opens and routes connects).
- Catalogue updates in `docs/frontend/` for any new shared hook/context/util; wallet
  `README.md` note for the view context if warranted.

**Out of scope** (per epic "Out" list)

- Soroban contract calls / signing; Stellar network-switch UI; Stellar in
  deposit/stake/withdrawal flows; backend Stellar awareness; Stellar activity history.
- Re-touching `useStellarWallet`/`useStellarToken` behavior (already merged in #449).

## Assumptions and Risks

- **Dependency satisfied.** `useStellarWallet`, `useStellarToken`, `StellarWalletProvider`,
  `WalletGateProvider`, the Stellar mock layer, env vars, and the ESLint boundary split are
  all present on this branch (merged via #454). `main.tsx` already mounts
  `WalletGateProvider > EvmWalletProvider > StellarWalletProvider`; only `WalletViewProvider`
  is missing.
- **Terms-gate decision is already resolved in code.** The merged `useStellarWallet.connect()`
  routes through the shared chain-agnostic `WalletGateContext`/`FirstConnectionModal`
  (same instance as EVM). See "Open Questions" — this plan adopts that as the v1 behavior;
  no new gate work is required, and the chooser modal must NOT add a second gate.
- **Address type widening risk.** `AccountDropdown.address` and `truncateAddress` are typed
  `` `0x${string}` `` and slice 6+4 chars. Stellar strkeys are 56-char `G…` strings. Widening
  to `string` and keeping the existing 6+4 truncation works for both; the copy handler and
  clipboard already accept `string`. Verify the EVM `AccountDropdown` tests
  (`0x8493…3b92`) still pass after widening.
- **`formattedBalance` is already symmetric.** Both `useEvmToken` and `useStellarToken`
  return a `formattedBalance` formatted via the same `Intl.NumberFormat` USD formatter
  (`"$1,234.57"`). The epic's "needs a small formatting helper" concern is therefore
  already satisfied for the pill — `TopBar` simply selects the active namespace's
  `formattedBalance` string. `formatUsdcDisplay` lives in `useStellarToken.ts` but is not
  exported from the barrel; do not expose it unless a genuine second consumer appears
  (FRONTEND rule 3). No new util is required for this issue.
- **Pill fallback.** Today the pill renders `formattedBalance ?? "—"`. When the active
  namespace is connected but its balance is still loading/zero, keep the `"—"` fallback.
- **Provider order in tests.** Existing `AccountDropdown`/`TopBar` tests render
  `<EvmWalletProvider>` only (no `StellarWalletProvider`/`WalletViewProvider`).
  `useStellarWallet`/`useStellarToken` must remain safe to call outside a
  `StellarWalletProvider` (they read kit singleton + mock layer, and `useWalletGate`
  already returns a no-op outside its provider). `WalletViewContext` must likewise expose
  a safe default (default `kind: 'evm'` no-op `setKind`) when used outside
  `WalletViewProvider`, so the existing tests do not need to wrap a new provider unless
  they exercise the toggle. Confirm by running the existing tests after the context lands.
- **Strict-mode / hook ordering.** `TopBar` will now call four wallet hooks unconditionally
  at the top level; keep them outside any branch to satisfy the rules of hooks.
- **Disconnected-but-viewing edge case.** A user may toggle the dropdown to a namespace
  that is not connected. Decide rendering: the panel should only open from a connected
  pill, but the segmented control can select a namespace with no connection. Render an
  empty/disconnected state for that tab (no address/balance, Disconnect hidden or no-op)
  rather than crashing. See Open Questions for the exact empty-state copy.

## Open Questions

- The epic lists the terms-gate scope as an open decision; the **merged #449 code already
  resolves it** — Stellar `connect()` reuses the shared chain-agnostic `FirstConnectionModal`
  via `WalletGateContext`. This plan treats "reuse the shared gate" as the settled v1
  behavior and adds no new gate. Flag for human confirmation only if product wants Stellar
  connect ungated instead (which would require reverting that wiring in `useStellarWallet`).
- Empty-state UX when the user toggles the dropdown to a namespace that is not connected
  (e.g. EVM connected, user taps the "Stellar" tab): show a "Not connected — Connect
  Stellar" affordance inside the panel, or just blank rows with Disconnect hidden? No Figma
  frame covers this mixed state. Proposed default: render the caption rows with an inline
  "Connect {namespace}" action that calls that namespace's `connect()`, and hide Disconnect.

## Implementation Steps

1. **`packages/frontend/src/wallet/WalletViewContext.tsx`** — create the context + provider.
   - `export type WalletViewKind = 'evm' | 'stellar'`.
   - `export interface WalletViewContextValue { kind: WalletViewKind; setKind: (k: WalletViewKind) => void }`.
   - `WalletViewProvider` holds `useState<WalletViewKind>('evm')` and renders the context.
   - `export function useWalletView(): WalletViewContextValue` returning a safe default
     (`{ kind: 'evm', setKind: () => {} }`) when called outside the provider (mirror the
     `useWalletGate` no-op-fallback pattern so existing partial-tree tests don't break).
   - Keep this file free of any chain libs (barrel/context layer only — ESLint boundary).

2. **`packages/frontend/src/wallet/index.ts`** — export `WalletViewProvider`, `useWalletView`,
   and `WalletViewKind`/`WalletViewContextValue` types from the barrel under a new
   "View selection" section.

3. **`packages/frontend/src/main.tsx`** — wrap the tree with `WalletViewProvider` directly
   under `StellarWalletProvider`:
   `WalletGateProvider > EvmWalletProvider > StellarWalletProvider > WalletViewProvider > ToastProvider > RouterProvider`.

4. **Address type widening.**
   - `packages/frontend/src/components/useAccountDropdown.ts`: change
     `truncateAddress(address: \`0x${string}\`)` and `UseAccountDropdownOptions.address`
     to `string`. The 6+4 slice already works for `G…` strkeys (produces `GABCDE…WXYZ`).
   - `packages/frontend/src/components/AccountDropdown.tsx`: change `address` prop to
     `string`.

5. **`packages/frontend/src/components/AccountDropdown.tsx`** — add the segmented control.
   - Add a two-button segmented control (`role="tablist"` with two `role="tab"` buttons,
     or a radio group; labels `EVM` / `Stellar`) above the "Account" heading or directly
     under it, matching the epic ASCII sketch (Figma `1506:104728` family — verify the
     exact node for the segmented control; if none exists, build from theme tokens and note
     it for ux-tester).
   - Drive selection from `useWalletView()` (`kind`, `setKind`). Active tab styled with the
     ink/selected token; inactive muted.
   - The component stays presentational per FRONTEND rule 2: it receives the active
     namespace's `address`, `formattedBalance`, `kind`, `onKindChange`, `onDisconnect`,
     `onClose` as props from `TopBar`. Do not call wallet hooks inside `AccountDropdown`.
   - Handle the not-connected-for-active-tab state per the Open Questions resolution
     (inline "Connect {namespace}" affordance, Disconnect hidden) — wire the connect
     callback through props.

6. **`packages/frontend/src/components/ConnectChooserModal.tsx`** (+ `useConnectChooserModal.ts`
   if logic warrants) — small modal with **Connect EVM** / **Connect Stellar** buttons.
   - Reuse the `FirstConnectionModal` structural pattern: `createPortal` to `document.body`,
     `role="dialog" aria-modal="true"`, scrim click + Escape dismiss, focus trap, body-scroll
     lock, focus restore on close.
   - Props: `{ open, onConnectEvm, onConnectStellar, onDismiss }`.
   - Each button calls the namespace's `connect()` (passed from `TopBar`) then dismisses the
     chooser. The chooser must NOT implement its own terms gate — each `connect()` already
     routes through the shared gate.

7. **`packages/frontend/src/components/TopBar.tsx`** — multi-namespace wiring.
   - Call all four hooks unconditionally: `useEvmWallet()`, `useEvmToken({...})`,
     `useStellarWallet()`, `useStellarToken()`, plus `useWalletView()`.
   - `anyConnected = evm.isConnected || stellar.isConnected`.
   - Active namespace derives from `kind`: pick `address`/`formattedBalance`/`disconnect`
     from the matching namespace.
   - `WalletPill` shows the active namespace's `formattedBalance ?? "—"`.
   - Pill trigger is shown when `anyConnected`; clicking opens the `AccountDropdown` with
     the active namespace's data and `kind`/`setKind` wired through.
   - When `!anyConnected`, "Connect Wallet" opens `ConnectChooserModal`; its buttons call
     `evm.connect` / `stellar.connect`.
   - Pass per-namespace `connect` to `AccountDropdown` so the not-connected-active-tab
     affordance works (e.g. EVM connected, user views the Stellar tab → "Connect Stellar").
   - Keep `useDepositManagerAddresses()` usage for the EVM token address as today.

8. **Catalogue + docs.**
   - `docs/frontend/hooks.md`: add `useWalletView` (shared context hook, `@/wallet`).
   - `packages/frontend/src/wallet/README.md`: add a short "View selection" note for
     `WalletViewContext` (kind toggle is view-only, never disconnects).
   - If a shared util is introduced (not expected — see Assumptions), add it to
     `docs/frontend/utils.md` with a test in the same change.

## Test Strategy

- **`AccountDropdown.test.tsx`** (extend existing):
  - Render `TopBar` wrapped in `EvmWalletProvider` + `StellarWalletProvider` +
    `WalletViewProvider` (extend the existing `renderWithWallet` helper) so the toggle is
    exercised. Add Stellar mock keys helper (`pipeline.mock.wallet.stellar.address`,
    `.isConnected`, `.balance.usdc`) alongside the EVM ones.
  - Toggle: with both namespaces mocked-connected, clicking the `Stellar` tab switches the
    rendered address (EVM `0x…` → Stellar `G…` truncation) and balance; clicking `EVM`
    switches back. Assert the other namespace is NOT disconnected (its mock keys persist
    and toggling back shows it).
  - Per-namespace Disconnect: with EVM active, Disconnect triggers only EVM's disconnect
    path; Stellar remains connected (toggle to Stellar still shows its data). Mirror for
    Stellar active. (Use spies on the respective `disconnect`, or assert via mock-key state
    / rendered output, consistent with the existing mock-driven test style.)
  - Regression: keep the existing open/close, copy, a11y-roles tests green after the
    address-type widening.
- **`TopBar.test.tsx`** (extend existing):
  - Neither connected → "Connect Wallet" present; clicking it opens `ConnectChooserModal`
    (assert the two buttons render). Clicking **Connect Stellar** invokes `stellar.connect`
    (spy) and dismisses; **Connect EVM** invokes `evm.connect`.
  - EVM connected only → pill shows EVM balance; toggling view to Stellar (via dropdown)
    shows Stellar empty/connect state.
  - Both connected → pill shows the active namespace's balance and updates when `kind`
    changes.
- **`WalletViewContext`**: a focused test that `useWalletView` returns the safe default
  outside the provider and live `kind`/`setKind` inside it (small render-hook test).
- **`ConnectChooserModal.test.tsx`**: open/close (Escape, scrim), focus trap, and that each
  button fires the matching callback then dismisses.
- Run the full fast suite: `yarn workspace @pipeline/frontend lint`,
  `tsc --noEmit` (typecheck), `vitest run`, and the frontend build. Then
  `npx tsx scripts/lint-docs.ts` for doc-structure validation (AGENTS.md requirement after
  TS changes).

## Docs to Update

- `docs/frontend/hooks.md` — add `useWalletView`.
- `packages/frontend/src/wallet/README.md` — "View selection" note for `WalletViewContext`.
- `docs/frontend/utils.md` — only if a new shared util is introduced (not expected).
- No product-spec file currently covers wallet connection UX (no Stellar/wallet entry in
  `docs/product-specs/index.md`); this is UI wiring of already-specced multi-chain behavior
  from epic #444, so no `docs/product-specs/` change is required. If the team wants the
  connect-chooser / namespace-toggle UX captured as product behavior, that is a separate
  spec task — flag, do not author here.

## Figma Verification

The epic references Figma node families for the dropdown (`1506:104728`) and TopBar
(`1497:94715`, WalletPill `1498:100168`). The Issue body does not include a Figma URL for
the new segmented control or the connect chooser modal. ux-tester (Flow B) should verify
the rendered dropdown toggle and chooser modal against Figma if a frame exists; if no frame
covers the segmented control or chooser, build from theme tokens (no raw hex per FRONTEND
"Design tokens" rule) and note the missing reference for design review.
