# Issue #708: JWT authorization: signature-based login + protected endpoints

Source: https://github.com/eq-lab/pipeline/issues/708

## Scope

Add wallet-signature → JWT authentication to the HTTP API (`packages/api`, Axum 0.8)
and a reusable mechanism to gate endpoints behind a valid JWT.

In scope:

1. A manually-populated allow-list table (`auth_users`) keyed by `(chain_id, address)`
   carrying `roles text[]` and the current challenge `nonce`.
2. `AuthUserRepo` in `packages/shared` (FromRow + lookup / nonce-rotate / clear-nonce queries).
3. **Endpoint 1 — challenge:** `GET /v1/auth/challenge?chain_id&address` — rejects unknown
   addresses, generates a fresh GUID nonce, persists it (overwriting the prior one), returns
   the exact message to sign (Pipeline welcome message + nonce).
4. **Endpoint 2 — verify:** `POST /v1/auth/verify` `{chain_id, address, signature}` —
   reconstructs the challenge from the **DB-stored** nonce, verifies the signature against
   the claimed address (EVM secp256k1/EIP-191 or Stellar ed25519, dispatched on `chain_id`),
   clears the nonce (single-use), and returns a signed JWT (`exp` = 24h, `roles` from DB).
5. JWT signing/verification keys loaded from config into `AppState`; asymmetric algorithm.
6. An `AuthClaims` Axum extractor (`FromRequestParts`) that validates `Authorization: Bearer`,
   exposing `{ address, chain_id, roles }` to handlers and returning `401` on failure.
7. **`POST /v1/loan-book/loan`** — protected endpoint gated on the `originator` role
   (authenticated + role check). Payload shape and persistence are TBD; an authorized caller
   currently receives `501 Not Implemented`. Serves as the reference for protecting endpoints
   and for role-based gating (`403` when the role is absent).

Out of scope (note for follow-ups):

- Admin endpoints to manage `auth_users` rows (rows are inserted manually via SQL).
- A JWKS / public-key discovery endpoint for other services (track separately if needed).
- Per-role authorization *policies* (this issue gates on "valid JWT"; role-gating helpers
  are provided but `/test-authorized` requires only authentication).
- Token refresh / revocation lists.

## Assumptions and Risks

- **Decisions locked in issue comment:** EVM + Stellar from the start; asymmetric JWT
  (RS256/ES256); `roles` as `text[]`.
- **Stellar signature verification is new.** `shared::stellar_voucher` only *signs*; there is
  no generic "verify an ed25519 signature over an arbitrary message from a `G…` address"
  helper. This must be written following **SEP-0053** (the scheme Freighter's `signMessage`
  uses): the wallet signs `SHA256("Stellar Signed Message:\n" + message)` with ed25519 — a
  **single** SHA-256 over the prefixed payload, then ed25519 over that 32-byte hash (NOT the
  raw message bytes). The verifier must reproduce this exactly. No remaining ambiguity.
- **EVM uses existing `shared::signature::verify_personal_sign`** (EIP-191). No risk.
- **Address normalization.** Lookups must be deterministic. EVM addresses stored/compared
  lowercased (`0x…`); Stellar `G…` strkeys stored verbatim (case-sensitive base32). Normalize
  on both insert-convention (documented) and lookup.
- **Chain kind** is resolved with the existing `shared::chains::parse_chain_type(chain_id)`
  (`ChainKind::Evm | Stellar`); no new chain plumbing required.
- **`jsonwebtoken` + `uuid` are new workspace deps.** Low risk; widely used. `jsonwebtoken` 9
  supports RS256/ES256 via `EncodingKey::from_*_pem` / `DecodingKey::from_*_pem`.
- **Key provisioning.** If the key env vars are unset the API must still boot (auth endpoints
  return 503/`Internal` and protected routes reject) — mirror the Sumsub "configured?" pattern
  rather than panicking at startup, so non-auth deployments are unaffected. (Decision: make
  auth **optional at boot**, consistent with `sumsub` and per-chain signer handling.)
- **`auth_users` is empty on fresh deploys** — migration only creates the table; no seed rows.
  This is intentional (rows added manually). `/test-authorized` is untestable end-to-end until
  a row + key exist, so tests target the pure verification/JWT layers (see Test Strategy).

## Open Questions

_None — all resolved (see Resolved Decisions below)._

## Resolved Decisions

