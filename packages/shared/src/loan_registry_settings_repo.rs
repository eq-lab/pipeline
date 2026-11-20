// spec: docs/references/backend.md#loanregistry-settings-sync

pub const UPSERT_MAX_FEE_BPS_SQL: &str =
    "INSERT INTO loan_registry_settings (chain_id, contract_address, max_fee_bps)
     VALUES ($1, $2, $3)
     ON CONFLICT (chain_id, contract_address)
     DO UPDATE SET max_fee_bps = EXCLUDED.max_fee_bps, updated_at = now()";

pub const SELECT_MAX_FEE_BPS_SQL: &str = "SELECT max_fee_bps FROM loan_registry_settings
     WHERE chain_id = $1 AND contract_address = $2";

pub async fn upsert_max_fee_bps<'e, E>(
    executor: E,
    chain_id: i64,
    contract_address: &str,
    max_fee_bps: u32,
) -> sqlx::Result<()>
where
    E: sqlx::PgExecutor<'e>,
{
    sqlx::query(UPSERT_MAX_FEE_BPS_SQL)
        .bind(chain_id)
        .bind(contract_address)
        .bind(i64::from(max_fee_bps))
        .execute(executor)
        .await?;
    Ok(())
}

pub async fn max_fee_bps<'e, E>(
    executor: E,
    chain_id: i64,
    contract_address: &str,
) -> anyhow::Result<Option<u32>>
where
    E: sqlx::PgExecutor<'e>,
{
    let row: Option<i64> = sqlx::query_scalar(SELECT_MAX_FEE_BPS_SQL)
        .bind(chain_id)
        .bind(contract_address)
        .fetch_optional(executor)
        .await?;
    row.map(|v| u32::try_from(v).map_err(|_| anyhow::anyhow!("max_fee_bps {v} out of u32 range")))
        .transpose()
}
