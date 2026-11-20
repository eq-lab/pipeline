-- spec: docs/references/access-manager-events.md#table
CREATE TABLE IF NOT EXISTS access_manager_operations (
    id                BIGSERIAL   PRIMARY KEY,
    chain_id          BIGINT      NOT NULL,
    contract_address  TEXT        NOT NULL,
    operation_id      TEXT        NOT NULL,
    nonce             BIGINT      NOT NULL,
    caller            TEXT        NOT NULL,
    target            TEXT        NOT NULL,
    function          TEXT        NOT NULL,
    args_xdr          TEXT        NULL,
    args_json         JSONB       NULL,
    ready_at          BIGINT      NOT NULL,
    expires_at        BIGINT      NOT NULL,
    status            TEXT        NOT NULL CHECK (status IN ('pending','executed','canceled')),
    loan_id           BIGINT      NULL,
    record_id         BIGINT      NULL,
    schedule_tx_hash  TEXT        NOT NULL,
    schedule_ledger   BIGINT      NOT NULL,
    scheduled_at      BIGINT      NOT NULL,
    source_log_id     BIGINT      NOT NULL,
    closed_tx_hash    TEXT        NULL,
    closed_ledger     BIGINT      NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chain_id, contract_address, operation_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_am_ops_pending_loan
    ON access_manager_operations (chain_id, loan_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_am_ops_pending_call
    ON access_manager_operations (chain_id, contract_address, target, function, caller)
    WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS access_manager_sync_state (
    chain_id          BIGINT      NOT NULL,
    contract_address  TEXT        NOT NULL,
    last_log_id       BIGINT      NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, contract_address)
);