1. **JWT algorithm + key format:** **ES256** (P-256). PEM private/public keys via env
   `JWT_ES256_PRIVATE_KEY_PEM` / `JWT_ES256_PUBLIC_KEY_PEM`
   (`EncodingKey::from_ec_pem` / `DecodingKey::from_ec_pem`, `Algorithm::ES256`).
2. **Welcome-message wording:** Built once by `challenge_message` (byte-identical between
   issuance and verification). **Single line / no newlines** — embedded newlines are escaped
   as `\n` in the JSON `message` field, so a client signing the escaped text instead of the
   decoded value would sign different bytes; a newline-free message removes that footgun:
   ```
   Welcome to Pipeline! Sign this message to authenticate. This request will not trigger a blockchain transaction or cost any gas. Address: <address> Chain ID: <chain_id> Nonce: <nonce>
   ```
3. **Stellar message-signing convention:** **SEP-0053** — the scheme Freighter's `signMessage`
   uses. The signer hashes `SHA256("Stellar Signed Message:\n" + message)` (single round) and
   ed25519-signs that 32-byte hash. `verify_stellar_personal_sign` must reproduce the prefix +
   single SHA-256, then `verifying_key.verify(&hash, &sig)`.
4. **Nonce lifecycle:** **Single-use** — nonce cleared on successful verify; a fresh
   `/challenge` is required per login.

## Implementation Status — ✅ complete

All steps implemented on branch `feat/jwt-authorization`. Checks: doc-lint 0 errors,
`cargo clippy --all -D warnings` clean, `cargo test --all` green (new: 8 signature tests,
4 JWT tests), frontend `tsc --noEmit` clean. Not committed (manager owns commit + labels).

- [x] 1. Deps — `jsonwebtoken`, `uuid` added to workspace + api `Cargo.toml`.
- [x] 2. Migration `20260626000001_auth_users.sql`.
- [x] 3. `AuthUserRepo` (`packages/shared/src/auth_user_repo.rs`) + lib registration.
- [x] 4. `verify_stellar_personal_sign` (SEP-0053) in `packages/shared/src/signature.rs`.
- [x] 5. JWT helpers + `JwtKeys` (`packages/api/src/auth.rs`); added `from_pem` for testability.
- [x] 6. `AppState` wiring (`lib.rs` + `main.rs`).
- [x] 7. `AuthClaims` `FromRequestParts` extractor; `ApiError::Unauthorized` + `Forbidden` added; `Claims::has_role`.
- [x] 8. Auth routes `challenge` + `verify` (`packages/api/src/routes/auth.rs`) + `AuthDoc`.
- [x] 9. Protected endpoint `POST /v1/loan-book/loan` (originator-role-gated, stub) in `routes/loan_book.rs`; shared `SecurityAddon` in `auth.rs` for the Swagger Authorize button.
- [x] 10. Router + OpenAPI registration in `main.rs`.
- [x] 11. `.env.example` JWT key vars.
- [x] 12. Clippy clean.

## Implementation Steps

### 1. Dependencies
- `Cargo.toml` (workspace): add `jsonwebtoken = "9"` and `uuid = { version = "1", features = ["v4"] }`
  to `[workspace.dependencies]`.
- `packages/api/Cargo.toml`: add `jsonwebtoken = { workspace = true }` and
  `uuid = { workspace = true }`. (`alloy`, `ed25519-dalek`, `stellar-strkey`, `chrono`,
  `serde`, `sqlx` already present.)
- `packages/shared/Cargo.toml`: add `uuid = { workspace = true }` (for nonce generation in the
  repo) — or generate the nonce in the API layer and keep the repo dep-free; prefer generating
  in the API handler and passing the nonce string into the repo to avoid widening `shared`.

### 2. Migration — `auth_users` table
New file `packages/shared/migrations/20260626000001_auth_users.sql`:
```sql
CREATE TABLE auth_users (
    chain_id   BIGINT      NOT NULL,
    address    TEXT        NOT NULL,
    roles      TEXT[]      NOT NULL DEFAULT '{}',
    nonce      TEXT,                       -- current challenge GUID; NULL until first challenge
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, address)
);
```
Follow the migration header-comment style used by existing migrations. No seed rows. Document
the address-normalization convention (EVM lowercase `0x…`, Stellar `G…` verbatim) in the header
comment so manual inserts are consistent.

