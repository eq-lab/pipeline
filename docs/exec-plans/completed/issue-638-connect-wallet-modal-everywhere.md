# Issue #638: Connect Wallet modal — only the header button opens it; every "Connect Wallet" button should open the same modal

Source: https://github.com/eq-lab/pipeline/issues/638

Part of epic #556. Sibling bug: #639 ("Before you continue" gate should precede the modal).

## Scope

**In scope** — make every "Connect Wallet" affordance open the same styled `ConnectWalletModal` (EVM/Soroban tabs + per-wallet picker) that the TopBar button opens today, instead of triggering a chain-specific `connect()` directly.

Centralize the modal open-state by introducing a shared **`ConnectModalProvider`** (new file in `packages/frontend/src/wallet/`) that owns one `ConnectWalletModal` instance and exposes an imperative `useConnectModal().open()` / `.close()`. Mount it once in `main.tsx`. Re-point every connect affordance at `open()`:

1. `routes/index.tsx` — `ConnectWalletPromoCard` `onConnect={connect}` (lines 198 and 288, both mobile and desktop instances) → `onConnect={openConnectModal}`. Drop the `useEvmWallet().connect` import usage for this purpose.
2. `routes/deposit.tsx` — connect-wallet banner `onClick={flow.connect}` (line 466) → `open()`.
3. `routes/stake.tsx` — connect-wallet banner `onClick={connect}` (line 410) → `open()`.
4. `components/MobileNavMenu.tsx` — already calls `onConnect` which TopBar wires to `setChooserOpen(true)`; after centralization it should call `open()` from the shared hook (either directly or via the same TopBar prop). Keep behavior identical.
5. `components/TopBar.tsx` — replace local `chooserOpen`/`setChooserOpen` state and the inline `<ConnectWalletModal>` instance (lines 120, 240, 284, 292–295) with the shared `open()`. The TopBar no longer renders its own modal.

**Out of scope:**
- Reordering the "Before you continue" gate to precede the modal — that is sibling bug **#639**. This plan only centralizes the modal open path; #639 will wrap that single path with the gate. Do not change the gate trigger location here.
- Any change to per-wallet connect logic inside `useEvmConnectors` / `useStellarConnectors` (the modal already calls these correctly).
- The connected-state `AccountDropdown` "switch namespace" connect path (`onConnect={kind === "evm" ? evm.connect : stellar.connect}` in TopBar, line 228). That is a connected-user "add the other namespace" action — the namespace is already chosen by `kind`, so it is **not** a wallet-picker ("Connect Wallet") affordance. It is left unchanged. The Issue's affected-areas list is exclusively disconnected-state CTAs, which confirms this reading; if epic-#556 QA later disagrees, it is a follow-up, not a blocker for this fix.

## Assumptions and Risks

- **Assumption:** The desired UX is that ALL disconnected-state "Connect" CTAs open the full `ConnectWalletModal` (network tabs + wallet list), never a chain-specific flow. This matches the Issue's "Expected" section.
- **Assumption:** A single shared `ConnectWalletModal` instance for the whole app is acceptable (it is a full-viewport portal with `z-[9999]`, so one instance suffices). The current code already renders it via `createPortal` to `document.body`.
- **Provider ordering risk:** `ConnectWalletModal` calls `useEvmConnectors()` and `useStellarConnectors()`, which depend on `EvmWalletProvider` / `StellarWalletProvider` (wagmi/kit) AND `useWalletGate()` (WalletGateProvider). So `ConnectModalProvider` must mount **inside** all three of those providers but it can wrap `WalletViewProvider`/`ToastProvider`/`RouterProvider`. Current nesting in `main.tsx` is `WalletGateProvider > EvmWalletProvider > StellarWalletProvider > WalletViewProvider > ToastProvider > RouterProvider`. Place `ConnectModalProvider` just inside `StellarWalletProvider` (wrapping `WalletViewProvider`).
- **Interaction with #639:** Once this lands, #639 should make `open()` route through the gate first (gate → Continue → modal). Keep the `open()` API gate-agnostic so #639 can intercept it. Note in code comments that the gate is currently still triggered inside `connect()`/`connectWallet()` (per-wallet) and #639 will move it.
- **Risk — double-gating after #638+#639:** today the gate fires inside `connectWallet()` (per-wallet). After this issue, the modal is reachable without going through `connect()`, but `connectWallet()` still gates. That is fine for #638 (no behavior regression: gate still appears before the actual connect). Just ensure we do NOT remove the existing gate calls in this issue.
- **Test risk:** TopBar tests assert that clicking Connect opens the modal (looking for `connect-wallet-modal` testid rendered by TopBar). After moving the modal to the provider, those tests must render within `ConnectModalProvider` (or a test helper that provides `open`). Update affected tests.
- **Stale code:** `components/ConnectChooserModal.tsx` appears to be the superseded predecessor of `ConnectWalletModal` (referenced in comments only). Verify it is unused; if dead, note it for tech-debt removal — do not delete in this issue unless trivially confirmed unused.
- **Stale code:** `packages/frontend/src/wallet/evm/WalletGateContext.ts` is a legacy no-arg `openGate()` variant that nothing imports (the live one is `wallet/WalletGateContext.ts`). Out of scope; log to tech-debt tracker if confirmed dead.

