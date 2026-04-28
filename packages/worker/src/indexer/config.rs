use std::env;

use anyhow::{Context, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobType {
    Transfer,
    WithdrawalQueue,
}

pub struct IndexerJobSettings {
    pub name: String,
    pub job_type: JobType,
    pub eth_rpc_url: String,
    pub chain_id: i64,
    /// ERC-20 contract addresses to watch. Only used by Transfer jobs.
    pub transfer_contracts: Vec<String>,
    /// Only index transfers where from or to is in this list. Only used by Transfer jobs.
    pub transfer_targets: Vec<String>,
    /// Withdrawal queue contract addresses. Only used by WithdrawalQueue jobs.
    pub wq_contracts: Vec<String>,
    pub polling_block_range: u64,
    pub polling_interval_ms: u64,
    pub log_confirmations_delay: u64,
}

impl IndexerJobSettings {
    pub fn from_env(name: &str) -> Result<Self> {
        let prefix = format!("JOB_{}_", name.to_uppercase());

        let job_type = match env_require(&format!("{prefix}TYPE"))?
            .to_lowercase()
            .as_str()
        {
            "transfer" => JobType::Transfer,
            "withdrawal_queue" => JobType::WithdrawalQueue,
            other => anyhow::bail!(
                "{prefix}TYPE must be 'transfer' or 'withdrawal_queue', got '{other}'"
            ),
        };

        let eth_rpc_url = env_require(&format!("{prefix}ETH_RPC_URL"))?;
        let chain_id: i64 = env_require(&format!("{prefix}CHAIN_ID"))?
            .parse()
            .context("CHAIN_ID must be an integer")?;

        let mut transfer_contracts = vec![];
        let mut transfer_targets = vec![];
        let mut wq_contracts = vec![];

        match job_type {
            JobType::Transfer => {
                transfer_contracts = env_csv_require(&format!("{prefix}TRANSFER_CONTRACTS"))?;
                transfer_targets = env_csv_require(&format!("{prefix}TRANSFER_TARGETS"))?;
            }
            JobType::WithdrawalQueue => {
                wq_contracts = env_csv_require(&format!("{prefix}WQ_CONTRACTS"))?;
            }
        }

        let polling_block_range = env_parse(&format!("{prefix}POLLING_BLOCK_RANGE"), 1000)?;
        let polling_interval_ms = env_parse(&format!("{prefix}POLLING_INTERVAL_MS"), 500)?;
        let log_confirmations_delay = env_parse(&format!("{prefix}LOG_CONFIRMATIONS_DELAY"), 12)?;

        Ok(Self {
            name: name.to_owned(),
            job_type,
            eth_rpc_url,
            chain_id,
            transfer_contracts,
            transfer_targets,
            wq_contracts,
            polling_block_range,
            polling_interval_ms,
            log_confirmations_delay,
        })
    }
}

fn env_require(key: &str) -> Result<String> {
    env::var(key).with_context(|| format!("required env var {key} is not set"))
}

fn env_csv_require(key: &str) -> Result<Vec<String>> {
    let val = env_require(key)?;
    let items: Vec<String> = val
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    if items.is_empty() {
        anyhow::bail!("{key} must not be empty");
    }
    Ok(items)
}

fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> Result<T>
where
    T::Err: std::error::Error + Send + Sync + 'static,
{
    match env::var(key) {
        Ok(v) => v
            .parse::<T>()
            .with_context(|| format!("{key} must be a valid number")),
        Err(_) => Ok(default),
    }
}
