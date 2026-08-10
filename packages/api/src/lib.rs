pub mod auth;
pub mod config;
pub mod error;
pub mod formatting;
pub mod intervals;
mod middleware;
pub mod routes;

use std::collections::HashMap;
use std::sync::Arc;

use alloy::signers::local::PrivateKeySigner;
use shared::auth_user_repo::AuthUserRepo;
use shared::collateral_valuation_repo::CollateralValuationRepo;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::eip712::Eip712Domain;
use shared::kyc_repo::KycRepo;
use shared::loan_asset_price_repo::LoanAssetPriceRepo;
use shared::loan_capital_transfers_repo::LoanCapitalTransfersRepo;
use shared::loan_disbursement_repo::LoanDisbursementRepo;
use shared::loan_fee_schedule_repo::LoanFeeScheduleRepo;
use shared::loan_metadata::LoanMetadataFetcher;
use shared::position_repo::PositionRepo;
use shared::submitted_loan_repo::SubmittedLoanRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;

use crate::auth::JwtKeys;
use crate::config::{StellarVoucherChainConfig, TransferAddressSets};

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
    /// Custody + ramp address sets keyed by chain_id, for the Capital Allocation
    /// `in_transit` bucket. Absent for chains without both lists configured.
    pub transfer_addresses: HashMap<i64, TransferAddressSets>,
    /// Withdrawal Queue Wallet Strkey keyed by chain_id, for the Capital
    /// Allocation `withdrawal_queue` bucket (Issue #933). Absent for chains
    /// without a configured wallet.
    pub withdrawal_queue_wallets: HashMap<i64, String>,
    /// Tracked asset's on-chain decimal scale keyed by chain_id, shared by the
    /// `in_transit` and `withdrawal_queue` buckets for normalization.
    pub asset_decimals: HashMap<i64, u32>,
    /// EVM KYT (Crystal) toggle — gates the EVM voucher KYT check.
    pub crystal_enabled: bool,
    /// Stellar KYT (Elliptic) toggle — gates the Stellar voucher KYT check.
    /// Mirrors the worker's `ELLIPTIC_ENABLED`; defaults to false.
    pub elliptic_enabled: bool,
    /// Allow-list of addresses authorized to authenticate (signature-based login).
    pub auth_user_repo: AuthUserRepo,
    /// Originator-submitted loan applications awaiting trustee review.
    pub submitted_loan_repo: SubmittedLoanRepo,
    /// Fetches the off-chain document at a submission's `metadata_uri` so `submit_loan`
    /// can validate it parses as `LoanMetadataJson` (the same type the indexer parses).
    /// Trait object so tests can inject a mock without an HTTP server.
    pub loan_metadata_fetcher: Arc<dyn LoanMetadataFetcher>,
    /// Per-loan protocol fee schedule (`loan_fee_schedule`), for the repayment waterfall.
    pub loan_fee_schedule_repo: LoanFeeScheduleRepo,
    /// Collected per-asset USD prices (`loan_asset_prices`), for collateral valuation.
    pub loan_asset_price_repo: LoanAssetPriceRepo,
    /// Per-loan collateral valuation record (anchor + assay/offtake/quantity).
    pub collateral_valuation_repo: CollateralValuationRepo,
    /// Per-loan USDC off-ramp completion flag, backing the `Disbursing` status.
    pub loan_disbursement_repo: LoanDisbursementRepo,
    /// JWT signing/verification keys. `None` when not configured (auth disabled).
    pub jwt_keys: Option<JwtKeys>,
    /// Trustee-entered per-loan capital movement record
    /// (`loan_capital_transfers`), backing `capital-allocation`'s reworked
    /// `deployed` / `in_transit` / `trust_account` buckets (#1027).
    pub loan_capital_transfers_repo: LoanCapitalTransfersRepo,
}
