-- Vault registry
CREATE TABLE vaults (
    id              BIGSERIAL PRIMARY KEY,
    chain_id        BIGINT NOT NULL,
    address         TEXT NOT NULL,
    name            TEXT,
    asset_decimals  SMALLINT NOT NULL DEFAULT 18,
    share_decimals  SMALLINT NOT NULL DEFAULT 18,

    UNIQUE(chain_id, address)
);

-- Share price snapshots collected at regular block intervals
CREATE TABLE share_prices (
    id              BIGSERIAL PRIMARY KEY,
    chain_id        BIGINT NOT NULL,
    vault_address   TEXT NOT NULL,
    block_number    BIGINT NOT NULL,
    block_timestamp TIMESTAMPTZ NOT NULL,
    price           NUMERIC(38, 18) NOT NULL,

    UNIQUE(chain_id, vault_address, block_number)
);

CREATE INDEX idx_share_prices_latest
    ON share_prices (chain_id, vault_address, block_number DESC);

-- Position tracking columns on contract_logs (populated for StakingDeposit/StakingWithdrawal only)
ALTER TABLE contract_logs ADD COLUMN shares_balance      NUMERIC(29, 12);
ALTER TABLE contract_logs ADD COLUMN avg_buy_share_price NUMERIC(29, 18);
ALTER TABLE contract_logs ADD COLUMN realized_pnl        NUMERIC(29, 12);

-- Seed values
INSERT INTO vaults (chain_id, address, name, asset_decimals, share_decimals)
VALUES (560048, '0x4C414d0948D8392b1E78e25cb54b4074616Af2B6', 'sPLUSD', 6, 6);                                                                       