# API Authorization

## Overview

The Pipeline API authenticates callers by **wallet signature** and authorizes
them with a short-lived **JWT**. There are no passwords. Only addresses on a
manually-curated allow-list (`auth_users`) may obtain a token, and each token
carries the roles assigned to that address. Protected endpoints require a valid
bearer token.

The flow supports both **EVM** chains (EIP-191 `personal_sign`, secp256k1) and
**Stellar** chains (SEP-0053 message signing, ed25519). The chain is resolved
from `chain_id`; when omitted it defaults to the server's `DEFAULT_CHAIN_ID`.

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
| `POST` | `/v1/loan-book/loan` | bearer + `originator` role | Submit loan data (payload shape TBD). `401` without a valid token, `403` without the `originator` role. Persistence is not yet implemented — an authorized caller currently receives `501`. |

Tokens are **ES256** (P-256) signed, expire **24 hours** after issuance
(`expires_in = 86400`), and contain the claims `sub` (address), `chain_id`,
`roles`, `iat`, and `exp`.

To protect a new endpoint, take the `AuthClaims` extractor as a handler
argument; a request without a valid token is rejected with `401` before the
handler body runs. To additionally require a role, check `claims.has_role("…")`
and return `403 Forbidden` when it is absent (see `routes::loan_book::submit_loan`).

## Data Model

`auth_users` — manually populated allow-list, keyed by `(chain_id, address)`:

| Column | Type | Notes |
|--------|------|-------|
| `chain_id` | `BIGINT` | part of the primary key |
| `address` | `TEXT` | part of the primary key; EVM lowercased `0x…`, Stellar `G…` Strkey verbatim |
| `roles` | `TEXT[]` | granted roles, copied into the JWT `roles` claim |
| `nonce` | `TEXT` | current outstanding challenge GUID; `NULL` until first challenge and after each successful verify |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | bookkeeping |

Rows are inserted manually (there is no admin endpoint). Address normalization
must follow the convention above so lookups match.

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
