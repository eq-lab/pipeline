# API Authorization

## Overview

The Pipeline API authorizes callers with a short-lived **JWT**. A caller proves
who they are with one of two credentials: a **wallet signature** over a
server-issued challenge, from an address on the manually-curated `auth_users`
allow-list (this spec); or **email and password**, LP self-serve and open to
anyone (see [api-authorization-email.md](./api-authorization-email.md)). The
wallet flow supports **EVM** chains (EIP-191 `personal_sign`, secp256k1) and
**Stellar** chains (SEP-0053, ed25519), resolved from `chain_id` and defaulting
to the server's `DEFAULT_CHAIN_ID`.

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
4. **Authorize.** The client sends the token as `Authorization: Bearer <jwt>` to
   protected endpoints. The token is validated (signature + expiry) on each
   request and its claims (address, chain, roles) are made available to the
   handler. An endpoint may additionally require a specific **role**: a valid
   token whose `roles` lack the required role is rejected with `403 Forbidden`.

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
| `GET`  | `/v1/auth/challenge?chain_id&address` | none | Returns `{ message, nonce }` for an allow-listed address; rotates the stored nonce. `401` if the address is not authorized. |
| `POST` | `/v1/auth/verify` | none | Body `{ chain_id?, address, signature }` (`signature`: hex for EVM, base64 or hex for Stellar). Returns `{ token, expires_in }` on a valid signature. `401` for unknown address, no outstanding challenge, or bad signature. |
| `POST` | `/v1/auth/signup` | none | Body `{ email, password, captcha_token }`. **Always `202`** — see [api-authorization-email.md](./api-authorization-email.md). `400` on a malformed address or a password failing the policy, `403` if the captcha is rejected, `503` if the captcha provider is unreachable. |
| `POST` | `/v1/auth/verify-otp` | none | Body `{ email, code }`. Returns `{ token, expires_in }`. `401` for every failure mode, with one shared message. |
| `POST` | `/v1/auth/resend-otp` | none | Body `{ email, captcha_token }`. Always `202` — inside the 60-second cooldown the send is skipped silently. `403`/`503` per the captcha. |
| `POST` | `/v1/auth/login` | none | Body `{ email, password }`. Returns `{ token, expires_in }`. `401` for an unknown address or a wrong password (indistinguishable, in body and in timing), `403 email_not_verified` for an unverified account, `403` for a suspended one, `429` past the attempt limit. |
| `POST` | `/v1/loan-book/loan` | bearer + `originator` role | Submit a loan application (all `draw_loan` inputs; see [Loan submission](#loan-submission)). Validated against the on-chain `draw_loan` invariants, then persisted as `InReview`. `201 { id }` on success, `400` on validation failure, `401` without a valid token, `403` without the `originator` role. |
| `GET`  | `/v1/loan-book/submissions?status` | bearer + `trustee` role | List submissions, newest first. Optional `status` filter (`InReview`/`Approved`/`Rejected`/`ChangesRequested`); omit for all. `400` on an unknown status value. |
| `POST` | `/v1/loan-book/submissions/{id}/review` | bearer + `trustee` role | Apply a trustee decision. Body `{ decision: "Approved"｜"Rejected"｜"ChangesRequested", reason? }`; a rejection or a changes-requested decision requires a non-empty `reason`, an approval must omit it. `200` on success, `400` on a malformed decision, `404` if the id is unknown, `409` if the submission is already `Approved`/`Rejected` (terminal). |
| `POST` | `/v1/loan-book/submissions/{id}/resubmit` | bearer + `originator` role | Resubmit a `ChangesRequested` submission with a corrected payload (same body as `/v1/loan-book/loan`), reopening it for review. Full replace: overwrites `loan_data` plus the valuation anchor and fee schedule, resets `status` to `InReview`, and clears `reason`. `200 { id }` on success, `400` on validation failure, `401` without a valid token, `403` without the `originator` role, `404` if the id is unknown, `409` if the submission is not in `ChangesRequested` or the new `metadata_uri` collides with another undrawn submission. |

Tokens are **ES256** (P-256) signed, expire **24 hours** after issuance
(`expires_in = 86400`), and carry `sub`, `chain_id`, `account_id`, `roles`,
`iat`, `exp`. A wallet token's `sub` is the normalized address and `chain_id`
the chain, exactly as before — `account_id` is purely additive, so existing
clients are unaffected. An email token's `sub` is the account id and its
`chain_id` is `null`.

Tokens cannot be revoked — no refresh token, no session table, no logout. A
password reset does not end a live session, and suspending an account takes up
to 24 hours to bite. See TD-80. Because `account_id` is required rather than
optional, tokens issued before it existed fail to decode: deploying the accounts
migration signs every active session out, and each user signs in again once.

To protect a new endpoint, take the `AuthClaims` extractor as a handler
argument; a request without a valid token is rejected with `401` before the
handler body runs. To additionally require a role, check `claims.has_role("…")`
and return `403 Forbidden` when it is absent (see `routes::loan_book::submit_loan`).

## Data Model

`accounts` — the principal, keyed by a uuid:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` | primary key; the `account_id` JWT claim |
| `email` | `TEXT` | unique, lowercase (enforced by check constraint); `NULL` for a wallet-only account |
| `password_hash` | `TEXT` | Argon2id PHC string; `NULL` until a password is set |
| `email_verified_at` | `TIMESTAMPTZ` | `NULL` until the passcode is verified; login is refused while it is |
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
owns at most one LP, which is what keeps self-serve signup from making
`POST /v1/lps` unbounded. `owner_chain_id`/`owner_address` are history only,
`NULL` for email registrations, and read by nothing (TD-82).

## Loan submission

Originators submit loan applications that trustees review before a loan is drawn
on-chain. The flow is intentionally two-staged: submission only **persists and
validates** the application; calling `draw_loan` on an approved submission is a
separate, later step (not yet wired).

**Lifecycle.** A submission is `InReview` on insert. `Approved` and `Rejected`
are terminal — no further review is accepted once either is reached.
`ChangesRequested` is **non-final**: a submission left `ChangesRequested` can be
reviewed again, moving to `Approved`, `Rejected`, or another round of
`ChangesRequested`.

```
InReview ──────────approve──────────▶ Approved (terminal)
         ──────────reject───────────▶ Rejected (terminal, carries a reason)
         ──request changes──▶ ChangesRequested (carries a reason) ─┐
              ▲                                                    │
              └───────────── request changes again ────────────────┘
ChangesRequested ──approve─────────▶ Approved (terminal)
                 ──reject──────────▶ Rejected (terminal, carries a reason)
                 ──resubmit────────▶ InReview (originator replaces the payload)
```

Only `InReview` or `ChangesRequested` submissions can be reviewed; reviewing a
submission already `Approved`/`Rejected` returns `409 Conflict`. Each new review
decision overwrites the single `reason` column — there is no history of prior
`ChangesRequested` feedback text.

**Resubmission.** When a trustee requests changes, the originator acts on the
feedback via `POST /v1/loan-book/submissions/{id}/resubmit` — the counterpart to
the trustee's review action. It carries the full submission payload (same shape as
`POST /v1/loan-book/loan`), re-runs the same validation, and does a full replace of
`loan_data`, the valuation anchor, and the fee schedule, then resets the submission
to `InReview` (clearing `reason`) for another review round. Only `ChangesRequested`
submissions may be resubmitted: `InReview` is already open, and the terminal
`Approved`/`Rejected` states return `409 Conflict`. There is no partial edit — a
resubmission is a complete new payload.

**Payload.** `POST /v1/loan-book/loan` carries every input to the on-chain
`draw_loan`: the holder `to`, the on-chain `metadata_uri`, the off-chain metadata
document fields (`originator`, `borrower_id`, `commodity`, `corridor`,
`governing_law`, `protection`, optional `secondary_metadata_uri`, and
`documents` — an array of `{ name, uri }` links such as the Agreement,
License, and Terms & Conditions), the
`economics` block (`ImmutableLoanData` — base-6 USDC amount strings, bps rate,
origination/maturity timestamps), `initial_ccr`, and `initial_location`
(`LocationUpdate`). The whole payload is stored verbatim as JSONB. Submission
validation mirrors the contract invariants: tranches sum to the facility size,
maturity is after origination, offtaker price covers the facility, `initial_ccr`
is at least `1_000_000` (100 %), and `location_type` is one of
`Vessel`/`Warehouse`/`TankFarm`/`Other`.

`submitted_loans` — one row per application:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `BIGINT` (identity) | surrogate PK — the submission id used by the review endpoint. **Not** the on-chain `loan_id`, which does not exist until the loan is drawn |
| `loan_data` | `JSONB` | the full submitted payload, verbatim |
| `status` | `TEXT` | `InReview` \| `Approved` \| `Rejected` \| `ChangesRequested` (CHECK-constrained) |
| `reason` | `TEXT` | rejection/feedback reason; present **iff** `status IN (Rejected, ChangesRequested)` (CHECK-enforced) |
| `originator` | `TEXT` | the submitter's authenticated address (JWT `sub`) |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | bookkeeping |

The `originator` / `trustee` roles are granted via `auth_users.roles` (seeded
manually like any other role).

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
- **Short lifetime.** Tokens expire after 24 hours; there is no refresh or
  revocation list, so privilege changes take effect on the next login.
