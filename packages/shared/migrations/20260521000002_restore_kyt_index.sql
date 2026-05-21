-- Recreate partial index for crystal KYT screening batch (fetch_unverified_transfers).
-- Separated from 20260521000001 because that migration was already applied before
-- this index recreation was identified as necessary.
CREATE INDEX IF NOT EXISTS idx_contract_logs_kyt_unverified
    ON contract_logs (id)
    WHERE event_name IN ('DepositRequested', 'WithdrawalRequested') AND crystal_kyt_status IS NULL;
