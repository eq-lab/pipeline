-- Migration: Stellar SecurityRegistry projection tables and view snapshots (#1779).
-- Spec: docs/references/security-registry-events.md#projection-tables.
--
-- Rollback:
-- DROP TABLE security_loan_valuations, security_extension_consents, security_lots,
--   security_inspections, security_margin_call_events, security_record_docs,
--   security_records, security_terms, security_registry_state, security_view_snapshots;

CREATE TABLE IF NOT EXISTS security_view_snapshots (
    chain_id         BIGINT      NOT NULL,
    contract_address TEXT        NOT NULL,
    kind             TEXT        NOT NULL CHECK (kind IN ('record','inspection','loan','contract')),
    entity_id        BIGINT      NOT NULL,
    loan_id          BIGINT      NULL,
    as_of_ledger     BIGINT      NOT NULL,
    payload          JSONB       NOT NULL,
    fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, contract_address, kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_security_view_snapshots_loan
    ON security_view_snapshots (chain_id, contract_address, loan_id);

CREATE TABLE IF NOT EXISTS security_registry_state (
    chain_id               BIGINT      NOT NULL,
    contract_address       TEXT        NOT NULL,
    paused                 BOOLEAN     NULL,
    inspectors             JSONB       NULL,
    loan_registry          TEXT        NULL,
    projection_version     INT         NOT NULL DEFAULT 0,
    projected_log_id       BIGINT      NOT NULL DEFAULT 0,
    projected_snapshot_at  TIMESTAMPTZ NULL,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, contract_address)
);

CREATE TABLE IF NOT EXISTS security_terms (
    chain_id               BIGINT      NOT NULL,
    contract_address       TEXT        NOT NULL,
    loan_id                BIGINT      NOT NULL,
    advance_ratio_bps      BIGINT      NOT NULL,
    margin_call_ratio_bps  BIGINT      NOT NULL,
    cure_period            NUMERIC     NOT NULL,
    price_stale_after      NUMERIC     NOT NULL,
    payment_term           TEXT        NOT NULL,
    grace_period           NUMERIC     NOT NULL,
    default_rate           BIGINT      NOT NULL,
    attestation_interval   NUMERIC     NOT NULL,
    inspection_interval    NUMERIC     NOT NULL,
    tolerance_bps          BIGINT      NOT NULL,
    grade_tolerance_bps    BIGINT      NOT NULL,
    margin_call_at         NUMERIC     NOT NULL,
    set_ledger             BIGINT      NULL,
    complete               BOOLEAN     NOT NULL,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, contract_address, loan_id)
);

CREATE TABLE IF NOT EXISTS security_records (
    chain_id               BIGINT      NOT NULL,
    contract_address       TEXT        NOT NULL,
    record_id              BIGINT      NOT NULL,
    loan_id                BIGINT      NOT NULL,
    lot_id                 BIGINT      NOT NULL,
    protection             TEXT        NOT NULL,
    commodity              TEXT        NULL,
    unit                   TEXT        NULL,
    reference_quantity     NUMERIC     NULL,
    reference_grade        NUMERIC     NULL,
    region                 TEXT        NULL,
    site_hash              TEXT        NULL,
    control_kind           TEXT        NULL,
    control_reference      TEXT        NULL,
    perfection             TEXT        NULL,
    release_condition      TEXT        NULL,
    status                 TEXT        NOT NULL,
    perfected_at           NUMERIC     NULL,
    attested_by            TEXT        NULL,
    attested_at            NUMERIC     NULL,
    flagged_by             BIGINT      NULL,
    mark_value_per_unit    NUMERIC     NULL,
    mark_at                NUMERIC     NULL,
    mark_benchmark         TEXT        NULL,
    mark_report_hash       TEXT        NULL,
    registered_ledger      BIGINT      NULL,
    closed_ledger          BIGINT      NULL,
    release_reason_hash    TEXT        NULL,
    released_by_consent    BOOLEAN     NULL,
    complete               BOOLEAN     NOT NULL,
    needs_view             BOOLEAN     NOT NULL,
    view_ledger            BIGINT      NULL,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, contract_address, record_id)
);

CREATE INDEX IF NOT EXISTS idx_security_records_loan
    ON security_records (chain_id, contract_address, loan_id);

CREATE TABLE IF NOT EXISTS security_record_docs (
    chain_id         BIGINT NOT NULL,
    contract_address TEXT   NOT NULL,
    record_id        BIGINT NOT NULL,
    position         INT    NOT NULL,
    loan_id          BIGINT NOT NULL,
    kind             TEXT   NOT NULL,
    sha256           TEXT   NOT NULL,
    source           TEXT   NOT NULL,
    ledger           BIGINT NULL,
    PRIMARY KEY (chain_id, contract_address, record_id, position)
);

