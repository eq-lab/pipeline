ALTER TABLE lp_profiles
    ADD COLUMN is_whitelisted BOOLEAN,
    ADD COLUMN whitelist_reset_at TIMESTAMPTZ;
