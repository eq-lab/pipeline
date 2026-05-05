CREATE TABLE funding_history (
    id          BIGSERIAL   PRIMARY KEY,
    chain_id    BIGINT      NOT NULL,
    amount_usdc NUMERIC     NOT NULL,
    tx_hash     TEXT        NOT NULL,
    funded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_funding_history_funded_at ON funding_history (funded_at);
