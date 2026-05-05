ALTER TABLE lp_profiles ADD COLUMN kyt_status SMALLINT;
ALTER TABLE contract_logs ADD COLUMN kyt_status SMALLINT;

CREATE INDEX idx_contract_logs_kyt_unverified
    ON contract_logs (id)
    WHERE event_name = 'Transfer' AND kyt_status IS NULL;
