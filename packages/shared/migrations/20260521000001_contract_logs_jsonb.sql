-- Wipe indexed data and reset cursor so operator can re-index from start block.
TRUNCATE contract_logs, log_collector_state;

-- Drop the partial KYT screening index (recreated in migration 20260521000002).
DROP INDEX IF EXISTS idx_contract_logs_kyt_unverified;

-- Drop all sparse nullable event-data columns.
ALTER TABLE contract_logs
    DROP COLUMN IF EXISTS sender,
    DROP COLUMN IF EXISTS receiver,
    DROP COLUMN IF EXISTS amount,
    DROP COLUMN IF EXISTS request_id,
    DROP COLUMN IF EXISTS cumulative,
    DROP COLUMN IF EXISTS assets,
    DROP COLUMN IF EXISTS shares,
    DROP COLUMN IF EXISTS shares_balance,
    DROP COLUMN IF EXISTS avg_buy_share_price,
    DROP COLUMN IF EXISTS realized_pnl;

-- Add unified JSONB params column.
ALTER TABLE contract_logs ADD COLUMN params JSONB NOT NULL DEFAULT '{}';

-- GIN index for flexible JSONB queries.
CREATE INDEX idx_contract_logs_params ON contract_logs USING GIN (params);