## Open Questions

_None._

Two points considered and resolved by the planner (no human input required):

- **AccountDropdown connected-state connect** is intentionally left as a direct chain-specific connect — it is an "add the other namespace" action with the namespace already chosen, not a wallet-picker entry point, and the Issue's affected-areas list is exclusively disconnected-state CTAs (see Scope → Out of scope).
- **`ConnectModalProvider` location** is `src/wallet/`: the modal imports `useEvmConnectors`/`useStellarConnectors` from the wallet module, so co-locating the provider there keeps the dependency direction consistent and matches how `WalletGateProvider` lives in `src/wallet/` while rendering a `../components/` modal.

## Implementation Steps

1. **Create `packages/frontend/src/wallet/ConnectModalContext.ts`** — define `ConnectModalContextValue { open(): void; close(): void }`, a `createContext`, and a `useConnectModal()` hook with a no-op fallback (mirror the pattern in `wallet/WalletViewContext.tsx` and `wallet/WalletGateContext.ts` so isolated tests don't need the provider).

2. **Create `packages/frontend/src/wallet/ConnectModalProvider.tsx`** — owns `const [open, setOpen] = useState(false)`, renders one `<ConnectWalletModal open={open} onDismiss={() => setOpen(false)} />`, and provides `{ open: () => setOpen(true), close: () => setOpen(false) }`. Document that #639 will later interpose the terms gate in front of `open()`.
   - Note: `ConnectWalletModal` lives in `components/`; importing a component into the wallet module is acceptable here (it is the provider's render output), matching how `WalletGateProvider.tsx` imports `FirstConnectionModal` from `../components/`.

3. **Export from the wallet barrel** (`packages/frontend/src/wallet/index.ts`): `ConnectModalProvider`, `useConnectModal`, and the `ConnectModalContextValue` type.

4. **Mount in `packages/frontend/src/main.tsx`** — insert `<ConnectModalProvider>` inside `<StellarWalletProvider>`, wrapping `<WalletViewProvider>`. Verify nesting keeps wagmi/kit + gate providers above it.

5. **`components/TopBar.tsx`** — remove the local `chooserOpen` state (line 120), the inline `<ConnectWalletModal>` (lines 292–295), and the `ConnectWalletModal` import. Read `const { open } = useConnectModal();`. Wire the disconnected Connect button (line 240) and the `MobileNavMenu` `onConnect` (line 284) to `open`.

6. **`routes/index.tsx`** — replace `onConnect={connect}` on both `ConnectWalletPromoCard` instances (lines 198, 288) with `onConnect={open}` from `useConnectModal()`. Remove the now-unused `connect` destructure from `useEvmWallet()` if nothing else uses it on this route (keep `isConnected`).

7. **`routes/deposit.tsx`** — replace the banner `onClick={flow.connect}` (line 466) with `useConnectModal().open`. Leave `flow.connect` in `useDepositFlow` intact (still used? verify — if no remaining consumers, note for tech-debt, do not remove here).

8. **`routes/stake.tsx`** — replace the banner `onClick={connect}` (line 410) with `useConnectModal().open`. Remove the unused `connect` destructure from `useEvmWallet()` if no longer referenced (keep `isConnected`); update the file's header comment block (lines 50–54) that documents the old behavior.

9. **`components/MobileNavMenu.tsx`** — no logic change required if TopBar continues to pass `onConnect={open}`; update the prop doc comment (line 301–303) that references "ConnectChooserModal" to say it opens `ConnectWalletModal` via the shared provider.

10. **Grep sweep** — `grep -rn "\.connect\b" packages/frontend/src/routes packages/frontend/src/components` (excluding tests/stories) to confirm no remaining disconnected-state CTA calls a chain-specific `connect()` directly. Document the AccountDropdown exception (Open Question #1).

11. **Lint** — run `npx tsx scripts/lint-docs.ts` and the frontend type/lint checks after the TypeScript changes.

## Test Strategy

Unit / component tests (Vitest + Testing Library, the existing frontend stack):

1. **New `ConnectModalProvider` test** (`packages/frontend/src/wallet/ConnectModalProvider.test.tsx` — component-style co-located naming, matching `WalletViewContext.test.tsx`): a consumer calling `useConnectModal().open()` renders `ConnectWalletModal` (assert `connect-wallet-modal` testid appears); `.close()` / `onDismiss` removes it. Verify `useConnectModal()` returns the no-op fallback outside the provider without throwing.
2. **TopBar test** (`routes`/`components` existing TopBar test): update to render inside `ConnectModalProvider`; assert clicking `topbar-connect-button` opens the shared modal. Assert TopBar no longer renders its own duplicate modal.
3. **Home route test** (`routes/-index.test.tsx`): assert clicking the `ConnectWalletPromoCard` Connect button (`home-connect-wallet-card`) opens `ConnectWalletModal` (testid `connect-wallet-modal`) and does NOT invoke the EVM AppKit flow / `useEvmWallet().connect`. This is the exact repro from the Issue.
4. **Deposit route test** (`routes/-deposit.test.tsx`): clicking `connect-wallet-banner-action` opens `ConnectWalletModal`.
5. **Stake route test** (`routes/-stake.test.tsx`): clicking `stake-connect-button` opens `ConnectWalletModal`.
6. **MobileNavMenu test** (if present): clicking the "Connect Wallet" CTA invokes `onConnect`, which in the integrated TopBar test opens the shared modal.

Edge cases to cover:
- Multiple call sites can open the single shared instance (no duplicate modals in the DOM).
- Opening the modal while a wallet is already connected is not exercised (CTAs only render when disconnected) — no test needed, but confirm the disconnected guard still holds.

Figma verification: the styled modal that must appear is Figma node `2858-57637` (referenced in `ConnectWalletModal.tsx`). Since the component is unchanged, no new Figma diff is needed; verification is "the same already-Figma-verified modal now opens from every CTA." A manual/ux-tester pass (epic #556 QA) should confirm each CTA opens the network-tabs modal.

## Docs to Update

- No product-spec change required — this is a frontend behavior bug, no new user/agent-facing feature.
- `docs/FRONTEND.md`: the "Web3 integration" / TopBar sections do not document the connect-modal entry points explicitly; add a one-line note that the `ConnectWalletModal` open-state is owned by a shared `ConnectModalProvider` (`useConnectModal().open()`), and every "Connect Wallet" CTA routes through it. (Optional but recommended for the new shared provider.)
- `docs/frontend/hooks.md`: catalogue the new shared `useConnectModal` hook (import path + one-line description) per FRONTEND.md rule 5 (hooks used by 2+ components must be catalogued).
- `docs/exec-plans/tech-debt-tracker.md`: if confirmed dead, log `components/ConnectChooserModal.tsx` and `wallet/evm/WalletGateContext.ts` as removable.
