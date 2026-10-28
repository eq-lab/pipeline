# User Stories: #1749 — Trustee: remove the /sign-in URL layer

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521)
Issue: [#1749](https://github.com/eq-lab/pipeline/issues/1749)
Spec: [docs/frontend/trustee-flows.md#render-level-auth-gate-1008-1749](../../frontend/trustee-flows.md#render-level-auth-gate-1008-1749)

Trustee app (`packages/trustee`) with an allow-listed wallet.

---

## Story 1: Signed-out deep link keeps its URL

**Persona:** Signed-out trustee opening a bookmarked page.

**Steps:**

1. Open `/loans` while signed out.
2. Connect the wallet and sign the message.

**Expected outcomes:**

- The sign-in overlay renders at `/loans` and the URL does not change.
- After sign-in the loans page renders at `/loans`, with no navigation and no extra history entry.

---

## Story 2: Sign out lands on /, token expiry keeps the URL

**Persona:** Signed-in trustee on a protected page.

**Steps:**

1. On `/loans`, open the Account menu and click Sign out.
2. Sign in again and leave the tab idle past the token expiry.

**Expected outcomes:**

- After Sign out the sign-in overlay renders and the URL is `/` (replaced, so Back does not return to `/loans`).
- After token expiry the sign-in overlay renders at the current URL and the URL does not change.
- Back does not move through extra entries.
- The page is never blank and the console has no `Uncaught undefined`.

---

## Story 3: A stale /sign-in bookmark lands on the dashboard

**Persona:** Trustee with an old `/sign-in` bookmark.

**Steps:**

1. While signed in, open `/sign-in`.
2. Sign out, open `/sign-in` again and sign in.

**Expected outcomes:**

- Signed in, the URL becomes `/` and the dashboard renders.
- Signed out, the overlay shows first; after sign-in the URL becomes `/` and the dashboard renders.
