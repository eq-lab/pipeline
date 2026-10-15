-- Migration: password reset by emailed link, and session cut-off on reset.
-- Spec: docs/product-specs/api-authorization-password-reset.md.

ALTER TABLE accounts ADD COLUMN password_changed_at TIMESTAMPTZ;

ALTER TABLE otp_codes DROP CONSTRAINT otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check
    CHECK (purpose IN ('EmailVerification', 'PasswordReset'));

CREATE UNIQUE INDEX idx_otp_codes_password_reset_hash
    ON otp_codes (code_hash) WHERE purpose = 'PasswordReset';

ALTER TABLE login_attempts DROP CONSTRAINT login_attempts_scope_check;
ALTER TABLE login_attempts ADD CONSTRAINT login_attempts_scope_check
    CHECK (scope IN ('email', 'ip', 'password_reset_ip'));