CREATE INDEX IF NOT EXISTS idx_security_record_docs_loan
    ON security_record_docs (chain_id, contract_address, loan_id);

CREATE TABLE IF NOT EXISTS security_margin_call_events (
    chain_id              BIGINT  NOT NULL,
    contract_address      TEXT    NOT NULL,
    block_number          BIGINT  NOT NULL,
    log_index             INT     NOT NULL,
    loan_id               BIGINT  NOT NULL,
    kind                  TEXT    NOT NULL,
    ltv_bps               BIGINT  NOT NULL,
    margin_call_ratio_bps BIGINT  NULL,
    cure_by               NUMERIC NULL,
    block_timestamp       BIGINT  NOT NULL,
    tx_hash               TEXT    NOT NULL,
    PRIMARY KEY (chain_id, contract_address, block_number, log_index)
);

CREATE INDEX IF NOT EXISTS idx_security_margin_call_events_loan
    ON security_margin_call_events (chain_id, contract_address, loan_id);

CREATE TABLE IF NOT EXISTS security_inspections (
    chain_id               BIGINT      NOT NULL,
    contract_address       TEXT        NOT NULL,
    inspection_id          BIGINT      NOT NULL,
    loan_id                BIGINT      NOT NULL,
    record_id              BIGINT      NOT NULL,
    lot_id                 BIGINT      NOT NULL,
    inspector              TEXT        NOT NULL,
    kind                   TEXT        NOT NULL,
    inspected_at           NUMERIC     NULL,
    region                 TEXT        NULL,
    site_hash              TEXT        NULL,
    quantity               NUMERIC     NULL,
    grade                  NUMERIC     NULL,
    certificate_hash       TEXT        NULL,
    certificate_no         TEXT        NULL,
    entered_by             TEXT        NULL,
    entered_at             NUMERIC     NULL,
    approved_by            TEXT        NULL,
    approved_at            NUMERIC     NULL,
    variance_reference_bps INT         NULL,
    variance_previous_bps  INT         NULL,
    variance_grade_bps     INT         NULL,
    flagged                BOOLEAN     NULL,
    resolution             TEXT        NULL,
    resolution_reason_hash TEXT        NULL,
    resolved_at            NUMERIC     NULL,
    recorded_ledger        BIGINT      NULL,
    approved_ledger        BIGINT      NULL,
    complete               BOOLEAN     NOT NULL,
    needs_view             BOOLEAN     NOT NULL,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, contract_address, inspection_id)
);

CREATE INDEX IF NOT EXISTS idx_security_inspections_loan
    ON security_inspections (chain_id, contract_address, loan_id);

CREATE TABLE IF NOT EXISTS security_lots (
    chain_id              BIGINT  NOT NULL,
    contract_address      TEXT    NOT NULL,
    lot_id                BIGINT  NOT NULL,
    loan_id               BIGINT  NOT NULL,
    latest_inspection_id  BIGINT  NULL,
    latest_inspected_at   NUMERIC NULL,
    latest_quantity       NUMERIC NULL,
    complete              BOOLEAN NOT NULL,
    PRIMARY KEY (chain_id, contract_address, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_security_lots_loan
    ON security_lots (chain_id, contract_address, loan_id);

CREATE TABLE IF NOT EXISTS security_extension_consents (
    chain_id         BIGINT  NOT NULL,
    contract_address TEXT    NOT NULL,
    loan_id          BIGINT  NOT NULL,
    position         INT     NOT NULL,
    consent_hash     TEXT    NOT NULL,
    new_maturity     NUMERIC NULL,
    ledger           BIGINT  NULL,
    block_timestamp  BIGINT  NULL,
    PRIMARY KEY (chain_id, contract_address, loan_id, position)
);

CREATE TABLE IF NOT EXISTS security_loan_valuations (
    chain_id          BIGINT      NOT NULL,
    contract_address  TEXT        NOT NULL,
    loan_id           BIGINT      NOT NULL,
    value             NUMERIC     NOT NULL,
    stale_value       NUMERIC     NOT NULL,
    flagged_value     NUMERIC     NOT NULL,
    debt              NUMERIC     NOT NULL,
    coverage_bps      BIGINT      NOT NULL,
    ltv_bps           BIGINT      NOT NULL,
    margin_call_at    NUMERIC     NOT NULL,
    cure_by           NUMERIC     NOT NULL,
    price_stale       BOOLEAN     NOT NULL,
    counted_records   JSONB       NOT NULL,
    detail_ledger     BIGINT      NOT NULL,
    loan_registry     TEXT        NOT NULL,
    outstanding       NUMERIC     NOT NULL,
    accrued_interest  NUMERIC     NOT NULL,
    money_ledger      BIGINT      NOT NULL,
    source_log_id     BIGINT      NOT NULL,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, contract_address, loan_id)
);
