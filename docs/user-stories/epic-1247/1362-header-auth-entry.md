# User Stories: #1362 — LP header auth entry (Sign in / Sign up + signed-in state)

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1362](https://github.com/eq-lab/pipeline/issues/1362)
Spec: [docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#topbar),
[docs/frontend/auth-components.md](../../frontend/auth-components.md#authflowprovider),
[docs/frontend/account-page.md](../../frontend/account-page.md#route-and-dev-only-guard)

The LP header (`TopBar`, desktop and mobile) now exposes the production auth entry point that
`#1265` deferred: signed out shows "Sign In" / "Sign Up" (Figma node `6701:98403`); signed in
shows a single account icon (Figma node `6701:97929`) that navigates to `/account` (now open to
authenticated LPs, not only `ENV.IS_DEV`). There is no Connect Wallet button or wallet pill in the
header in either state any more — wallet connection lives on `/account`'s wallet card. `/test?tab=auth`
keeps its own independent auth-flow instance (Story 9 there still applies unchanged).

Stories 1–6 and 8 are fully browser-drivable against a dev deployment (`ENV.IS_DEV` true, which is
also required to reach `/test?tab=auth`'s preview links used to seed a session for Stories 4–8).
Story 7 (the production redirect for an unauthenticated visitor) cannot be exercised against a dev
deployment, since `ENV.IS_DEV` alone already grants `/account` access there — flagged as
code-review-verified instead (see `routes/account.tsx`'s `beforeLoad`).

---

## Story 1: Signed-out desktop header shows Sign In and Sign Up, no wallet controls

**Persona:** Any visitor, not authenticated, no session in `localStorage`.

**Pre-conditions:** Fresh browser profile (or `localStorage.clear()`), desktop viewport (≥768px
wide), land on `/`.

**Steps:**

1. Load the app and observe the header's right slot (`data-testid="topbar-wallet-slot"`).

**Expected outcomes:**

- Two buttons are visible: "Sign In" (`data-testid="topbar-sign-in-button"`) and "Sign Up"
  (`data-testid="topbar-sign-up-button"`), Sign Up visually emphasized (dark fill).
- No "Connect Wallet" button and no wallet balance pill anywhere in the header.
- The network indicator pill (e.g. "Testnet") is still present, to the left of the auth buttons —
  unrelated to auth, unaffected by this issue.

---

## Story 2: Clicking Sign In opens the sign-in screen; clicking Sign Up opens create-account

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click "Sign In".
2. Close the modal (× or Escape).
3. Click "Sign Up".

**Expected outcomes:**

- Step 1 opens the two-pane auth modal on the "Sign in" screen (heading "Sign in", email/password
  fields, "Continue with wallet").
- Step 3 opens the same modal shell on the "Create account" screen (heading "Create account").
- Exactly one dialog is present at a time; closing one leaves none open.

---

## Story 3: "Continue with wallet" from the header's auth flow closes it and opens the wallet connect screen

**Persona:** Visitor who opens Sign In from the header but decides to connect a wallet instead.

**Pre-conditions:** Header's Sign In or Sign Up modal open (via Story 2).

**Steps:**

1. Click "Continue with wallet".

**Expected outcomes:**

- The Sign In/Sign Up modal closes.
- `ConnectWalletModal` (EVM/Soroban tabs, full-viewport) opens in its place — the same modal
  `/account`'s "Connect Wallet" button opens.
- No auth-flow dialog remains open behind it.

---

## Story 4: A successful sign-in flips the header to the signed-in state with no navigation

**Persona:** Registered, verified LP with a known email/password (or completing signup + OTP first
via `/test?tab=auth`, then returning to `/`).

**Pre-conditions:** A verified test account exists on the target API; starting on `/` (or any other
LP route), unauthenticated.

**Steps:**

1. Click "Sign In" in the header, submit the known verified email and password.

**Expected outcomes:**

- On success, the modal closes and the page you were on stays the current page — no redirect, no
  toast.
- The header's right slot now shows a single 48×48 account icon button
  (`data-testid="topbar-account-button"`, `aria-label="Account"`) instead of Sign In/Sign Up.
- Reloading the page keeps the signed-in header (session persists in `localStorage`).

---

## Story 5: The account icon navigates to /account; no dropdown menu

**Persona:** Authenticated LP (post Story 4).

**Pre-conditions:** Signed in, desktop viewport, on `/`.

**Steps:**

1. Click the account icon button in the header.

**Expected outcomes:**

- The app navigates directly to `/account` — no intermediate menu/dropdown appears.
- The `/account` page renders (heading "Account", wallet card, corporate email card, documents
  card, "Log Out" button) — see `account-page.md` for its own state matrix.

---

## Story 6: Sign out on /account clears the session and reverts the header

**Persona:** Authenticated LP on `/account` (post Story 5).

**Pre-conditions:** Signed in, on `/account`.

**Steps:**

1. Click "Log Out" at the bottom of `/account`.

**Expected outcomes:**

- The app navigates to `/`.
- The header's right slot immediately shows "Sign In" / "Sign Up" again (signed-out state) — no
  reload needed.
- Reloading confirms the session is actually gone: `/account` is unreachable again (dev
  deployments still reach it via the `ENV.IS_DEV` bypass — see Story 7).

---

## Story 7: An unauthenticated visitor cannot reach /account in production (code-review-verified)

**Persona:** Anonymous visitor, no session.

**Pre-conditions:** A production build (`ENV.IS_DEV` false) — not exercisable against a normal dev
deployment, where `IS_DEV` alone grants access regardless of auth.

**Steps (for a human/staging check, not an agent against `localhost`):**

1. Navigate directly to `/account` with no session cookie/localStorage entry.

**Expected outcomes:**

- Redirected to `/` (`routes/account.tsx`'s `beforeLoad`: `!ENV.IS_DEV && readSession() === null`
  → `redirect({ to: "/" })`).
- `?state=<id>` preview overrides are also inert outside `ENV.IS_DEV`, even for an authenticated
  production user (`validateSearch` only calls `parseAccountStatePreview` when `ENV.IS_DEV`).

---

## Story 8: Mobile menu mirrors the desktop auth entry

**Persona:** Same as Stories 1 and 4, mobile viewport.

**Pre-conditions:** Viewport below 768px wide (or resize the browser / use device emulation).

**Steps:**

1. Unauthenticated: tap the hamburger icon, observe the menu's bottom section.
2. Close the menu, sign in (Story 4), tap the hamburger icon again.

**Expected outcomes:**

- Step 1: the menu shows two full-width stacked buttons, "Sign In"
  (`data-testid="mobile-sign-in-button"`) above "Sign Up"
  (`data-testid="mobile-sign-up-button"`) — no Connect Wallet CTA, no wallet address/balance rows.
  Tapping either closes the menu and opens the same auth modal as the desktop buttons.
- Step 2 (signed in): the menu instead shows one row, a dark circular account icon + "Account"
  label (`data-testid="mobile-account-button"`) — tapping it closes the menu and navigates to
  `/account`.
- The Network row (label + current-network pill) is present in both states, unaffected by auth.

---

## Story 9: /test?tab=auth keeps its own independent preview instance

**Persona:** Developer/QA using the diagnostics route.

**Pre-conditions:** `ENV.IS_DEV` true, on `/test?tab=auth`.

**Steps:**

1. Open Sign In from the header (production entry) and leave it open.
2. In a fresh tab/window, open `/test?tab=auth` and click "Open Sign In modal".

**Expected outcomes:**

- The two instances are independent: closing one does not affect the other, and neither reads the
  other's screen/open state.
- `/test?tab=auth`'s own session-status line, Sign out button, and six modal triggers all still
  work exactly as documented in `1265-wire-kyb-auth.md` — unchanged by this issue.
