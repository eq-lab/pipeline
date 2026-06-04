CREATE TABLE yield_mint_outbox (
    chain_id              BIGINT        NOT NULL,
    yield_minter_address  TEXT          NOT NULL,
    loan_id               NUMERIC(78,0) NOT NULL,
    repayment_id          NUMERIC(78,0) NOT NULL,
    status                TEXT          NOT NULL,
    bitgo_tx_request_id   TEXT,
    tx_hash               TEXT,
    submitted_at          TIMESTAMPTZ,
    confirmed_at          TIMESTAMPTZ,
    last_error            TEXT,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, yield_minter_address, loan_id, repayment_id)
);

CREATE INDEX yield_mint_outbox_pending_idx
    ON yield_mint_outbox (chain_id, yield_minter_address)
    WHERE status = 'pending';

CREATE INDEX yield_mint_outbox_submitted_idx
    ON yield_mint_outbox (chain_id, yield_minter_address)
    WHERE status = 'submitted';
