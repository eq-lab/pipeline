-- Migration: accounts, otp_codes — email/password identity for LP self-serve signup.
--
-- See docs/product-specs/api-authorization.md.
--
-- Introduces `accounts` as the API's principal. Until now every identity WAS a
-- wallet: `auth_users` is keyed `(chain_id, address)`, the JWT carries that pair,
-- and `lps.owner_chain_id/owner_address` is a foreign key into it. An email
-- signup has neither a chain nor an address, so the principal is lifted out:
--
--   accounts            — the identity (uuid)
--   auth_users          — a WALLET CREDENTIAL of an account (PK unchanged)
--   accounts.email/password_hash — the PASSWORD CREDENTIAL of an account
--
-- One human may hold both: an LP that signs up by email and later links a wallet
-- is one `accounts` row with one `auth_users` row hanging off it. `password_hash`
-- is NULL for a wallet-only account; `email` is NULL for one that never set a
-- password.
--
-- Wallet login is unchanged on the wire — the JWT keeps emitting `sub` = address
-- and `chain_id`, and gains `account_id` alongside. `lps.owner_account_id` is the
-- new authorization key for `lp_owner_guard`; `owner_chain_id`/`owner_address`
-- are retained as historical record and are no longer read for authorization.
--
-- Every pre-existing `auth_users` row is backfilled with its own account so no
-- wallet identity is left without one, and `lps.owner_account_id` is derived from
-- the owner pair it already stores.
--
-- `lps.owner_account_id` is UNIQUE: signup is self-serve from this migration
-- onwards, and an unbounded `POST /v1/lps` would otherwise let one account mint
-- arbitrarily many LP records. One account, one LP.
--
-- DEPLOY NOTE — this migration signs everyone out. The JWT `account_id` claim is
-- required, not optional, so a token minted before this deploy fails to decode
-- and is rejected as invalid. That is deliberate (a token with no account cannot
-- be authorized against `lps.owner_account_id`, and failing closed beats
-- inventing a default), but it means every signed-in trustee and originator
-- re-signs once, and any automation holding a long-lived token must refresh it.
--
-- OPERATIONAL NOTE — seeding a wallet identity now takes two statements, because
-- `auth_users.account_id` is NOT NULL with no default and every wallet must hang
-- off an account. The previously-documented single INSERT will fail:
--
--   WITH a AS (INSERT INTO accounts (id) VALUES (gen_random_uuid()) RETURNING id)
--   INSERT INTO auth_users (chain_id, address, roles, account_id)
--   SELECT 1, '0xabc...', '{trustee}', id FROM a;
--
-- To give an existing person a second credential, reuse their account id rather
-- than creating a new one — that is the whole point of the accounts split.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   ALTER TABLE lps DROP COLUMN owner_account_id;
--   ALTER TABLE auth_users DROP COLUMN account_id;
--   DROP TABLE otp_codes;
--   DROP TABLE accounts;

-- Fail fast, with an actionable message. `lps` previously carried only the
-- non-unique `idx_lps_owner`, and `register_lp` enforced no per-owner limit, so
-- one wallet may legitimately own several LPs in an existing database. Those
-- rows cannot satisfy `lps_owner_account_unique` below, and without this check
-- the deploy aborts hundreds of lines later on "could not create unique index",
-- naming a backfilled uuid that appears nowhere an operator can look it up.
DO $$
DECLARE
    offenders TEXT;
BEGIN
    SELECT string_agg(format('(chain_id=%s, address=%s) owns %s LPs',
                             owner_chain_id, owner_address, n), '; ')
    INTO offenders
    FROM (
        SELECT owner_chain_id, owner_address, count(*) AS n
        FROM lps
        GROUP BY owner_chain_id, owner_address
        HAVING count(*) > 1
    ) dupes;

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot enforce one-LP-per-account: %. Reassign or retire the extra LP rows, then re-run this migration.',
            offenders;
    END IF;
END $$;

CREATE TABLE accounts (
    id                UUID        PRIMARY KEY,
    email             TEXT        UNIQUE,
    password_hash     TEXT,
    email_verified_at TIMESTAMPTZ,
    last_duplicate_notice_at TIMESTAMPTZ,
    status            TEXT        NOT NULL DEFAULT 'Active'
                          CHECK (status IN ('Active', 'Suspended')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT accounts_email_lowercase_ck CHECK (email IS NULL OR email = lower(email)),
    CONSTRAINT accounts_password_needs_email_ck CHECK (password_hash IS NULL OR email IS NOT NULL)
);

CREATE TABLE otp_codes (
    id         BIGSERIAL   PRIMARY KEY,
    account_id UUID        NOT NULL REFERENCES accounts(id),
    code_hash  TEXT        NOT NULL,
    -- The password to install when THIS code is verified. Signup never writes a
    -- password straight onto the account: an unverified account is one nobody
    -- has proved they own, so a second signup for the same address would let a
    -- stranger swap the password and then have the real owner — who still holds
    -- a live code — verify the account into the stranger's hands. Binding the
    -- password to the code means a verification can only ever install the
    -- password submitted alongside that same code.
    pending_password_hash TEXT,
    purpose    TEXT        NOT NULL CHECK (purpose IN ('EmailVerification')),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    attempts   INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Verification reads the newest outstanding code for an account; the resend
-- cooldown reads the newest code's `created_at` regardless of state.
CREATE INDEX idx_otp_codes_account_latest ON otp_codes (account_id, created_at DESC);

ALTER TABLE auth_users ADD COLUMN account_id UUID REFERENCES accounts(id);

-- Backfill: one account per existing wallet identity. `assigned` is referenced
-- twice, so it is materialized once and every row keeps the uuid it was dealt.
-- gen_random_uuid() is core from PG13 on.
WITH assigned AS (
    SELECT chain_id, address, gen_random_uuid() AS account_id
    FROM auth_users
), created AS (
    INSERT INTO accounts (id)
    SELECT account_id FROM assigned
)
UPDATE auth_users AS u
SET account_id = a.account_id
FROM assigned AS a
WHERE u.chain_id = a.chain_id AND u.address = a.address;

ALTER TABLE auth_users ALTER COLUMN account_id SET NOT NULL;

ALTER TABLE lps ADD COLUMN owner_account_id UUID REFERENCES accounts(id);

UPDATE lps
SET owner_account_id = u.account_id
FROM auth_users AS u
WHERE u.chain_id = lps.owner_chain_id AND u.address = lps.owner_address;

ALTER TABLE lps ALTER COLUMN owner_account_id SET NOT NULL;
ALTER TABLE lps ADD CONSTRAINT lps_owner_account_unique UNIQUE (owner_account_id);

-- An account that signed up by email owns no address on any chain, so the
-- original owner pair can no longer be required. It stays for the rows that
-- have it, as history; `lps_owner_fk` is MATCH SIMPLE, so a fully-NULL pair
-- satisfies it.
ALTER TABLE lps ALTER COLUMN owner_chain_id DROP NOT NULL;
ALTER TABLE lps ALTER COLUMN owner_address  DROP NOT NULL;

CREATE INDEX idx_auth_users_account ON auth_users (account_id);
