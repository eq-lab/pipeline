# User Stories: #1731 — Trustee (staging): white screen after wallet sign-in and after logout

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521)
Issue: [#1731](https://github.com/eq-lab/pipeline/issues/1731)
Spec: [docs/frontend/trustee-flows.md#render-level-auth-gate-1008-1749](../../frontend/trustee-flows.md#render-level-auth-gate-1008-1749)

Trustee app (`packages/trustee`) on staging with an allow-listed wallet and DevTools open (Console and Network) before sign-in.

---

## Story 1: Sign in renders the dashboard in place

**Persona:** Trustee on the sign-in overlay connecting an allow-listed wallet.

**Steps:**

1. Open the app signed out, click Connect Wallet, pick a wallet and sign the message.

**Expected outcomes:**

- The dashboard renders on the same URL without a refresh.
- The browser history has no extra entry.

---

## Story 2: Sign out renders the overlay in place

**Persona:** Signed-in trustee.

**Steps:**

1. From `/`, open the Account menu and click Sign out.
2. Sign in again, open `/loans`, and sign out again.
3. Press Back.

**Expected outcomes:**

- The sign-in overlay renders on the current URL both times, without a refresh.
- Back does not return to a protected page.

---

## Story 3: Token expiry while idle

**Persona:** Signed-in trustee leaving the tab idle past the token expiry.

**Expected outcomes:**

- The sign-in overlay renders on the current URL when the token expires.

---

## Story 4: No blank page and no uncaught undefined

**Expected outcomes:**

- In Stories 1 to 3 the console has no `Uncaught undefined` and `#root` is never empty.
- Any `[trustee] ...` console line names the source, the thrown value and its type, and the router state.

---

## Story 5: A render error shows an error view

**Persona:** Trustee hitting an unexpected render error.

**Expected outcomes:**

- A "Something went wrong" view shows the message (or `Non-error value thrown: undefined`), the stack when there is one, the current path and a Reload button, instead of a white page.
- Reload loads the app again.
