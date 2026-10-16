// spec: docs/product-specs/api-authorization-loan-submission.md

use sqlx::PgPool;

pub const DEFAULT_CHAIN_GUC: &str = "pipeline.default_chain_id";

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn run(pool: &PgPool, default_chain_id: Option<i64>) -> anyhow::Result<()> {
    let mut conn = pool.acquire().await?;
    if let Some(id) = default_chain_id {
        set_guc(&mut conn, &id.to_string()).await?;
    }
    let result = MIGRATOR.run(&mut *conn).await;
    if default_chain_id.is_some() {
        if let Err(e) = set_guc(&mut conn, "").await {
            tracing::warn!(error = %e, "failed to reset {DEFAULT_CHAIN_GUC} after migrations");
        }
    }
    result?;
    Ok(())
}

async fn set_guc(conn: &mut sqlx::PgConnection, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT set_config($1, $2, false)")
        .bind(DEFAULT_CHAIN_GUC)
        .bind(value)
        .execute(conn)
        .await?;
    Ok(())
}

pub fn parse_optional_default_chain_id(
    raw: Option<&str>,
    chains: &[i64],
) -> anyhow::Result<Option<i64>> {
    let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let id = s
        .parse::<i64>()
        .map_err(|_| anyhow::anyhow!("DEFAULT_CHAIN_ID must be a valid integer"))?;
    if !chains.contains(&id) {
        anyhow::bail!("DEFAULT_CHAIN_ID={id} is not a member of CHAINS={chains:?}");
    }
    Ok(Some(id))
}

pub fn default_chain_id_from_env() -> anyhow::Result<Option<i64>> {
    let raw = std::env::var("DEFAULT_CHAIN_ID").ok();
    if raw.as_deref().map(str::trim).is_none_or(str::is_empty) {
        return Ok(None);
    }
    let chains = crate::chains::parse_chains_env()?;
    parse_optional_default_chain_id(raw.as_deref(), &chains)
}
