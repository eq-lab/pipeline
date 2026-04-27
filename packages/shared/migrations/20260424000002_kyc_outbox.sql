-- 20260424000002_kyc_outbox.sql
CREATE TABLE kyc_outbox (
    id              BIGSERIAL   PRIMARY KEY,
    wallet_address  TEXT        NOT NULL,
    review_status   SMALLINT    NOT NULL,
    kyc_status      SMALLINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ,
    error           TEXT
);

CREATE INDEX idx_kyc_outbox_unprocessed
    ON kyc_outbox (created_at)
    WHERE processed_at IS NULL;
