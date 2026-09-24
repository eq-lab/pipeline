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

## Open Questions — RESOLVED (2026-09-24, coder pass)

Answers came from the #1362 Issue comment (2026-09-24) after Figma MCP access was restored, and
from `get_design_context` pulls on the two given nodes during implementation:

- **Which controls show per auth x wallet state?** No Connect Wallet button and no WalletPill in
  the header in *either* auth state — confirmed by `get_design_context` on both frames (neither
  emits any wallet-related node). Signed out (`6701:98403`): "Sign In" (`Button variant="secondary"`)
  + "Sign Up" (`Button variant="primary-dark"`). Signed in (`6701:97929`): a single 48×48 account
  icon button (`6701:97941`), no wallet pill alongside it. Wallet connection moved entirely to
  `/account`'s `AccountWalletCard` (already wired per #1284).
- **Account icon menu contents:** no menu at all — the Issue comment overrides the plan's default;
  the icon navigates directly to `/account`. Sign-out is not a header concern any more; it is
  `/account`'s existing "Log Out" button (previously an unwired seam from #1284/#1265), now wired
  to `useAuthSession().signOut()` + navigate to `/`.
- **`/test?tab=auth`:** kept its own local `EmailAuthFlow` instance, as planned (plan default
  confirmed).
- **Successful sign-in:** no navigation, no toast (plan default confirmed) — only the header
  re-renders via `useAuthSession()`'s reactive session store.

**Additional decisions made during implementation, beyond the plan/Issue comment's explicit scope**
(documented in `dashboard-components.md#topbar` and `docs/exec-plans/tech-debt-tracker.md`):

