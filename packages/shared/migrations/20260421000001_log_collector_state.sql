CREATE TABLE log_collector_state (
    chain_id           BIGINT PRIMARY KEY,
    last_indexed_block BIGINT NOT NULL DEFAULT 0,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
