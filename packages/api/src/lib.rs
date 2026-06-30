pub mod auth;
pub mod config;
pub mod error;
pub mod formatting;
pub mod intervals;
mod middleware;
pub mod routes;

use std::collections::HashMap;

use alloy::signers::local::PrivateKeySigner;
use shared::auth_user_repo::AuthUserRepo;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::eip712::Eip712Domain;
use shared::kyc_repo::KycRepo;
use shared::loan_asset_price_repo::LoanAssetPriceRepo;
use shared::loan_parameters_repo::LoanParametersRepo;
use shared::position_repo::PositionRepo;
use shared::submitted_loan_repo::SubmittedLoanRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;

use crate::auth::JwtKeys;
use crate::config::StellarVoucherChainConfig;

pub struct AppState {
    pub pool: sqlx::PgPool,
    pub kyc_repo: KycRepo,
    pub position_repo: PositionRepo,
    pub contract_logs_repo: ContractLogsRepo,
    /// The fallback chain ID used when no explicit `chain_id` query param is supplied.
    pub default_chain_id: i64,
    pub sumsub_client: Option<SumsubClient>,
    pub sumsub_settings: Option<SumsubSettings>,
    /// EVM voucher signers keyed by chain_id. Only chains with a configured signer appear here.
    pub voucher_signers: HashMap<i64, PrivateKeySigner>,
    /// EIP-712 domains for DepositManager contracts, keyed by chain_id.
    pub dm_domains: HashMap<i64, Eip712Domain>,
    /// EIP-712 domains for WithdrawalQueue contracts, keyed by chain_id.
    pub wq_domains: HashMap<i64, Eip712Domain>,
    /// Stellar voucher signing config keyed by chain_id.
    pub stellar_voucher_signers: HashMap<i64, StellarVoucherChainConfig>,
    pub crystal_enabled: bool,
    /// Allow-list of addresses authorized to authenticate (signature-based login).
    pub auth_user_repo: AuthUserRepo,
    /// Originator-submitted loan applications awaiting trustee review.
    pub submitted_loan_repo: SubmittedLoanRepo,
    /// Per-loan collateral asset + discount + price provider (`loan_parameters`).
    pub loan_parameters_repo: LoanParametersRepo,
    /// Collected per-asset USD prices (`loan_asset_prices`), for collateral valuation.
    pub loan_asset_price_repo: LoanAssetPriceRepo,
    /// JWT signing/verification keys. `None` when not configured (auth disabled).
    pub jwt_keys: Option<JwtKeys>,
}
