-- Crystal Intelligence screening results on lp_profiles (one-time address check)
ALTER TABLE lp_profiles ADD COLUMN crystal_address_risk REAL;
ALTER TABLE lp_profiles ADD COLUMN crystal_address_risk_signals JSONB;
ALTER TABLE lp_profiles ADD COLUMN crystal_screened_at TIMESTAMPTZ;

-- Crystal Intelligence screening results on contract_logs (per-transfer check)
ALTER TABLE contract_logs ADD COLUMN crystal_tx_risk REAL;
ALTER TABLE contract_logs ADD COLUMN crystal_tx_signals JSONB;
ALTER TABLE contract_logs ADD COLUMN crystal_sender_risk REAL;
ALTER TABLE contract_logs ADD COLUMN crystal_sender_signals JSONB;
ALTER TABLE contract_logs ADD COLUMN crystal_screened_at TIMESTAMPTZ;

-- Index for fetching unscreened profiles
CREATE INDEX idx_lp_profiles_crystal_unscreened
    ON lp_profiles (wallet_address)
    WHERE crystal_screened_at IS NULL;
