CREATE TABLE token_transfers (
    id               BIGSERIAL PRIMARY KEY,
    chain_id         BIGINT NOT NULL,
    contract_address TEXT   NOT NULL,
    sender           TEXT   NOT NULL,
    receiver         TEXT   NOT NULL,
    amount           NUMERIC NOT NULL,
    block_number     BIGINT NOT NULL,
    tx_hash          TEXT   NOT NULL,
    log_index        INT    NOT NULL,
    block_timestamp  TIMESTAMPTZ NOT NULL,
    indexed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chain_id, contract_address, block_number, log_index)
);