- No Figma frame exists for a mobile header/menu variant in this epic (confirmed via
  `get_metadata` — every `header` frame in the file is 1728px wide). `MobileNavMenu`'s auth section
  (Sign In/Sign Up stacked, or an Account row) mirrors the desktop matrix by judgment, not a Figma
  trace — flagged as a design gap, not treated as a blocker.
  `NetworkSwitcher` was kept in both the desktop and mobile auth slots — it is a separate,
  unrelated feature (#1032 mainnet/testnet indicator), not part of the "no wallet UI" removal.
- Removing the header's `WalletPill`/`AccountDropdown`/`MobileNavMenu` wallet rows leaves no UI
  control anywhere to *disconnect* a wallet (`AccountWalletCard` only has `Connect Wallet`) —
  logged as TD-92. `AccountDropdown.tsx` itself is now orphaned (TD-93), left in the tree rather
  than deleted.
- `/account`'s route guard changed from `ENV.IS_DEV`-only to `!ENV.IS_DEV && readSession() === null`;
  `?state=` preview overrides were additionally gated behind `ENV.IS_DEV` explicitly in
  `validateSearch` (previously inherited dev-only-ness transitively from the route guard, which no
  longer holds now that authenticated production users can reach the route).
- Audited existing wallet-connect entry points: the Home/Deposit/Stake/Transactions pages each
  already have their own `useConnectModal()` CTA independent of the header, so removing the
  header's redundant global button does not strand unauthenticated wallet connection.

## Implementation Steps — ALL COMPLETE (2026-09-24)

1. **DONE.** Figma pass: loaded `figma:figma-design-to-code`, pulled `get_design_context` for
   `6701:98403` (signed out) and `6701:97929` (signed in), plus a `get_metadata` sweep confirming
   no mobile header frame exists in the file. Resolved the Open Questions above from this.
2. **DONE.** `packages/frontend/src/auth/AuthFlowContext.ts` + `AuthFlowProvider.tsx` — as
   planned, except `useAuthFlow()` **throws** outside the provider (matching the Test Strategy
   section below) rather than the no-op-fallback pattern `ConnectModalContext.ts` uses; noted as a
   deliberate deviation, not an oversight — TopBar/MobileNavMenu are always inside the provider in
   production. `auth/index.ts` barrel created.
3. **DONE.** `main.tsx`: `AuthFlowProvider` wraps `WalletViewProvider`/`ToastProvider`/
   `RouterProvider`, inside `ConnectModalProvider`.
4. **DONE, simplified vs. plan.** `TopBar.tsx`'s right slot (`topbar-wallet-slot`, name kept):
   unauthenticated → `Button variant="secondary"` "Sign In" (`topbar-sign-in-button`) +
   `Button variant="primary-dark"` "Sign Up" (`topbar-sign-up-button`), both `data-node-id`-tagged.
   Authenticated → one 48×48 `AccountGlyph` icon button (`topbar-account-button`) that navigates to
   `/account` — **no menu**, per the Issue comment override (plan step 4 assumed a menu with
   "Sign out"; superseded). `NetworkSwitcher` kept; `WalletPill`/`AccountDropdown`/Connect Wallet
   button removed entirely (not "kept per the matrix" — the matrix turned out to have none).
5. **DONE, simplified vs. plan.** `MobileNavMenu.tsx`: props are `isAuthenticated`, `onSignIn`,
   `onSignUp` (no `onSignOut` — sign-out is `/account`'s Log Out button, not a header control).
   Signed-out: stacked full-width Sign In/Sign Up buttons. Signed-in: one Account row navigating to
   `/account` via the existing `onNavigate`. The previous wallet address/balance/Connect/Disconnect
   rows were removed (see Open Questions above).
6. **DONE.** `routes/test.tsx`: unchanged, still renders its own local `EmailAuthFlow`; its tests
   pass unmodified.
7. **DONE, expanded beyond plan.** Also touched: `routes/account.tsx` (auth guard +
   `onLogOut` wiring + `?state=` dev-only gating), `AccountGlyph.tsx` (new shared 24px icon),
   `TopBar.test.tsx` / `MobileNavMenu.test.tsx` (rewritten for the auth matrix, dropped all
   wagmi/Stellar scaffolding no longer needed), `AccountDropdown.test.tsx` (rewritten against a
   local harness instead of the real `TopBar`, since `TopBar` no longer renders it),
   `AuthFlowProvider.test.tsx` (new), `-account.test.tsx` / `-account-route-dev-only.test.tsx`
   (updated for the new guard). Lint, build, and the full frontend test suite (1934 tests) are
   green.

## Test Strategy — DONE (adjusted for "no menu")

- `auth/AuthFlowProvider.test.tsx` (new): `open("sign-in")` / `open("create-account")` / `open()`
  default all render `EmailAuthFlow` (mocked) on the right screen; `close()` (context) and the
  flow's own `onClose` both hide it; `onConnectWallet` wired to the mocked `useConnectModal().open`;
  `useAuthFlow()` outside the provider throws. Matches the plan as written.
- `TopBar.test.tsx`: rewritten — unauthenticated shows Sign In/Sign Up, no account button;
  authenticated (mocked `useAuthSession`) shows the account button, no Sign In/Up, and clicking it
  navigates to `/account` (asserted via the in-test router's `location.pathname`). No "menu opens /
  Sign out" tests — there is no menu (plan superseded by the Issue comment). `@/auth` is mocked at
  module level rather than seeding real `localStorage` sessions, since `TopBar` no longer needs any
  wallet provider tree at all once the wallet UI was removed — this let the whole file drop its
  wagmi/AppKit/Stellar-wallets-kit scaffolding.
- `MobileNavMenu.test.tsx`: rewritten similarly — signed-out shows Sign In/Sign Up (each closes the
  menu then calls its callback); signed-in shows the Account row (closes the menu, calls
  `onNavigate("/account")`).
- Stacking invariant: covered by `AuthFlowProvider.test.tsx`'s "Continue with wallet" test at the
  provider level (no header-level mock-EmailAuthFlow stacking test was needed since the header
  itself renders no modal directly).
- `-test.test.tsx` passes unchanged, confirmed.
- Figma verification: `get_design_context` screenshots for both frames compared against the
  implementation during the coder pass (no mobile frame exists to compare against — see Open
  Questions). A full rendered-app Chrome DevTools comparison is the `ux-tester` phase's job, not
  the coder's.

## Docs to Update — ALL DONE

- `docs/frontend/auth-components.md`: replaced the "No production entry point changes" paragraph;
  added `### AuthFlowProvider`; updated the "Diagnostics preview seam" cross-reference; updated the
  `KYB sign-in (#1248)` note in `dashboard-components.md`'s `ConnectWalletModal` section.
- `docs/frontend/dashboard-components.md` `### TopBar`: rewritten for the no-wallet-UI matrix,
  including a "Where wallet-connect entry points still live" audit. `### AccountDropdown`: marked
  orphaned. `### MobileNavMenu`: rewritten auth section.
- `docs/frontend/dashboard-components.md` `### Root layout`: added the `main.tsx` provider-tree
  note for `AuthFlowProvider` (no pre-existing provider-tree doc existed to extend).
- `docs/product-specs/api-authorization-email.md` `## Frontend`: updated to describe the #1362
  production entry point and the `/account` guard change.
- `docs/frontend/account-page.md`: updated the route guard section, the `?state=` preview
  contract, the seams table (`onLogOut` now wired), the out-of-scope table, and the
  `AccountWalletCard`/`TopBar.tsx` cross-references.
- `docs/exec-plans/tech-debt-tracker.md`: logged TD-92 (no wallet disconnect UI) and TD-93
  (`AccountDropdown` orphaned).
- `docs/user-stories/epic-1247/1362-header-auth-entry.md` (new) + linked from
  `docs/user-stories/index.md`.
