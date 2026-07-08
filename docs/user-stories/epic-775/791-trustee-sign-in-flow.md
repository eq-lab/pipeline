# User Stories: #791 — Trustee: sign-in flow — wallet-connect wiring + session + route gating

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#791](https://github.com/eq-lab/pipeline/issues/791)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md)), [docs/product-specs/api-authorization.md](../../product-specs/api-authorization.md)

Turns the UI-only sign-in gate shipped by #787 into a working, backend-authenticated flow:
wallet connect → `GET /v1/auth/challenge` → sign the message → `POST /v1/auth/verify` → store
the JWT → redirect to the dashboard. Authorization is entirely server-side (an allow-list); a
`401` renders as an explicit error state on the sign-in card, not a client-side role check.

---

## Story 1: Connect Wallet opens the wallet picker

**Persona:** Trustee operator visiting the app before connecting a wallet.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), no existing session (clear `sessionStorage`).

**Steps:**

1. Navigate to `http://localhost:5174/sign-in`.
2. Click the "Connect Wallet" button.

**Expected outcomes:**

- The shared wallet-connect picker modal opens (same modal used by the LP frontend), offering
  EVM and Soroban tabs.
- No terms-gate modal appears first — the Trustee omits the LP's first-connection terms gate.

---

## Story 2: Successful sign-in reaches the dashboard

**Persona:** Trustee operator whose wallet address is on the backend allow-list.

**Pre-conditions:** On `/sign-in`; a wallet whose address is seeded in `auth_users` for the
configured chain.

**Steps:**

1. Click "Connect Wallet" and connect an allow-listed EVM or Stellar wallet.
2. Approve the connection in the wallet picker.
3. Sign the message the wallet prompts for (the backend challenge message).

**Expected outcomes:**

- The card shows a busy/"Connecting…" state while the flow is in progress.
- After signing, the browser navigates to `/` (the dashboard).
- The Trustee topbar now shows the flow-type nav, a truncated wallet address, and a "Sign out"
  control.
- A `pipeline.trustee.session` key exists in `sessionStorage` containing the bearer token.

---

## Story 3: Unauthorized wallet shows an explicit error

**Persona:** Trustee operator (or anyone) connecting a wallet that is NOT on the backend
allow-list.

**Pre-conditions:** On `/sign-in`; a wallet address not present in `auth_users`.

**Steps:**

1. Click "Connect Wallet" and connect the non-allow-listed wallet.

**Expected outcomes:**

- The backend's `401` from `GET /v1/auth/challenge` surfaces as an inline error on the sign-in
  card: "This wallet is not authorized to sign in. Contact your administrator."
- The button changes to "Try a different wallet"; clicking it disconnects and returns to the
  base sign-in state.
- No wallet signature prompt ever appears (the flow stops at the challenge step).

---

## Story 4: Rejecting the signature returns to the sign-in state quietly

**Persona:** Trustee operator who connects an allow-listed wallet but declines to sign.

**Pre-conditions:** On `/sign-in`; an allow-listed wallet.

**Steps:**

1. Click "Connect Wallet" and connect the wallet.
2. Reject/cancel the signature request in the wallet.

**Expected outcomes:**

- The card returns to the base "Connect Wallet" state — no error banner is shown (a declined
  signature is a user choice, not a failure).
- No session token is stored; the dashboard remains inaccessible.

---

## Story 5: Route gating redirects unauthenticated visitors

**Persona:** Trustee operator (or anyone) without a valid session.

**Pre-conditions:** No valid session in `sessionStorage` (or an expired one).

**Steps:**

1. Navigate directly to a protected route, e.g. `http://localhost:5174/type4-monitoring`.

**Expected outcomes:**

- The browser redirects to `/sign-in`.
- The topbar renders without the flow-type nav or account controls (the sign-in screen is
  standalone).

---

## Story 6: Authenticated visitor is redirected away from `/sign-in`

**Persona:** Trustee operator with an existing valid session.

**Pre-conditions:** A valid, unexpired session in `sessionStorage` (e.g. from Story 2).

**Steps:**

1. Navigate directly to `http://localhost:5174/sign-in`.

**Expected outcomes:**

- The browser redirects to `/` — there is no reason to re-show the sign-in card once a session
  exists.

---

## Story 7: Sign-out clears the session and returns to sign-in

**Persona:** Trustee operator ending their session.

**Pre-conditions:** Signed in (Story 2).

**Steps:**

1. Click "Sign out" in the topbar.

**Expected outcomes:**

- The browser navigates to `/sign-in`.
- The `pipeline.trustee.session` key is removed from `sessionStorage`.
- The connected wallet is disconnected.
- Navigating back to a protected route redirects to `/sign-in` again (Story 5).

---

## Story 8: Session survives an in-tab reload, not a new tab

**Persona:** Trustee operator refreshing the page mid-session.

**Pre-conditions:** Signed in (Story 2).

**Steps:**

1. Reload the page (same tab).
2. Open the Trustee app in a new browser tab (not a duplicated tab).

**Expected outcomes:**

- After the reload, the dashboard is still reachable without re-authenticating (the session is
  read from `sessionStorage` on load).
- The new tab requires sign-in again — `sessionStorage` does not carry across tabs, by design
  (the bearer token should not outlive the browser tab it was issued to).
