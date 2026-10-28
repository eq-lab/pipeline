-- Migration: wallet-login challenge expiry and wallet-challenge rate-limit scope.
-- Spec: docs/product-specs/api-authorization.md.

ALTER TABLE auth_users ADD COLUMN nonce_expires_at TIMESTAMPTZ;

ALTER TABLE login_attempts DROP CONSTRAINT login_attempts_scope_check;
ALTER TABLE login_attempts ADD CONSTRAINT login_attempts_scope_check
    CHECK (scope IN ('email', 'ip', 'password_reset_ip', 'wallet_challenge_ip'));
