# Issue #684: [FE] [Stellar] Home page shows "Connect wallet" when only a Stellar wallet is connected

Source: https://github.com/eq-lab/pipeline/issues/684

## Scope

Make the home page connection gate chain-aware so a Stellar-only session sees the connected portfolio layout instead of the disconnected `ConnectWalletPromoCard`.

In scope:

- `packages/frontend/src/routes/index.tsx` — replace the EVM-only `isConnected` derivation (line 112, `const { isConnected } = useEvmWallet();`) with a view-aware derivation that mirrors the deposit/stake convention: read the active namespace's connection state based on `useWalletView().kind`.
- All existing `isConnected` branches in the file (desktop top-card promo-vs-portfolio at ~line 282, mobile top-card at ~line 189, `WelcomeHeader` greeting, Stake-CTA gating, `mobileHomeState`, `totalBalanceFormatted`) keep their current logic but now key off the corrected, chain-aware `isConnected`.

Out of scope (deferred follow-up — see Open Questions / Docs):

- Wiring Stellar balances into the home page (Total Balance, `mobileHomeState`, Stake-CTA gating, `StartHere`/`Earned`/`StakeCard` mobile props). These reads remain EVM-only (`useEvmToken` for PLUSD/sPLUSD, `useStakedPlusdConvertToAssets`). As a result, a Stellar-only user will see a *connected* home view with `$0.00` Total Balance and a disabled Stake CTA. This is strictly better than the reported bug (it no longer shows the wrong "Connect wallet" screen and correctly reflects that a wallet is connected), is consistent with the existing `PortfolioPlaceholderCard` "real data wiring is deferred" placeholder, and is fully separable. It should be tracked as its own sub-issue of epic #463.

## Assumptions and Risks

- **Convention chosen:** the home gate selects by `useWalletView().kind` (active view), NOT by the broader `anyConnected = evm || stellar`. Rationale: the home page's connected content (Total Balance, Stake CTA, mobile states) is single-namespace data that is currently EVM-sourced; the deposit route (`src/routes/deposit.tsx`) and the `useDepositFlow` / `useStakeFlow` adapters all gate content on the active view kind (`kind === "stellar" ? stellarConnected : evmConnected`). Matching that keeps the home page consistent with the rest of the connected UI and avoids showing a connected EVM layout when the user has actively switched their view to Stellar (and vice-versa). TopBar uses `anyConnected` only for the pill (a header affordance), which is a different concern.
- The reported repro (Stellar wallet connected, EVM not) implies the user's `useWalletView().kind` is `"stellar"` (the connect/disconnect flows set the view kind to the namespace just acted on). With the view-kind gate, that session reads `stellar.isConnected === true` → connected layout. Confirmed sufficient to fix the bug.
- Risk: `useWalletView()` returns the safe default `{ kind: "evm" }` outside its provider; the home route is mounted inside the full provider tree (root layout), so this is not a concern in the app, only in isolated tests (handled in Test Strategy by wrapping with `WalletViewProvider` or relying on the EVM default).
- No Figma URL is referenced in the issue (node IDs only); no new design surface is introduced, so no Figma verification step is required. The layout structure is unchanged — only which branch renders.
- `useStellarWallet()` exposes `{ address, isConnected, connect, disconnect }` (see `src/wallet/stellar/useStellarWallet.ts`), already exported from the `@/wallet` barrel — no new wiring needed.

## Open Questions

_None_

