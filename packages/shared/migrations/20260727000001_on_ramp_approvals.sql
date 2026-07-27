-- Migration: on_ramp_approvals — Trustee approval record for on-ramp asset transfers.
--
-- Backs `POST /v1/ramp/on-ramp/{id}/approve` and `GET /v1/ramp/on-ramp` (#936). An
-- on-ramp `AssetTransfer` (ramp -> custody, indexed per #789) must be approved by a
-- Trustee before `capital_allocation`'s `in_transit` bucket counts it against the
-- custody-side total. Off-ramp transfers (custody -> ramp) need no approval and are
-- untouched by this table.
--
-- Keyed directly by `contract_logs.id` (per the Issue's ask) rather than a surrogate
-- id: a row's mere existence means "approved" — there is no pre-populated pending
-- row. Approving the same event twice hits the primary-key constraint, which the API
-- maps to `409 Conflict`.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE on_ramp_approvals;

CREATE TABLE on_ramp_approvals (
    contract_log_id BIGINT      NOT NULL PRIMARY KEY REFERENCES contract_logs(id),
    approved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by     TEXT        NOT NULL
);
