-- Migration: lps, kyb_documents — custom KYB (business-entity verification) service.
--
-- Introduces the KYB data model as a standalone system: `lps` are business
-- entities identified by internal id, not by wallet — `stellar_address` is
-- nullable and only ever set once `kyb_status` reaches 'Passed' (enforced by
-- `lps_stellar_address_passed_ck`). This is deliberately separate from the
-- existing wallet-keyed `lp_profiles`/`kyc_outbox` (individual KYC via Sumsub);
-- the two systems do not reference each other.
--
-- `owner_chain_id` / `owner_address` record which `auth_users` entry registered
-- the LP (the FK requires the owner to already be on the allow-list). The
-- LP-facing writes (`POST /v1/lps/{id}/documents`, `POST /v1/lps/{id}/link-address`)
-- authorize by matching the caller's JWT `(chain_id, sub)` against this pair — a
-- registered user acts on their own LP only. This is a separate identity from
-- `stellar_address`: `owner_address` is the login/management identity from day
-- one, `stellar_address` is the settlement identity tied once KYB passes; they
-- may differ.
--
-- `kyb_documents` is versioned: a resubmission after rejection inserts a new
-- row rather than overwriting the old one, so review history stays queryable.
-- `idx_kyb_documents_current` enforces exactly one current row per
-- (lp_id, doc_type, subject); callers flip the prior row's `is_current` to
-- false and insert the replacement in the same transaction.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE kyb_documents;
--   DROP TABLE lps;

CREATE TABLE lps (
    id                BIGSERIAL   PRIMARY KEY,
    legal_name        TEXT        NOT NULL,
    country           TEXT,
    contact_email     TEXT        NOT NULL,
    stellar_address   TEXT        UNIQUE,
    address_linked_at TIMESTAMPTZ,
    kyb_status        TEXT        NOT NULL DEFAULT 'NotStarted'
                          CHECK (kyb_status IN ('NotStarted', 'InProgress', 'UnderReview', 'Passed', 'Failed')),
    owner_chain_id    BIGINT      NOT NULL,
    owner_address     TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT lps_stellar_address_passed_ck CHECK (stellar_address IS NULL OR kyb_status = 'Passed'),
    CONSTRAINT lps_owner_fk FOREIGN KEY (owner_chain_id, owner_address) REFERENCES auth_users (chain_id, address)
);

CREATE INDEX idx_lps_kyb_status ON lps (kyb_status);
CREATE INDEX idx_lps_owner ON lps (owner_chain_id, owner_address);

CREATE TABLE kyb_documents (
    id            BIGSERIAL   PRIMARY KEY,
    lp_id         BIGINT      NOT NULL REFERENCES lps(id),
    doc_type      TEXT        NOT NULL
                      CHECK (doc_type IN ('CertificateOfIncorporation', 'RegistryRecord', 'GoodStanding',
                                           'LegalAddress', 'ShareholderRegister', 'UboId', 'UboProofOfAddress')),
    subject       TEXT,
    file_ref      TEXT        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'Provided'
                      CHECK (status IN ('NotProvided', 'Provided', 'Verified', 'Rejected')),
    reject_reason TEXT,
    reviewed_by   TEXT,
    reviewed_at   TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_current    BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_kyb_documents_lp_id ON kyb_documents (lp_id);

CREATE UNIQUE INDEX idx_kyb_documents_current
    ON kyb_documents (lp_id, doc_type, COALESCE(subject, ''))
    WHERE is_current;

CREATE INDEX idx_kyb_documents_pending_review
    ON kyb_documents (created_at)
    WHERE status = 'Provided' AND is_current;