(The issue's scope decision — (a) connection gate only vs (b) full Stellar balance wiring — is resolved in favor of (a). Option (a) cleanly fixes the reported wrong-screen bug, and (b) is genuinely separable: the resulting connected `$0.00` view is usable and consistent with the existing deferred-data placeholder, not broken or unshippable. (b) is recommended as a follow-up sub-issue of epic #463; see Docs to Update.)

## Implementation Steps

1. In `packages/frontend/src/routes/index.tsx`:
   - Add imports from `@/wallet`: `useStellarWallet` and `useWalletView` (keep `useEvmWallet`). Prefer importing all three from the `@/wallet` barrel for consistency with `TopBar.tsx`.
   - Replace line 112 `const { isConnected } = useEvmWallet();` with a view-aware derivation, e.g.:
     ```ts
     const evm = useEvmWallet();
     const stellar = useStellarWallet();
     const { kind } = useWalletView();
     const isConnected = kind === "stellar" ? stellar.isConnected : evm.isConnected;
     ```
   - Leave all downstream uses of `isConnected` (desktop/mobile top-card branch, `WelcomeHeader isConnected`, `mobileHomeState`, `totalBalanceFormatted`, `stakeDisabled`) unchanged — they now correctly key off the chain-aware value.
2. Update the component's doc comment block (the "Top-left card branching" section and the `isConnected === false` reference around lines 59–64) to state that connection is derived from the active wallet view's namespace, not EVM-only, and to note the known limitation that balances are still EVM-sourced (link to the follow-up issue once filed).
3. Confirm no other symbol in the file still assumes EVM-only connection. Balance hooks (`useEvmToken`, `useStakedPlusd*`) intentionally remain EVM-sourced for this issue; add a brief inline comment near them noting Stellar balance wiring is deferred to the follow-up sub-issue of #463.
4. Run the frontend type-check / lint and the doc lint (`npx tsx scripts/lint-docs.ts`) per AGENTS.md.

## Test Strategy

- **New unit/component test** `packages/frontend/src/routes/index.test.tsx` (no test file exists today). Render the `Home` component (the route's `component`) inside the wallet provider tree (or with the EVM/Stellar wallet hooks and `useWalletView` mocked, following the mocking style used in existing `src/wallet/*.test.tsx` and any existing route tests). Cover:
  1. **Stellar-only connected + Stellar view** → asserts the connected layout renders (`data-testid="home-portfolio-placeholder"` present) and the promo (`data-testid="home-connect-wallet-card"`) is absent. This is the regression guard for the reported bug.
  2. **EVM-only connected + EVM view** → connected layout renders (no regression to existing behavior).
  3. **Neither connected** → disconnected promo renders (`home-connect-wallet-card` present, portfolio absent), in both EVM and Stellar view kinds.
  4. (Optional) **Stellar connected but view kind = EVM, EVM disconnected** → documents the chosen view-kind semantics (shows disconnected layout). Include only if it does not over-constrain; otherwise note the chosen semantics in a comment.
- Reuse the project's existing wallet-mock utilities (`src/wallet/evm/mock.ts`, `src/wallet/stellar/mock.ts`) or hook mocks as used by sibling tests rather than introducing a new mocking approach.
- Run the fast suite via the `test-fast` skill (lint + unit + integration) and ensure the new test passes and existing frontend tests are unaffected.

## Docs to Update

- `packages/frontend/src/routes/index.tsx` — header doc comment (covered in Implementation Step 2). This is the only behavior-describing doc tied to the change; no `docs/product-specs/` entry changes because user-facing intent (connected users see their portfolio) is unchanged — this restores intended behavior for Stellar.
- **Follow-up to file (not part of this issue's commit):** a new sub-issue of epic #463 — "[FE] [Stellar] Wire Stellar balances into the home page (Total Balance, mobile state, Stake-CTA gating)" — capturing the deferred (b) scope: source PLUSD via `useStellarSacToken({ assetCode: "PLUSD", ... })`, sPLUSD via `useStellarStakedPlusdBalance()`, select by `useWalletView().kind` exactly as `useStakeFlow` does. The manager/human can file this; reference it from the inline comment added in Step 3.
- If a follow-up is not filed immediately, log the deferred balance-wiring gap in `docs/exec-plans/tech-debt-tracker.md` per AGENTS.md so it is not lost.
