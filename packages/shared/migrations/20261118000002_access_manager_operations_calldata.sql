-- spec: docs/references/access-manager-events.md#table
--
-- Rollback:
--   ALTER TABLE access_manager_operations DROP CONSTRAINT access_manager_operations_one_args_encoding;
--   ALTER TABLE access_manager_operations DROP COLUMN calldata;
--   DELETE FROM _sqlx_migrations WHERE version = 20261118000002;

ALTER TABLE access_manager_operations
    ADD COLUMN IF NOT EXISTS calldata TEXT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'access_manager_operations'
          AND con.conname = 'access_manager_operations_one_args_encoding'
    ) THEN
        ALTER TABLE access_manager_operations
            ADD CONSTRAINT access_manager_operations_one_args_encoding
            CHECK (args_xdr IS NULL OR calldata IS NULL);
    END IF;
END $$;
