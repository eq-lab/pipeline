# User Stories: #1465 — Suspended (KYB-rejected) account: sign-in shows the 403 error; an already signed-in LP is signed out

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1465](https://github.com/eq-lab/pipeline/issues/1465)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md#session-module),
[docs/product-specs/api-authorization-email.md](../../product-specs/api-authorization-email.md#frontend)

**Scope note:** No Figma frame exists for this behaviour (confirmed with the Issue) — there is no
visual to verify. Copy is the already-shipped `SUSPENDED_ERROR_MESSAGE` string, surfaced only on the
existing sign-in form's `formError` slot; chrome is otherwise the shipped `TopBar`/`SignInModal`. The
forced mid-session sign-out itself shows **no message at all** — it clears the session and returns to
`/` silently. Backend behaviour (a `Failed` KYB verdict suspends the account; every bearer request and
both sign-in mint paths answer `403 account_suspended`) is already shipped and out of scope.

---

## Story 1: A suspended LP signing in sees the message, and no session is created

**Persona:** An LP whose KYB verdict is `Failed` (account suspended), returning to sign in with email
and password.

**Pre-conditions:**
- No session in `localStorage`.
- The LP's account is suspended server-side.

**Steps:**

1. Open the sign-in form and submit the LP's correct email and password.

**Expected outcomes:**

- Step 1: `login` answers `403 account_suspended`. The sign-in form shows "This account is suspended.
  Contact support." in its existing `formError` slot (`role="alert"`) — not the OTP screen. No
  session is saved; `readSession()` stays `null`.

---

## Story 2: A signed-in LP whose account is suspended mid-session is signed out silently

**Persona:** An LP with a live session whose KYB verdict flips to `Failed` while they are using the
app (e.g. a stale tab, or a decision landing between two of their own requests).

**Pre-conditions:**
- A valid session in `localStorage`.
- The LP's account is suspended server-side (the next authenticated request will 403).

**Steps:**

1. With the app open, trigger any authenticated request (e.g. load `/account`, or anything that calls
   `getMyLp`).
2. Observe the header.
3. Observe the URL and the page.

**Expected outcomes:**

- Step 1: the request answers `403 account_suspended`. The global `subscribeAccountSuspended` seam
  fires; `useSuspensionSignOut` clears the session and navigates to `/` (`replace: true`).
- Step 2: the header reverts to Sign In / Sign Up on its own (`useAuthSession`'s existing reactivity,
  #1364) — no manual refresh needed.
- Step 3: the app lands on `/`. **No modal opens and no toast appears** — the sign-out is silent. The
  suspension copy is not shown until the LP's next sign-in attempt (Story 1).

---

## Story 3: The same forced sign-out reached from `/account`

**Persona:** Same as Story 2, on the Account page.

**Pre-conditions:** Same as Story 2.

**Steps:**

1. Navigate to `/account` while the session is still valid.
2. Observe the page.

**Expected outcomes:**

- Step 1: `/account`'s own `getMyLp` call answers `403 account_suspended`, which fires the same
  global seam as Story 2 before the page can render its 403 stand-in (the declined copy with `Retry`
  suppressed, `docs/frontend/account-page.md`). The LP is signed out and redirected to `/`, the same
  as Story 2 — the page does not linger on the declined stand-in. That stand-in remains shipped and
  tested as a defensive fallback (e.g. a tree mounted without the root subscriber), but is not the
  path a running app takes.

---

## Story 4: An unrelated 403 leaves the session intact

**Persona:** A signed-in LP who hits an authenticated 403 for a reason other than suspension.

**Pre-conditions:**
- A valid session in `localStorage`.

**Steps:**

1. Trigger an authenticated request that answers `403` with an error body other than
   `account_suspended` (e.g. a forbidden write).

**Expected outcomes:**

- Step 1: `subscribeAccountSuspended` listeners are not notified. The session is untouched; the LP
  stays signed in and on the current page. The request's own `ApiError` still rejects normally for
  its caller to handle.

---

## Story 5: Two authenticated requests 403ing together sign out once

**Persona:** Same as Story 2, where more than one in-flight authenticated request 403s around the
same time (e.g. `AuthFlowProvider`'s own `getMyLp` and another call site's).

**Pre-conditions:** Same as Story 2.

**Steps:**

1. Trigger two authenticated requests that both answer `403 account_suspended` in close succession.

**Expected outcomes:**

- Step 1: the first notification clears the session and navigates home. The second notification's
  `readSession()` check sees the session is already `null` and no-ops — no double navigation, no
  error from acting on an already-cleared session.
