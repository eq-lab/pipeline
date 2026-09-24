# Issue #1362: LP: header Sign in / Sign up entry + signed-in state (production auth entry)

Source: https://github.com/eq-lab/pipeline/issues/1362

## Scope

In scope:

- App-wide mount of `EmailAuthFlow` via a new provider (`AuthFlowProvider` + `useAuthFlow()`), mirroring the `ConnectModalProvider` single-instance pattern.
- `TopBar` desktop right slot: unauthenticated -> "Sign In" + "Sign Up" buttons; authenticated -> account icon button with a menu containing "Sign out" (`useAuthSession().signOut`).
- `MobileNavMenu`: same auth controls in the mobile variant.
- "Continue with wallet" inside the flow opens the shared `ConnectWalletModal` through `useConnectModal().open` (terms gate preserved).
- Connect Wallet / WalletPill coexistence per Figma for each auth x wallet state.
- `/test?tab=auth` preview keeps working unchanged.

Out of scope (stays in #1282): home-page card state machine, composite Total Balance, merged activity feed, removing the dev-only `/account` guard, post-login routing by KYB status (#1274). Forgot-password backend (#1358/#1359). Attaching `authHeaders()` to `apiFetch`.

## Assumptions and Risks

- Figma header frames (KYB Onboarding parent `6486-81556`; header in `6701-98220`, `6701-97538`, `6701-98137`, plus `98099 / 97942 / 98417 / 97340 / 97136 / 98061` listed in #1282) could not be inspected during planning (Figma MCP not authenticated in the planner session). Button variants, the account icon glyph, its menu contents, and control order are therefore unverified — coder MUST pull `get_design_context` / screenshots for those nodes before building (load `figma:figma-design-to-code` first).
- Stacking hazard: `AuthModalShell` and `ConnectWalletModal` share an un-refcounted body-scroll-lock and capture-phase Escape. `EmailAuthFlow`'s "Continue with wallet" already closes the flow before calling `onConnectWallet`; the provider must preserve that order (close first, then `openConnectModal()`), and never open the flow while the wallet modal is open.
- Two `EmailAuthFlow` instances would exist on `/test` (app-wide + the local preview one). Both are closed by default; only one opens at a time via user action, so no stacking. Keep the `/test` local instance to avoid disturbing its tests (see Open Questions).
- `useAuthSession` is same-tab reactive only; cross-tab sign-out won't update the header live (documented limitation, accepted).
- Expired sessions: `readSession()` clears on read; header flips to unauthenticated only on next store read. Acceptable; no timer added.
- `TopBar.test.tsx` (1107 lines) asserts right-slot contents; new buttons will require updating wallet-slot assertions.

## Open Questions

- Which controls show per auth x wallet state? Issue says "follow Figma", but Figma was not readable during planning. Specifically: (a) unauthenticated + no wallet — are Sign In/Sign Up shown alongside or instead of "Connect Wallet"? (b) authenticated + no wallet — is "Connect Wallet" still shown next to the account icon? (c) wallet connected + unauthenticated — WalletPill plus Sign In/Sign Up? Coder should resolve from frames; if frames don't cover a combination, ask the user rather than guess.
- Account icon menu contents: just "Sign out", or also email / account link (e.g. `/account`, which is dev-only guarded today)? Figma may show a dropdown; not verifiable at planning time.
- Should `/test?tab=auth` switch to the app-wide `useAuthFlow()` instead of its local `EmailAuthFlow` instance? Plan default: keep local (issue only asks it to keep working).
- Should successful sign-in (`onAuthenticated`) navigate anywhere or show a toast? Plan default: no navigation (post-login routing is #1282/#1274).

## Implementation Steps

1. Figma pass (before code): load `figma:figma-design-to-code`, pull design context + screenshots for header nodes `6701-98220`, `6701-97538`, `6701-98137` and the other #1282 frames (desktop and mobile). Record per-state control matrix, button variants/labels, account-icon glyph (export exact SVG), menu layout, and Figma node ids. Resolve Open Questions from this; escalate anything uncovered.
2. New `packages/frontend/src/auth/AuthFlowContext.ts` + `packages/frontend/src/auth/AuthFlowProvider.tsx`:
   - Context value `{ open: (screen?: EmailAuthScreen) => void; close: () => void }`; hook `useAuthFlow()` throwing outside provider (mirror `wallet/ConnectModalContext.ts`).
   - Provider holds `open` + `screen` state and renders `<EmailAuthFlow open initialScreen={screen} onClose onConnectWallet={openConnectModal} />`, where `openConnectModal` is `useConnectModal().open`.
   - Export from an `auth/index.ts` barrel (create if absent) alongside `useAuthSession`.
3. `packages/frontend/src/main.tsx`: wrap `<WalletViewProvider>` children with `<AuthFlowProvider>` inside `ConnectModalProvider` (needs `useConnectModal`) and above `RouterProvider`.
4. `packages/frontend/src/components/TopBar.tsx` (desktop right slot `topbar-wallet-slot`):
   - Read `useAuthSession()` and `useAuthFlow()`.
   - Unauthenticated: render `Button` "Sign In" (`data-testid="topbar-sign-in-button"`, -> `open("sign-in")`) and "Sign Up" (`topbar-sign-up-button`, -> `open("create-account")`), variants per Figma; `data-node-id` attributes per Figma.
   - Authenticated: account icon `<button aria-label="Account" aria-haspopup="menu" aria-expanded>` (`topbar-account-button`) toggling a small menu (`topbar-account-menu`) with "Sign out" (`topbar-sign-out`) -> `signOut()` then close menu. Close on Escape / outside click (reuse `AccountDropdown` / `useAccountDropdown` dismissal pattern if it fits, otherwise a new `AuthAccountMenu.tsx` + `useAuthAccountMenu.ts` per the component/hook split convention).
   - Keep NetworkSwitcher / Connect Wallet / WalletPill per the matrix from step 1.
5. `packages/frontend/src/components/MobileNavMenu.tsx`: add props `isAuthenticated`, `onSignIn`, `onSignUp`, `onSignOut`; render auth controls per mobile Figma frame; closing the menu before opening the auth flow (avoid menu portal + modal overlap). Wire from `TopBar`.
6. `packages/frontend/src/routes/test.tsx`: no behavior change; verify it still renders its own `EmailAuthFlow` and tests pass.
7. Run `pnpm` lint, typecheck, unit tests for frontend (see `test-fast` skill).

## Test Strategy

- `auth/AuthFlowProvider.test.tsx`: `open("sign-in")` / `open("create-account")` renders the matching modal; `close` hides it; "Continue with wallet" closes the flow then calls the connect-modal `open` (mock `useConnectModal`); `useAuthFlow` outside provider throws.
- `TopBar.test.tsx`: unauthenticated shows Sign In/Sign Up (and the Figma-decided wallet controls); clicking each opens the right screen (exactly one `dialog`); authenticated (seed via `saveSession`) shows account icon, no Sign In/Up; menu opens, Sign out calls `clearSession` and header reverts; Escape/outside click closes menu; session expiry case (expired `expiresAt`) renders unauthenticated. Update existing wallet-slot assertions for the new matrix.
- `MobileNavMenu.test.tsx` (or TopBar mobile cases): auth controls render per state; Sign In closes menu and opens flow.
- Stacking invariant: after "Continue with wallet", only `ConnectWalletModal` dialog is present and body scroll-lock remains.
- `-test.test.tsx` passes unchanged.
- Figma verification: compare rendered header (desktop >= md and mobile) in each auth x wallet state against the frames from step 1 via Chrome DevTools screenshots.

## Docs to Update

- `docs/frontend/auth-components.md`: replace the "No production entry point changes in this epic yet" paragraph; add `### AuthFlowProvider` section; note the `/test` preview keeps its own instance.
- `docs/frontend/dashboard-components.md` `### TopBar` (and mobile menu section): auth controls, state matrix, Figma node ids, test ids.
- `docs/frontend/dashboard-components.md` `### Root layout` / provider tree note for `AuthFlowProvider`.
- Relevant product spec for LP auth entry in `docs/product-specs/` (header now exposes sign-in/sign-up) — update the section describing KYB login entry.
