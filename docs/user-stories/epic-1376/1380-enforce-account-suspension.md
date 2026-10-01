# User stories — #1380 Backend: enforce accounts.status = 'Suspended' in authorization

Epic: [#1376 — KYB review lifecycle](https://github.com/eq-lab/pipeline/issues/1376)
Issue: [#1380](https://github.com/eq-lab/pipeline/issues/1380)
Spec: [docs/product-specs/api-authorization.md#security](../../product-specs/api-authorization.md#security)

This issue is backend-only — no UI changes. Stories verify observable API behavior;
every action below is exercised with `curl` or an HTTP client against a running
`pipeline-api` instance, not a browser.

Nothing sets `accounts.status = 'Suspended'` through the product flow except a
terminal KYB `Failed` verdict (#1274). Stories that need a suspended account without
driving KYB to `Failed` set it directly:
`UPDATE accounts SET status = 'Suspended' WHERE id = '<account_id>'`; restore with
`UPDATE accounts SET status = 'Active' WHERE id = '<account_id>'`.

---

## Story 1 — Suspension bites on the very next request, not the next login

**Setup:** Sign in (email or wallet) as an account with any bearer-protected route
available (e.g. `GET /v1/lps/me`). Keep the issued token.

**Action:**
1. Call the route once with the token — confirm it succeeds.
2. Suspend the account directly in the database.
3. Replay the **same** request with the **same** token — no re-login.

**Expected outcomes:**

- Step 1 succeeds (`200`).
- Step 3 returns `403 {"error":"account_suspended"}` — not `401`, not the role-guard
  message, and without waiting for the token to expire.

---

## Story 2 — Restoring the account works immediately, with the same token

**Setup:** Continuing from Story 1, with the account still suspended and the same
token still held.

**Action:** `UPDATE accounts SET status = 'Active' WHERE id = '<account_id>'`, then
replay the same authenticated request with the same token — still no re-login.

**Expected outcomes:**

- The request succeeds (`200`) again, proving the check is per-request against the
  live `accounts.status` value, not cached on the token or anywhere else.

---

## Story 3 — Email login refuses a suspended account at mint time

**Setup:** An account with email/password credentials, suspended directly in the
database.

**Action:** `POST /v1/auth/login` with the correct email and password.

**Expected outcomes:**

- The response is `403 {"error":"account_suspended"}` — no token is issued.

---

## Story 4 — Wallet sign-in refuses a suspended account at mint time

**Setup:** An account with a wallet credential in `auth_users` (trustee or
originator), suspended directly in the database.

**Action:** `GET /v1/auth/challenge` for the address, sign the returned message, then
`POST /v1/auth/verify` with the signature.

**Expected outcomes:**

- `GET /v1/auth/challenge` still succeeds (the account row is not checked there).
- `POST /v1/auth/verify` returns `403 {"error":"account_suspended"}` — no token is
  issued, even though the signature is valid. Before this issue, this path never
  read `accounts` at all and would have minted a token.

---

## Story 5 — A terminal KYB refusal locks the LP owner out from their next call

**Setup:** An LP `UnderReview` with at least one document, owned by an account
currently able to call `GET /v1/lps/me` successfully. Keep that account's token.

**Action:** A trustee records a `Failed` verdict
(`POST /v1/lps/{id}/review` with `decision: "Failed"`), then the LP owner replays
`GET /v1/lps/me` with the same token.

**Expected outcomes:**

- The trustee's review call succeeds and the LP's `kyb_status` becomes `Failed`.
- The owner's replayed call now returns `403 {"error":"account_suspended"}` — the
  same request that worked before the verdict, with no re-login in between.

---

## Story 6 — Suspension is distinguishable from a role refusal

**Setup:** Two tokens: one for a suspended account with the `trustee` role, one for
an **active** account that lacks the `trustee` role.

**Action:** Call a trustee-only route (e.g. `GET /v1/loan-book/submissions`) with
each token.

**Expected outcomes:**

- The suspended trustee's token gets `403 {"error":"account_suspended"}`.
- The active non-trustee's token gets `403 {"error":"this endpoint requires the
  \`trustee\` role"}`.
- The two response bodies carry different `error` strings, so a support agent
  reading either can tell which condition applies without guessing.

---

## Story 7 — `POST /v1/auth/verify-otp` keeps its uniform refusal

**Setup:** An unverified account (never completed signup) that is also suspended
directly in the database, holding an outstanding OTP code.

**Action:** `POST /v1/auth/verify-otp` with the correct email and code.

**Expected outcomes:**

- The response is still the shared `401 "invalid or expired code"` — unchanged by
  this issue, deliberately, so the endpoint does not become an address-enumeration
  oracle.

---

## Story 8 — An unknown account behind a valid-looking token fails closed

**Setup:** A token whose `account_id` claim does not correspond to any row in
`accounts` (e.g. the account was deleted after the token was issued — simulate by
signing a token for a fabricated UUID, or delete the account row behind a live
token if the environment allows it).

**Action:** Call any bearer-protected route with that token.

**Expected outcomes:**

- The response is `401 {"error":"invalid or expired token"}` — refused, not waved
  through, even though the token's signature and expiry are both otherwise valid.
