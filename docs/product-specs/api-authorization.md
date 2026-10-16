# API Authorization

## Overview

The Pipeline API authorizes callers with a short-lived **JWT**. A caller proves
who they are with one of two credentials: a **wallet signature** over a
server-issued challenge, from an address on the manually-curated `auth_users`
allow-list (this spec); or **email and password**, LP self-serve and open to
anyone (see [api-authorization-email.md](./api-authorization-email.md)). The
wallet flow supports **EVM** chains (EIP-191 `personal_sign`, secp256k1) and
**Stellar** chains (SEP-0053, ed25519), resolved from the required
`chain_id`, which must be one of the configured `CHAINS` (no default).

Both resolve to the same principal: a row in **`accounts`**. A wallet is a
credential *of* an account, not an identity in its own right, and one human may
hold both credentials on one account. Every issued token carries `account_id`,
and **authorization keys off that claim** — never off the wallet pair.

Roles remain manually assigned in `auth_users`. Nothing self-serve can grant a
role, so registering an account confers no privilege beyond starting KYB.

## Behavior

1. **Challenge.** The client requests a challenge for its `(chain_id, address)`.
   If the address is on the allow-list, the server generates a fresh random
   single-use nonce (UUID v4), stores it on the user's row (overwriting any
   previous nonce), and returns the exact welcome message to sign. Unknown
   addresses are rejected.
2. **Sign.** The wallet signs the returned `message` string verbatim:
   - EVM — EIP-191 `personal_sign` over the message string; signature sent as hex.
   - Stellar — SEP-0053 `signMessage` (e.g. Freighter): the wallet signs
     `SHA256("Stellar Signed Message:\n" || message)` with ed25519; signature sent
     as base64 (Stellar-native) or hex.
3. **Verify.** The client posts `{chain_id, address, signature}`. The server
   reconstructs the message from the nonce **currently stored** for that user,
   verifies the signature against the claimed address, and — on success — clears
   the nonce (single-use, so the challenge cannot be replayed) and issues a JWT.
