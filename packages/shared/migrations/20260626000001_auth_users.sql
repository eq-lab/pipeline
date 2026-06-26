-- Migration: auth_users — manually-populated allow-list for signature-based JWT login.
--
-- See docs/product-specs/api-authorization.md for the full flow.
--
-- Each row authorizes one (chain_id, address) to authenticate by signing a
-- server-issued challenge. Rows are inserted MANUALLY (there is no admin
-- endpoint). `roles` are copied into the issued JWT's `roles` claim.
--
-- Address normalization convention (callers MUST follow when inserting rows;
-- the API normalizes the same way on lookup):
--   * EVM chains    — lowercase, 0x-prefixed hex (e.g. '0xabc...').
--   * Stellar chains — the G… ed25519 public-key Strkey, verbatim (base32,
--                      case-sensitive — do NOT lowercase).
--
-- `nonce` holds the GUID for the current outstanding challenge. It is rotated
-- on every GET /v1/auth/challenge and cleared after a successful
-- POST /v1/auth/verify (single-use replay protection), so it is NULL until the
-- first challenge is requested and again after each successful login.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE auth_users;

CREATE TABLE auth_users (
    chain_id   BIGINT      NOT NULL,
    address    TEXT        NOT NULL,
    roles      TEXT[]      NOT NULL DEFAULT '{}',
    nonce      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, address)
);
