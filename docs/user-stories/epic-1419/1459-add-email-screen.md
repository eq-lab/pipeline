# User Stories: #1459 — Add email screen for a wallet-connected visitor

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1459](https://github.com/eq-lab/pipeline/issues/1459)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md#addemailmodal),
[docs/frontend/account-page.md](../../frontend/account-page.md#wallet-only-variant-1458),
[docs/product-specs/api-authorization-email.md](../../product-specs/api-authorization-email.md)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=7129-15702&m=dev
— frame `7129:15702` "Default, Save disabled" and
https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=7129-15921&m=dev — frame
`7129:15921` "Enabled, Save solid". Back arrow instance `7129:15704` at (20, 20).

**Scope note.** This screen **is** the create-account registration (email + password → OTP →
session, same path `CreateAccountModal` uses) reached from `/account`'s `Add email` row instead of
the header's `Sign Up` button. It is not a new account type, and nothing about the visitor's
connected wallet is read by, or sent to, this flow — registering does not link the wallet address
to the new account (see #1458's
[`account-page.md#wallet-only-variant-1458`](../../frontend/account-page.md#wallet-only-variant-1458)).
This issue ships only the screen, the flow wiring, and the `openAddEmail()` re-point — #1458 already
shipped the entry seam.

---

## Story 1: `Add email` opens the dedicated screen with the Figma chrome

**Persona:** A visitor with a connected wallet and no session, on `/account`.

**Pre-conditions:** Same as #1458 Story 4 — a wallet is connected, no auth session.

**Steps:**

1. Click the `Add email` row.

**Expected outcomes:**

- `useAuthFlow().openAddEmail()` opens `EmailAuthFlow` on its `"add-email"` screen, rendering
  `AddEmailModal` (`add-email-modal`).
- No right-hand image pane, no close icon (`×`) — only a back arrow at top-left (`aria-label="Back"`).
- The content column is vertically centered, matching Figma's 438px-tall centered container.
- Heading "Add email" (Heading L) and description "Enter your corporate email and create a
  password" render above two fields.

---

## Story 2: `Save` stays disabled until both fields validate

**Persona:** The visitor from Story 1, viewing the open Add email screen.

**Pre-conditions:** Screen open, both fields empty.

**Steps:**

1. Observe `Save` with both fields empty.
2. Enter a well-formed email and a password that fails the policy (e.g. `short1`).
3. Replace the password with one that passes the policy (`≥ 8` chars, a digit, a special
   character).

**Expected outcomes:**

- Step 1: `Save` is disabled, rendered at 32% opacity (`#000080` at `opacity-[0.32]`), matching
  frame `7129:15702`.
- Step 2: `Save` stays disabled — a well-formed email alone does not enable it.
- Step 3: `Save` enables and renders solid `#000080`, matching frame `7129:15921`.

---

## Story 3: Validation-error copy on blur

**Persona:** The visitor from Story 1.

**Pre-conditions:** Screen open.

**Steps:**

1. Type a malformed email (e.g. `nope`) and blur the field.
2. Type a weak, non-empty password (e.g. `weak`) and blur the field.

**Expected outcomes:**

- Step 1: "Enter the correct email address" appears — the same copy and `TextField` invalid
  treatment as `CreateAccountModal`'s frame `6585:75897` (#1281), since no dedicated Add-email
  error frame exists in Figma.
- Step 2: "At least 8 characters, including a number and a special character" appears, and clears
  live once the password satisfies the policy.
- `Save` stays disabled while either error is showing.

---

## Story 4: Submit → OTP → correct code → session, including the account-setup modal

**Persona:** The visitor from Story 1, with a valid email and password entered.

**Pre-conditions:** Screen open, Turnstile has yielded a token, both fields valid.

**Steps:**

1. Click `Save`.
2. Enter the correct six-digit code on the OTP screen.

**Expected outcomes:**

- Step 1: `signup` is called with the entered credentials and the signup captcha token; on success
  the flow advances to `OtpModal`, showing "We've sent a passcode to `<email>`".
- Step 2: `verifyOtp` succeeds, the session is saved, and `EmailAuthFlow` closes — the visitor lands
  back on `/account` with no page navigation.
- **End-state (user-confirmed 2026-10-12):** immediately after, `AuthFlowProvider`'s existing
  `GET /v1/lps/me` effect fires for the new session, returns `404` for the brand-new (LP-less)
  account, and opens `CompanyDocsModal` ("Finish account setup") over `/account` — identical to
  what happens after a header Sign Up. This is inherited provider behaviour (#1265/#1278), not new
  code shipped by this issue.
- The header keeps the account icon (it already showed the icon for the wallet-only visitor); the
  `Add email` row is replaced by the session's email once `AccountEmailCard` re-renders.

---

## Story 5: Back arrow and Escape close the flow with no side effects

**Persona:** The visitor from Story 1.

**Pre-conditions:** Screen open, nothing submitted.

**Steps:**

1. Click the back arrow.
2. Reopen the screen, then press Escape.

**Expected outcomes:**

- Both: the flow closes (`onDismiss`/`onClose`) and the visitor remains on `/account` — no
  navigation, no session created, no `signup` call.
- Unlike `OtpModal`'s back arrow (which returns to a sibling screen), this screen's back arrow has
  no sibling to return to — it dismisses the whole flow, per the Issue.
- If the visitor had instead reached OTP from this screen and used *its* back arrow, they return
  here (`add-email-modal`), not to `sign-in-modal` — the create-account → OTP → back → sign-in path
  is unaffected (regression guard).

---

## Story 6: An already-registered address still advances to OTP — no "email taken" copy

**Persona:** A visitor who (perhaps unknowingly) enters an email already registered to another
account.

**Pre-conditions:** Screen open, valid password entered.

**Steps:**

1. Enter an already-registered email and a valid password, then click `Save`.

**Expected outcomes:**

- `signup` answers `202` exactly as it would for a new address (enumeration resistance — see
  `api-authorization-email.md`); the flow advances to the OTP screen as usual.
- No "email taken", "email already registered", or similar copy renders anywhere on this screen or
  the OTP screen — this screen's only error states are the generic `formError` and the captcha
  status/retry block, the same set `CreateAccountModal` has. A `429` lockout response is never
  returned by `signup` and is not special-cased here — lockout belongs to `login`.

---

## Story 7: The connected wallet is neither read nor sent — registering does not link it

**Persona:** The visitor from Story 1, with a wallet connected.

**Pre-conditions:** Screen open.

**Steps:**

1. Complete the full flow (Story 4) while a wallet remains connected.

**Expected outcomes:**

- The `signup` request body contains only `{ email, password, captchaToken }` — no wallet address,
  no chain id, no signature.
- The new account is not associated with the connected wallet by this flow; nothing in
  `AddEmailModal`, `useEmailAuthFlow`, or `AuthFlowProvider` reads wallet state for this screen.
- The wallet's own connection state (and the `Disconnect` row on the wallet card) is unaffected by
  signing up — this screen only ever touches the auth session.
