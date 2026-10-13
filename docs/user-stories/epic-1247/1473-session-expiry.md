# User Stories: #1473 — Session expiry: sign the LP out when the token lapses

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1473](https://github.com/eq-lab/pipeline/issues/1473)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md#session-module),
[docs/product-specs/api-authorization-email.md](../../product-specs/api-authorization-email.md#frontend)

**Scope note:** No Figma frame exists for this behaviour. The only new visual is the toast, which is
the shipped `Toast` component (Figma `1497:95175` / `1497:95270` for the component itself), so there
is no new pixel verification. Wallets stay connected after a session ends, by design (#1460: "wallet
connected, no session" is a designed state). Mid-session suspension (#1465) is unchanged and silent.

**How QA seeds expiry and revocation (DevTools):** the session lives in `localStorage` under
`pipeline.auth.session` as JSON `{ token, expiresAt, email }`. A direct `localStorage` edit does not
notify the app, so always reload after editing.

- Expiry: sign in, then run
  `s = JSON.parse(localStorage["pipeline.auth.session"]); s.expiresAt = Date.now() + 60_000; localStorage["pipeline.auth.session"] = JSON.stringify(s)`
  and reload. The timer is armed from the stored `expiresAt` on load.
- Revocation: append `x` to the stored `token` and reload. The backend answers `401` to the next
  authenticated request.

---

## Story 1: The token lapses while the LP is on `/`

**Persona:** A signed-in LP leaving the home page open.

**Pre-conditions:**
- Signed in; seed expiry about 60 s ahead (see above) and reload.
- No wallet connected.

**Steps:**

1. Stay on `/` without interacting or reloading.
2. At about 60 s, observe the header and the page.
3. Wait about 10 s more.

**Expected outcomes:**

- Step 2: with no reload, the header flips to Sign In / Sign Up, the URL stays `/`, and a neutral
  toast "Your session expired. Sign in again to continue." appears with a `Sign in` button.
- Step 3: the toast auto-dismisses after about 10 s (it also has its own dismiss button).

---

## Story 2: The token lapses while the LP is on `/account`

**Persona:** A signed-in LP on their Account page, with a wallet connected.

**Pre-conditions:**
- Signed in, a wallet connected; open `/account`; seed expiry about 60 s ahead and reload.

**Steps:**

1. Wait for the expiry.
2. Observe the URL and the page, then press the browser Back button.

**Expected outcomes:**

- Step 1: the app navigates to `/` with `replace`, so the toast from Story 1 appears over the home
  page.
- Step 2: with a wallet connected, home state 7 renders and the header keeps the account icon (the
  wallet-only variant). Back does not return to the signed-in `/account`.

---

## Story 3: The toast's `Sign in` opens the sign-in screen, and signing in re-arms the timer

**Persona:** An LP whose session just expired.

**Pre-conditions:** Story 1 reached the toast.

**Steps:**

1. Click `Sign in` on the toast.
2. Sign in again with valid credentials.
3. Seed expiry about 60 s ahead again, reload, and wait for it.

**Expected outcomes:**

- Step 1: the auth modal opens on the "Sign in" screen.
- Step 2: the session is saved and the header shows the account icon.
- Step 3: a second toast appears at the new expiry (the timer re-armed for the new session).

---

## Story 4: A revoked or tampered token (authenticated `401`)

**Persona:** An LP whose token the backend no longer accepts.

**Pre-conditions:**
- Signed in; append `x` to the stored `token` and reload.

**Steps:**

1. Load `/` (or `/account`) and watch the Network tab.
2. Observe the header and the toast.

**Expected outcomes:**

- Step 1: `GET /v1/lps/me` answers `401`.
- Step 2: exactly one sign-out and one toast, even with several requests in flight and React Query
  retries (repeated 401s do not stack toasts or navigate twice). The header shows Sign In / Sign Up
  and the URL is `/`.

---

## Story 5: A wrong password on Sign In does not trigger the session-expired flow

**Persona:** A signed-out visitor mistyping their password.

**Pre-conditions:** No session in `localStorage`.

**Steps:**

1. Click "Sign In", enter a valid email and a wrong password, and submit.

**Expected outcomes:**

- `POST /v1/auth/login` answers `401` and only the form's "Incorrect email or password" appears.
- No "Your session expired" toast and no navigation: the request carries no `Authorization` header,
  so it never counts as an authenticated 401.

---

## Story 6: Mid-session suspension is unchanged

**Persona:** A signed-in LP whose account is suspended server-side.

**Pre-conditions:** As in Story 1 of
[1465-suspended-account-signout.md](../epic-1419/1465-suspended-account-signout.md) (an authenticated
request answers `403 account_suspended`).

**Steps:**

1. Follow Story 2 of
   [1465-suspended-account-signout.md](../epic-1419/1465-suspended-account-signout.md).

**Expected outcomes:**

- The LP is signed out and lands on `/`, silently: no toast, no modal. The behaviour is not
  duplicated here; it now runs through `subscribeSessionEnded` with reason `suspended`.

---

## Story 7: The wallet stays connected after expiry

**Persona:** A signed-in LP with a wallet connected whose session expires.

**Pre-conditions:** Signed in, a wallet connected; seed expiry about 60 s ahead and reload.

**Steps:**

1. Wait for the expiry (Story 1).
2. Open `/account`.
3. Reload the page.

**Expected outcomes:**

- Step 2: `/account` shows the wallet-only variant (wallet card present, email row offering
  `Add email`), not a redirect.
- Step 3: the wallet is still connected after the reload and there is no session in `localStorage`.
