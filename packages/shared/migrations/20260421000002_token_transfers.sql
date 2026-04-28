DROP TABLE IF EXISTS token_transfers;

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
