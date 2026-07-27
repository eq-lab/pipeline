-- Migration: ramp_reviews — Trustee approve/reject decision for on-ramp AND
-- off-ramp asset transfers.
--
-- Backs `POST /v1/ramp/events/{id}/review` and `GET /v1/ramp/events` (#936). Every
-- ramp-boundary `AssetTransfer` (ramp -> custody on-ramp, or custody -> ramp
-- off-ramp; both indexed per #789) must be reviewed by a Trustee — Approved or
-- Rejected — before `capital_allocation`'s `in_transit` bucket counts it on either
-- leg; only an `Approved` decision counts, in either direction.
--
-- Mirrors `submitted_loans`' review shape (loan-book submissions review): a
-- rejection must carry a `reason`, an approval must not — enforced by the same
-- style of CHECK constraint.
--
-- Keyed directly by `contract_logs.id` (per the Issue's ask) rather than a surrogate
-- id: a row's mere existence means "reviewed" (either decision) — there is no
-- pre-populated pending row. Reviewing the same event twice hits the primary-key
-- constraint, which the API maps to `409 Conflict`.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE ramp_reviews;

CREATE TABLE ramp_reviews (
    contract_log_id BIGINT      NOT NULL PRIMARY KEY REFERENCES contract_logs(id),
    decision        TEXT        NOT NULL CHECK (decision IN ('Approved', 'Rejected')),
    reason          TEXT,
    reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by     TEXT        NOT NULL,

    -- A rejected event must carry a reason; an approved one must not.
    CONSTRAINT ramp_reviews_reason_ck CHECK (
        (decision = 'Rejected' AND reason IS NOT NULL) OR
        (decision = 'Approved' AND reason IS NULL)
    )
);
