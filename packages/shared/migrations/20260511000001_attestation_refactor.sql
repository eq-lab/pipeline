-- Add one-time on-chain allow flag (replaces TTL-based is_whitelisted/whitelist_reset_at)
ALTER TABLE lp_profiles ADD COLUMN on_chain_allowed BOOLEAN NOT NULL DEFAULT FALSE;

-- Update partial index for KYT screening: DepositRequested replaces Transfer
DROP INDEX IF EXISTS idx_contract_logs_kyt_unverified;
CREATE INDEX idx_contract_logs_kyt_unverified
    ON contract_logs (id)
    WHERE event_name IN ('DepositRequested', 'WithdrawalRequested') AND kyt_status IS NULL;

-- Index for profiles pending on-chain allow
CREATE INDEX idx_lp_profiles_not_allowed
    ON lp_profiles (wallet_address)
    WHERE on_chain_allowed = FALSE;
