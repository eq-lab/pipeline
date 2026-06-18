# Issue #639: Connect Wallet modal: 'Before you continue' gate should precede the modal, not appear after wallet selection

Source: https://github.com/eq-lab/pipeline/issues/639

Part of epic #556. Stacked on top of #638 (`feat/638-connect-wallet-modal-everywhere`, not yet merged). This branch `feat/639-wallet-gate-before-modal` is based on the #638 work; the #638 implementation (shared `ConnectModalProvider` / `useConnectModal()`) is already present in this branch.

## Scope

Reorder the two modals so the chain-agnostic first-connection terms gate (`FirstConnectionModal`, driven by `WalletGateProvider.openGate`) fires **before** the big `ConnectWalletModal` opens, for every "Connect Wallet" entry point.

Target flow:

**Connect Wallet CTA → "Before you continue" gate → Continue → `ConnectWalletModal` (network tabs + wallet picker) → pick a wallet → connect.**

If terms are already acknowledged (`pipeline.wallet.termsAcknowledged` set), the gate is skipped and `ConnectWalletModal` opens immediately — preserving the existing auto-skip behavior in `WalletGateProvider`.

In scope:

- Make the centralized modal-open path (`ConnectModalProvider.open()` / `useConnectModal().open()`) route through the gate first.
- Remove the now-redundant gate triggers from the per-wallet connect paths so the gate is not shown a second time after the user picks a wallet (avoid the post-#638 double-gating risk flagged in the #638 plan).
- Keep the mock-wallet short-circuit (dev affordance) bypassing the gate.

Out of scope:

- Visual/styling changes to either modal.
- Changing the terms-acknowledgement persistence or migration logic (`useTermsAcknowledgement`).
- Removing dead `packages/frontend/src/wallet/evm/WalletGateContext.ts` (legacy no-arg variant) — tracked separately as tech debt by #638; do not touch here beyond confirming it stays unused.

## Assumptions and Risks

- **Stacked-branch dependency:** This work assumes #638's `ConnectModalProvider` / `useConnectModal()` is present (it is, on this branch). The PR for #639 targets/merges after #638. Note in the PR description that it is stacked on #638.
- **Provider ordering is already correct for this change.** In `main.tsx` the nesting is `WalletGateProvider > EvmWalletProvider > StellarWalletProvider > ConnectModalProvider > WalletViewProvider > ...`. Because `ConnectModalProvider` is nested **inside** `WalletGateProvider`, it can call `useWalletGate()` and wrap its `open()` with `openGate(...)`. No reordering of providers is required.
- **Synchronous ack check:** The gate decision must read the flag synchronously inside the click handler (use the existing non-hook helper `readTermsAcknowledged()` from `wallet/useTermsAcknowledgement.ts`), matching how `useEvmWallet.connect()` does it today, so the open path stays a single user-gesture call.
- **Double-gating risk (the core fix):** Today the gate fires inside the per-wallet `connectWallet()` paths (`useEvmConnectors`, `useStellarConnectors`) which run *after* the user picks a wallet inside `ConnectWalletModal`. Once the gate moves in front of `open()`, leaving those per-wallet gate calls in place would show the gate twice. They must be removed. After removal, the per-wallet connect paths simply run the chain connect directly (still respecting the mock short-circuit).
- **Top-level `connect()` callers:** `useEvmWallet.connect()` and `useStellarWallet.connect()` still contain `openGate(...)`. Per #638, the disconnected-state CTAs now call `useConnectModal().open()` instead of `connect()`. Need to confirm no remaining production CTA still calls `connect()` directly for the disconnected→connect flow; if any do, they should be migrated to `open()` or have their gate ordering preserved. (See Open Questions.) The `connect()` methods themselves remain part of the wallet hook API (used by mock paths/tests), so they are not deleted.
- **Focus restoration:** `WalletGateProvider.handleContinue` already restores focus to the trigger element before invoking `onProceed`. Since `onProceed` will now be "open the ConnectWalletModal" (which itself manages focus), confirm the existing focus-restore-then-proceed sequence still behaves (the modal focuses its first focusable element on open via a `setTimeout(…,0)`).

## Open Questions

- After #638, do any remaining **production** components still call `useEvmWallet().connect()` / `useStellarWallet().connect()` directly for a disconnected→connect action (rather than `useConnectModal().open()`)? Grep currently shows only `routes/index.tsx` comment references and the hook definitions, but the coder must verify during implementation. If such a caller exists, the gate trigger on `connect()` may need to stay (and we must avoid double-gating). The plan below assumes the centralized `open()` path is the single disconnected-connect entry point; if that assumption breaks, revisit which `openGate` calls to remove.

## Implementation Steps

1. **Wrap the modal open path with the gate — `packages/frontend/src/wallet/ConnectModalProvider.tsx`:**
   - Import `useWalletGate` from `./WalletGateContext` and `readTermsAcknowledged` from `./useTermsAcknowledgement`.
   - Keep the internal `setIsOpen(true)` as a private `openModal` callback.
   - Change the public `open` callback so that:
     - If `readTermsAcknowledged()` is `true`, call `openModal()` directly (skip the gate).
     - Otherwise call `openGate(() => openModal())` so the gate shows first and only opens the modal after the user clicks Continue.
   - `close` is unchanged.
   - Update the file's header comment: the gate is now interposed here (remove the "#639 will move it" TODO note and describe the actual behavior).

2. **Remove the now-redundant per-wallet gate triggers — `packages/frontend/src/wallet/evm/useEvmWallet.ts`:**
   - In `useEvmConnectors().connectWallet` (around lines 135–161): remove the `useWalletGate()` import usage and the `if (!readTermsAcknowledged()) { openGate(doConnect); return; }` block so it calls `doConnect()` directly (still keeping the mock short-circuit at the top). Remove the now-unused `openGate`/`useWalletGate` references in this hook if no longer used.
   - Decide on `useEvmWallet().connect()` (lines 53/79): per the Open Question, if no production caller uses it for disconnected-connect, leave its gate logic as-is (harmless, used by tests/mock) OR simplify — do **not** change its external behavior. Default: leave `connect()` untouched to minimize risk; only remove the gate from the per-wallet `connectWallet` path that runs inside the modal.

3. **Remove the now-redundant per-wallet gate trigger — `packages/frontend/src/wallet/stellar/useStellarWallet.ts`:**
   - In `useStellarConnectors().connectWallet` (around lines 220–256): remove the `if (!readTermsAcknowledged()) { openGate(() => void doConnect()); return; }` block so it `await doConnect()` directly (keeping the mock short-circuit). Drop the now-unused `useWalletGate()`/`openGate` from this hook if unused.
   - Leave `useStellarWallet().connect()` (lines 85/139) untouched for the same reason as EVM (see Open Question), unless implementation reveals a production caller.

4. **Verify provider tree — `packages/frontend/src/main.tsx`:** No change expected. Confirm `ConnectModalProvider` remains inside `WalletGateProvider` so `useWalletGate()` resolves to the real provider (not the no-op fallback). Add no new providers.

5. **Update header comments** in `packages/frontend/src/wallet/ConnectModalContext.ts` and `ConnectModalProvider.tsx` to reflect that the gate now precedes `open()` (the existing comments say "#639 will move it" — update them to the implemented state).

## Test Strategy

Unit tests (Vitest + Testing Library), co-located:

1. **`packages/frontend/src/wallet/ConnectModalProvider.test.tsx` (extend existing):**
   - Mock `FirstConnectionModal`/`useWalletGate` (or render within a real `WalletGateProvider`) and mock `ConnectWalletModal` as the existing test already does.
   - New cases:
     - **Gate-first when terms not acknowledged:** with `pipeline.wallet.termsAcknowledged` absent, calling `open()` shows the gate (`FirstConnectionModal`) and does NOT yet render `connect-wallet-modal`. After "Continue", `connect-wallet-modal` appears.
     - **Skip gate when acknowledged:** with the flag set to `"true"` in localStorage, `open()` renders `connect-wallet-modal` immediately and never shows the gate.
     - **Dismiss gate:** clicking dismiss on the gate closes it and does NOT open `connect-wallet-modal`.
   - Use `localStorage.clear()` in `beforeEach`.

2. **`packages/frontend/src/wallet/evm/useEvmWallet.test.tsx` (update):** Adjust/remove assertions that expect `useEvmConnectors().connectWallet` to open the gate; assert it now calls the wagmi connect directly (no `openGate`) when terms are unacknowledged. Keep the mock short-circuit assertion.

3. **`packages/frontend/src/wallet/stellar/useStellarWallet.test.tsx` (update):** Mirror the EVM change for `useStellarConnectors().connectWallet` — no gate, calls kit connect directly; mock short-circuit preserved.

4. **Regression:** Confirm `useEvmWallet().connect()` / `useStellarWallet().connect()` tests (if any still assert gate behavior) remain green if those paths are left untouched.

Run the frontend unit suite (e.g. `yarn --cwd packages/frontend test` / the repo's `test-fast`) and the lint/typecheck. Run `npx tsx scripts/lint-docs.ts` after the docs update.

Manual verification (per Issue Repro):

1. Clear `pipeline.wallet.termsAcknowledged` from localStorage and disconnect.
2. Click **Connect Wallet** in the TopBar → the "Before you continue" gate appears first.
3. Click **Continue** → `ConnectWalletModal` (network tabs + wallet picker) opens.
4. Pick a wallet → connect proceeds without the gate reappearing.
5. Reload, repeat from a CTA other than TopBar (home promo card, deposit banner, stake banner, mobile nav) → same gate-first ordering.
6. With the flag already set, clicking any CTA opens `ConnectWalletModal` directly (no gate).

Note: Issue #639 has no Figma URL of its own; the relevant Figma references for both modals live in epic #556 (`ConnectWalletModal` Figma node-id 2858-57637, referenced in `ConnectWalletModal.tsx`). No new Figma-driven visual verification is required because this is a behavioral/ordering fix, not a layout change.

## Docs to Update

- `docs/frontend/hooks.md`: update the `useEvmConnectors` and `useStellarConnectors` rows — they no longer "route through the terms gate" (the gate now precedes the centralized modal open). Update the `useEvmWallet`/`useStellarWallet` rows only if their `connect()` gate behavior changes (per the Open Question, likely unchanged). Add/adjust a note for the connect-modal provider if it is documented there.
- When this lands, the active plan moves to `docs/exec-plans/completed/` (manager handles the lifecycle/commit, per protocol).
- No product-spec change required: this is a bug fix restoring the intended ordering, not new user-facing behavior. The intended flow already matches epic #556's design.
