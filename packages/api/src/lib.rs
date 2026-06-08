pub mod config;
pub mod error;
pub mod formatting;
pub mod intervals;
mod middleware;
pub mod routes;

use std::collections::HashMap;

use alloy::signers::local::PrivateKeySigner;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::eip712::Eip712Domain;
use shared::kyc_repo::KycRepo;
use shared::position_repo::PositionRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;

pub struct AppState {
    pub pool: sqlx::PgPool,
    pub kyc_repo: KycRepo,
    pub position_repo: PositionRepo,
    pub contract_logs_repo: ContractLogsRepo,
    /// The fallback chain ID used when no explicit `chain_id` query param is supplied.
    pub default_chain_id: i64,
    pub sumsub_client: Option<SumsubClient>,
    pub sumsub_settings: Option<SumsubSettings>,
    /// Voucher signers keyed by chain_id. Only chains with a configured signer appear here.
    pub voucher_signers: HashMap<i64, PrivateKeySigner>,
    /// EIP-712 domains for DepositManager contracts, keyed by chain_id.
    pub dm_domains: HashMap<i64, Eip712Domain>,
    /// EIP-712 domains for WithdrawalQueue contracts, keyed by chain_id.
    pub wq_domains: HashMap<i64, Eip712Domain>,
    pub crystal_enabled: bool,
}
