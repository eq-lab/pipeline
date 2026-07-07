-- Generalize KYT columns from Crystal-specific to provider-agnostic names.
-- Both Crystal (EVM) and Elliptic (Stellar) write these columns.

ALTER TABLE lp_profiles  RENAME COLUMN crystal_kyt_status          TO kyt_status;
ALTER TABLE lp_profiles  RENAME COLUMN crystal_address_risk        TO kyt_address_risk;
ALTER TABLE lp_profiles  RENAME COLUMN crystal_address_risk_signals TO kyt_address_signals;
ALTER TABLE lp_profiles  RENAME COLUMN crystal_screened_at         TO kyt_screened_at;

ALTER TABLE contract_logs RENAME COLUMN crystal_kyt_status     TO kyt_status;
ALTER TABLE contract_logs RENAME COLUMN crystal_tx_risk        TO kyt_tx_risk;
ALTER TABLE contract_logs RENAME COLUMN crystal_tx_signals     TO kyt_tx_signals;
ALTER TABLE contract_logs RENAME COLUMN crystal_sender_risk    TO kyt_sender_risk;
ALTER TABLE contract_logs RENAME COLUMN crystal_sender_signals TO kyt_sender_signals;
ALTER TABLE contract_logs RENAME COLUMN crystal_screened_at    TO kyt_screened_at;

-- Recreate the two partial indexes that referenced the old column names.
DROP INDEX IF EXISTS idx_contract_logs_kyt_unverified;
CREATE INDEX idx_contract_logs_kyt_unverified
    ON contract_logs (id)
    WHERE event_name IN ('DepositRequested', 'WithdrawalRequested') AND kyt_status IS NULL;

DROP INDEX IF EXISTS idx_lp_profiles_crystal_unscreened;
CREATE INDEX idx_lp_profiles_kyt_unscreened
    ON lp_profiles (wallet_address)
    WHERE kyt_screened_at IS NULL;
