-- 20260427000001_aml_status.sql
ALTER TABLE lp_profiles ADD COLUMN aml_status SMALLINT NOT NULL DEFAULT 1;
-- 1=Pending, 2=Clear, 3=Hit
