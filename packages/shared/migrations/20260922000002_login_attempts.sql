-- Migration: login_attempts — failed-sign-in throttle for POST /v1/auth/login.
--
-- See docs/product-specs/api-authorization-email.md.
--
-- `login` carries no captcha (a challenge on every sign-in is friction on real
-- customers, not attackers), so this is its only bound. Counted per submitted
-- address AND per client address, independently: a per-address counter alone
-- does nothing against credential stuffing, which walks many addresses from one
-- client, and a per-client counter alone does nothing against a distributed
-- attack on one address.
--
-- Deliberately a table rather than an in-process limiter. An in-memory counter
-- is per-replica, so with N replicas the real limit is N×3 and nobody can tell
-- by reading the code. Counting here is exact however many replicas run.
--
-- The counter is bumped on EVERY attempt and cleared on success, so a caller who
-- signs in correctly never accumulates; only failures stack up.
--
-- Rows are keyed, not appended, so the table stays one row per active key —
-- but stale keys are never collected. See TD-86.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE login_attempts;

CREATE TABLE login_attempts (
    scope        TEXT        NOT NULL CHECK (scope IN ('email', 'ip')),
    key          TEXT        NOT NULL,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts     INTEGER     NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, key)
);

CREATE INDEX idx_login_attempts_window ON login_attempts (window_start);