4. **Authorize.** The client sends `Authorization: Bearer <jwt>`. The token is validated
   (signature, expiry, not older than the account's last password reset), the account must be
   `Active` (else `403 account_suspended`), and a required **role** it lacks is a `403`.

The challenge message is the single source of truth for the signed bytes and is
identical between issuance and verification. It is a **single line** (no newlines)
so that signing the JSON-transported value cannot diverge from signing the
decoded string:

```
Welcome to Pipeline! Sign this message to authenticate. This request will not trigger a blockchain transaction or cost any gas. Address: <address> Chain ID: <chain_id> Nonce: <nonce>
```

## API Contract

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET`  | `/v1/auth/challenge?chain_id&address` | none | Required `chain_id`: missing, malformed, or not in `CHAINS` → `400` (`chain_id is required` / `invalid chain_id: <v>` / `unknown chain_id: <id> (configured: …)`). Returns `{ message, nonce }` for an allow-listed address; rotates the stored nonce. `401` if the address is not authorized. |
| `POST` | `/v1/auth/verify` | none | Body `{ chain_id, address, signature }` (`signature`: hex for EVM, base64 or hex for Stellar). `chain_id` is required: missing or not in `CHAINS` → `400` with the same messages as the challenge; the chain kind (EVM / Stellar) comes from the configured chain. Returns `{ token, expires_in }` on a valid signature. `401` for unknown address, no outstanding challenge, or bad signature. `403 account_suspended` if the account behind the address is suspended. |
| `POST` | `/v1/auth/signup` | none | Body `{ email, password, captcha_token }`. **Always `202`** — see [api-authorization-email.md](./api-authorization-email.md). `400` on a malformed address or a password failing the policy, `403` if the captcha is rejected, `503` if the captcha provider is unreachable. |
| `POST` | `/v1/auth/verify-otp` | none | Body `{ email, code }`. Returns `{ token, expires_in }`. `401` for every failure mode, with one shared message. |
| `POST` | `/v1/auth/resend-otp` | none | Body `{ email, captcha_token }`. Always `202` — inside the 60-second cooldown the send is skipped silently. `403`/`503` per the captcha. |
| `POST` | `/v1/auth/login` | none | Body `{ email, password }`. Returns `{ token, expires_in }`. `401` for an unknown address or a wrong password (indistinguishable, in body and in timing), `403 email_not_verified` for an unverified account, `403 account_suspended` for a suspended one, `429` past the attempt limit. |
| `POST` | `/v1/auth/forgot-password` | none | Body `{ email, captcha_token }`. Always `202`; a reset link is mailed only to a verified, active account, at most once per 60 seconds. `403`/`503` per the captcha, `429` past 10 requests per hour per client address. See [api-authorization-password-reset.md](./api-authorization-password-reset.md). |
| `POST` | `/v1/auth/reset-password` | none | Body `{ token, password }`. `204` on success, with no token issued; every token the account held before is rejected from then on. `400` for a password failing the policy, `401` for every link failure, with one shared message. |
| `POST` | `/v1/loan-book/loan?chain_id` | bearer + `originator` role | Submit a loan application (all `draw_loan` inputs; see [Loan submission](./api-authorization-loan-submission.md)). Optional `chain_id` is the target chain (defaults to `DEFAULT_CHAIN_ID`; not in `CHAINS` → `400`). Validated against the on-chain `draw_loan` invariants, then persisted as `InReview`. `201 { id }` on success, `400` on validation failure, `401` without a valid token, `403` without the `originator` role. |
| `GET`  | `/v1/loan-book/submissions?status&chain_id` | none (public) | List submissions, newest first. Optional `status` filter (`InReview`/`Approved`/`Rejected`/`ChangesRequested`); omit for all. Optional `chain_id` filters by target chain; omitted returns all submissions, a configured id filters by target, a well-formed id not in `CHAINS` is `200` with an empty list. `400` on an unknown status value or a malformed/repeated `chain_id`. Each item carries `target_chain_id` and the nullable drawn `chain_id` / `loan_id`. |
| `POST` | `/v1/loan-book/submissions/{id}/review` | bearer + `trustee` role | Apply a trustee decision. Body `{ decision: "Approved"｜"Rejected"｜"ChangesRequested", reason? }`; a rejection or a changes-requested decision requires a non-empty `reason`, an approval must omit it. `200` on success, `400` on a malformed decision, `404` if the id is unknown, `409` if the submission is already `Approved`/`Rejected` (terminal). |
| `POST` | `/v1/loan-book/submissions/{id}/resubmit` | bearer + `originator` role | Resubmit a `ChangesRequested` submission with a corrected payload (same body as `/v1/loan-book/loan`), reopening it for review. Full replace: overwrites `loan_data` plus the valuation anchor and fee schedule, resets `status` to `InReview`, and clears `reason`; the target chain is kept. `200 { id }` on success, `400` on validation failure, `401` without a valid token, `403` without the `originator` role, `404` if the id is unknown, `409` if the submission is not in `ChangesRequested` or the new `metadata_uri` collides with another undrawn submission. |

Tokens are **ES256** (P-256) signed, expire **24 hours** after issuance
(`expires_in = 86400`), and carry `sub`, `chain_id`, `account_id`, `roles`,
`iat`, `exp`. A wallet token's `sub` is the normalized address and `chain_id`
the chain, exactly as before — `account_id` is purely additive, so existing
clients are unaffected. An email token's `sub` is the account id and its
`chain_id` is `null`.

Tokens cannot be revoked one by one (TD-80: no refresh token, session table or logout),
but `accounts.status` and `password_changed_at` are read every request, so suspension or
a password reset ends every session at once. Requiring `account_id` signed everyone out once.

Protect a new endpoint by taking `AuthClaims`: it rejects `401` for an invalid token and
`403 account_suspended` for a suspended account. Require a role via `claims.has_role("…")`,
returning `403 Forbidden` when absent (see `routes::loan_book::submit_loan`).

## Data Model

`accounts` — the principal, keyed by a uuid:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` | primary key; the `account_id` JWT claim |
| `email` | `TEXT` | unique, lowercase (enforced by check constraint); `NULL` for a wallet-only account |
| `password_hash` | `TEXT` | Argon2id PHC string; `NULL` until a password is set |
| `email_verified_at` | `TIMESTAMPTZ` | `NULL` until the passcode is verified; login is refused while it is |
| `password_changed_at` | `TIMESTAMPTZ` | `NULL` until the first password reset; tokens issued before it are rejected |
| `status` | `TEXT` | `Active` \| `Suspended` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | bookkeeping |

`auth_users` — manually populated allow-list of wallet credentials, keyed by
`(chain_id, address)`, each pointing at an account via `account_id`:

| Column | Type | Notes |
|--------|------|-------|
| `chain_id` | `BIGINT` | part of the primary key |
| `address` | `TEXT` | part of the primary key; EVM lowercased `0x…`, Stellar `G…` Strkey verbatim |
| `roles` | `TEXT[]` | granted roles, copied into the JWT `roles` claim |
| `nonce` | `TEXT` | current outstanding challenge GUID; `NULL` until first challenge and after each successful verify |
| `account_id` | `UUID` | the account this wallet credential belongs to |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | bookkeeping |

Rows are inserted manually (there is no admin endpoint). Address normalization
must follow the convention above so lookups match.

`lps.owner_account_id` is the LP-ownership key and is **UNIQUE** — one account
owns at most one LP, which is why the LP-facing routes are keyed on the session:
`POST /v1/lps/me` upserts the caller's own record. `owner_chain_id`/`owner_address`
are history only, `NULL` for email registrations, and read by nothing (TD-82).

## Loan submission

Originators submit loan applications that trustees review before a loan is drawn
on-chain. Lifecycle, target chain, payload and the `submitted_loans` table are in
[api-authorization-loan-submission.md](./api-authorization-loan-submission.md).

## Security

- **Allow-list only.** No self-service registration; an address must be inserted
  manually to authenticate.
- **Single-use nonce.** The nonce is cleared on successful verify, so a captured
  signature cannot be replayed; a new challenge is required per login.
- **Asymmetric signing.** Tokens are signed with an ES256 private key held only
  by the API; the public key verifies them, allowing other services to validate
  tokens without the signing secret.
- **Optional at boot.** When the JWT keys (`JWT_ES256_PRIVATE_KEY_PEM` /
  `JWT_ES256_PUBLIC_KEY_PEM`) are unset, the auth endpoints are unavailable and
  every protected endpoint rejects with `401`; the rest of the API is unaffected.
- **Short lifetime.** Tokens expire 24h after issuance with no refresh or revocation
  list: a *role* change waits for login; *suspension* and *reset* bite immediately (TD-80).