### 3. `AuthUserRepo` — `packages/shared/src/auth_user_repo.rs`
- Register `pub mod auth_user_repo;` in `packages/shared/src/lib.rs`.
- Struct `AuthUserRepo { pool: PgPool }` with `new(pool)`, mirroring `KycRepo`.
- `#[derive(sqlx::FromRow)] struct AuthUser { chain_id: i64, address: String, roles: Vec<String>, nonce: Option<String>, ... }`.
- Methods:
  - `async fn find(&self, chain_id: i64, address: &str) -> Result<Option<AuthUser>, sqlx::Error>`
  - `async fn set_nonce(&self, chain_id: i64, address: &str, nonce: &str) -> Result<(), sqlx::Error>`
    (UPDATE … SET nonce, updated_at = now()).
  - `async fn clear_nonce(&self, chain_id: i64, address: &str) -> Result<(), sqlx::Error>`
    (single-use, called after successful verify).
- Use runtime `sqlx::query_as`/`query` (not the compile-time `query!` macros) to match the
  repo style and avoid an offline-prepare requirement.

### 4. Stellar signature verification (SEP-0053) — `packages/shared/src/signature.rs`
Add alongside `verify_personal_sign`:
```rust
/// Verify a SEP-0053 message signature (Freighter `signMessage`) by the account
/// behind `g_address`.
pub fn verify_stellar_personal_sign(message: &str, signature_hex: &str, g_address: &str) -> Result<()>
```
- Build the SEP-0053 payload: `b"Stellar Signed Message:\n"` ++ `message.as_bytes()`.
- `let hash = Sha256::digest(payload);` (single round — `sha2` is already a dep).
- Parse `g_address` with `stellar_strkey::ed25519::PublicKey::from_string` → `VerifyingKey::from_bytes`.
- Decode 64-byte sig (hex, strip `0x`) → `ed25519_dalek::Signature::from_bytes`.
- `verifying_key.verify(&hash, &sig)?` (uses `ed25519_dalek::Verifier`) — ed25519 verifies over
  the 32-byte hash, matching SEP-0053 / Freighter.
- Tests live in `packages/shared/tests/` per project convention — not inline.

### 5. JWT helpers + key config — `packages/api/src/auth.rs` (new module, `pub mod auth;` in `lib.rs`)
- `struct JwtKeys { encoding: EncodingKey, decoding: DecodingKey, algorithm: Algorithm }`.
- `fn JwtKeys::from_env() -> Result<Option<JwtKeys>>` — read PEM env vars (per Open Q1);
  return `Ok(None)` (with a `tracing::warn!`) when unset so the API still boots, mirroring the
  Sumsub pattern in `main.rs`.
- `#[derive(Serialize, Deserialize)] struct Claims { sub: String /*address*/, chain_id: i64, roles: Vec<String>, exp: usize, iat: usize }`.
- `fn issue_token(keys, address, chain_id, roles) -> Result<String>` — `exp = now + 24h`
  (chrono), `jsonwebtoken::encode`.
- `const TOKEN_TTL_SECS: i64 = 24 * 60 * 60;`

### 6. `AppState` wiring
- `packages/api/src/lib.rs`: add `pub auth_user_repo: shared::auth_user_repo::AuthUserRepo` and
  `pub jwt_keys: Option<crate::auth::JwtKeys>` to `AppState`.
- `packages/api/src/main.rs`: build `AuthUserRepo::new(pool.clone())` and
  `auth::JwtKeys::from_env()?`; add both to the `AppState { … }` initializer.

### 7. `AuthClaims` extractor — in `packages/api/src/auth.rs`
- `pub struct AuthClaims(pub Claims);`
- `impl FromRequestParts<Arc<AppState>> for AuthClaims` (axum 0.8 `async_trait`-free signature):
  - Pull `Authorization: Bearer <token>` from headers; missing/malformed → `401`.
  - `state.jwt_keys` is `None` → `401` ("authorization not configured").
  - `jsonwebtoken::decode::<Claims>` with the configured algorithm + `Validation` (validates
    `exp`); failure → `401`.
  - On success yield `AuthClaims(claims)`.
- Rejection type: return `(StatusCode, Json<{error}>)` or extend `ApiError` with an
  `Unauthorized(String)` variant (`401`) — **add `Unauthorized` to `ApiError`** so auth routes
  and the extractor share one error shape. Update `error.rs` accordingly.

