-- Indexer: cursor state per chain
CREATE TABLE log_collector_state (
    chain_id           BIGINT PRIMARY KEY,
    last_indexed_block BIGINT NOT NULL DEFAULT 0,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexer: unified event log (transfers, withdrawal queue events, etc.)
CREATE TABLE contract_logs (
    id               BIGSERIAL    PRIMARY KEY,
    chain_id         BIGINT       NOT NULL,
    contract_address TEXT         NOT NULL,
    event_name       TEXT         NOT NULL,
    block_number     BIGINT       NOT NULL,
    tx_hash          TEXT         NOT NULL,
    log_index        INT          NOT NULL,
    block_timestamp  BIGINT       NOT NULL,
    indexed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    sender           TEXT,
    receiver         TEXT,
    amount           NUMERIC,
    request_id       NUMERIC,
    cumulative       NUMERIC,
    UNIQUE (chain_id, contract_address, block_number, log_index)
);

CREATE INDEX idx_contract_logs_event ON contract_logs (event_name);

-- KYC: LP profiles
CREATE TABLE lp_profiles (
    wallet_address      TEXT        PRIMARY KEY,
    sumsub_applicant_id TEXT,
    kyc_status          SMALLINT    NOT NULL DEFAULT 1,  -- 1=Red, 2=Green, 3=Yellow
    kyc_review_status   SMALLINT    NOT NULL DEFAULT 3,  -- 1=Pending, 2=Completed, 3=Init, 4=OnHold
    aml_status          SMALLINT    NOT NULL DEFAULT 1,  -- 1=Pending, 2=Clear, 3=Hit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- KYC: outbox for async processing
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
