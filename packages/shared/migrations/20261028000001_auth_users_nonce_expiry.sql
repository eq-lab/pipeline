-- Migration: wallet-login challenge expiry.
-- Spec: docs/product-specs/api-authorization.md.

ALTER TABLE auth_users ADD COLUMN nonce_expires_at TIMESTAMPTZ;