### 8. Auth routes — `packages/api/src/routes/auth.rs` (`pub mod auth;` in `routes/mod.rs`)
- `router()` → `Router::new().route("/auth/challenge", get(challenge)).route("/auth/verify", post(verify))`.
- `challenge(State, Query{chain_id?, address})`:
  - `resolve_chain` for default chain; look up `auth_users` → 401/404 (use `Unauthorized` /
    `BadRequest`) if absent.
  - Generate `uuid::Uuid::new_v4()` → `nonce`; `repo.set_nonce(...)`.
  - Build the message via a shared `fn challenge_message(address, chain_id, nonce) -> String`
    (single source of truth, reused by `verify`); return `{ message, nonce }`.
- `verify(State, Json{chain_id, address, signature})`:
  - Look up user; `Unauthorized` if absent or `nonce IS NULL`.
  - Rebuild message with `challenge_message(address, chain_id, stored_nonce)`.
  - Dispatch on `parse_chain_type(chain_id)`: `Evm → verify_personal_sign`,
    `Stellar → verify_stellar_personal_sign`. Failure → `Unauthorized`.
  - `repo.clear_nonce(...)` (single-use).
  - `jwt_keys` `None` → `Internal`/503; else `issue_token(...)` → `{ token, expires_in: 86400 }`.
- utoipa `#[openapi]` `AuthDoc` bundle + `#[utoipa::path]` on both handlers; merge `AuthDoc`
  into `api_docs` in `main.rs`.

### 9. Protected endpoint — `GET /v1/test-authorized`
- Add to `routes/auth.rs` (or a tiny `routes/protected.rs`): handler takes `AuthClaims(claims)`
  and returns `Json(claims)` (address, chain_id, roles). Document it as the reference pattern.

### 10. Router registration — `packages/api/src/main.rs`
- `.nest("/v1", pipeline_api::routes::auth::router())` (challenge/verify/test-authorized all
  under `/v1`). Merge `AuthDoc` into the OpenAPI bundle.

### 11. Env documentation
- Update `.env.example` with the chosen JWT key vars (per Open Q1) and a one-line comment.

### 12. Lint
- `cargo clippy --all -- -D warnings` must pass (pedantic is on). Run before handing off.

## Test Strategy

All Rust tests in **external files** under `packages/<pkg>/tests/` (project convention — no
inline `#[cfg(test)] mod tests` in `src/`). No test may read `DATABASE_URL`/`POSTGRES_URL` or
hit a real Postgres — pure unit tests only (repo/DB layer is exercised manually, not in CI).

1. `packages/shared/tests/signature_verify.rs`:
   - EVM: round-trip — sign a known message with an `alloy` `PrivateKeySigner` (EIP-191) and
     assert `verify_personal_sign` accepts it; assert wrong-address and tampered-message reject.
   - Stellar (SEP-0053): in the test, compute `SHA256("Stellar Signed Message:\n" + message)`
     and ed25519-sign that hash with a `SigningKey` whose `G…` strkey is derived; assert
     `verify_stellar_personal_sign` accepts. Assert wrong key / tampered message /
     bad-length signature / signature over raw (un-prefixed) message all reject. (Optionally
     add a golden fixture from a real Freighter signature if one is available.)
2. `packages/api/tests/auth_jwt.rs`:
   - `challenge_message` is deterministic and contains address/chain_id/nonce.
   - `issue_token` → `decode` round-trip with a test ES256 (or RS256) keypair generated in the
     test: claims survive (`sub`, `chain_id`, `roles`), `exp ≈ iat + 86400`.
   - Expired token (craft `exp` in the past) is rejected by the extractor's `Validation`.
   - Tampered signature / wrong key is rejected.
   - (Extractor-level: a small helper that runs the decode path on a `HeaderMap` to assert
     missing/malformed `Authorization` → 401, without spinning up a server.)
3. Whole workspace: `cargo clippy --all -- -D warnings` green; existing tests unaffected.

Manual verification (documented in the PR, not automated — needs a seeded row + keys):
insert an `auth_users` row, call `/v1/auth/challenge`, sign with a wallet, call
`/v1/auth/verify`, then call `/v1/test-authorized` with the returned bearer token.

## Docs to Update

- **New product spec** `docs/product-specs/api-authorization.md` describing the
  challenge→sign→verify→JWT flow, the `auth_users` allow-list model, role semantics, token TTL,
  and how to protect an endpoint with `AuthClaims`. Add it to `docs/product-specs/index.md`.
- **`docs/SECURITY.md`** (and/or `docs/product-specs/security.md`): note the new auth surface,
  single-use nonce replay protection, and asymmetric token signing.
- **`.env.example`**: JWT key env vars.
- OpenAPI/Swagger updates are automatic via the utoipa `AuthDoc` merge — no manual doc gen.
