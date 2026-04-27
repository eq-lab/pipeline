-- 20260424000001_lp_profiles.sql
CREATE TABLE lp_profiles (
    wallet_address    TEXT        PRIMARY KEY,
    sumsub_applicant_id TEXT,
    kyc_status        SMALLINT    NOT NULL DEFAULT 1,  -- 1=Red, 2=Green, 3=Yellow
    kyc_review_status SMALLINT    NOT NULL DEFAULT 3,  -- 1=Pending, 2=Completed, 3=Init, 4=OnHold
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
