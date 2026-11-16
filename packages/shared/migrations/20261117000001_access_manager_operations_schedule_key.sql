-- spec: docs/references/access-manager-events.md#table
--
-- Rollback:
--   ALTER TABLE access_manager_operations DROP CONSTRAINT access_manager_operations_schedule_key;
--   -- delete the newer rows that share (chain_id, contract_address, operation_id, nonce) first
--   ALTER TABLE access_manager_operations
--       ADD UNIQUE (chain_id, contract_address, operation_id, nonce);
--   DELETE FROM _sqlx_migrations WHERE version = 20261117000001;

DO $$
DECLARE
    old_key text;
BEGIN
    SELECT con.conname INTO old_key
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'access_manager_operations'
      AND con.contype = 'u'
      AND con.conname <> 'access_manager_operations_schedule_key';
    IF old_key IS NOT NULL THEN
        EXECUTE format('ALTER TABLE access_manager_operations DROP CONSTRAINT %I', old_key);
    END IF;
END $$;

ALTER TABLE access_manager_operations
    ADD CONSTRAINT access_manager_operations_schedule_key
    UNIQUE (chain_id, contract_address, operation_id, schedule_ledger, nonce);
