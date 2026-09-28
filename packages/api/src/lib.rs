pub mod auth;
pub mod captcha;
pub mod config;
pub mod error;
pub mod formatting;
pub mod intervals;
mod middleware;
pub mod otp;
pub mod password;
pub mod routes;

use std::collections::HashMap;
use std::sync::Arc;

use alloy::signers::local::PrivateKeySigner;
use shared::account_repo::AccountRepo;
use shared::auth_user_repo::AuthUserRepo;
use shared::collateral_valuation_repo::CollateralValuationRepo;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::eip712::Eip712Domain;
use shared::email::EmailSender;
use shared::kyb_document_repo::KybDocumentRepo;
use shared::kyc_repo::KycRepo;
use shared::loan_asset_price_repo::LoanAssetPriceRepo;
use shared::loan_capital_transfers_repo::LoanCapitalTransfersRepo;
use shared::loan_disbursement_repo::LoanDisbursementRepo;
use shared::loan_fee_schedule_repo::LoanFeeScheduleRepo;
use shared::loan_metadata::LoanMetadataFetcher;
use shared::login_attempt_repo::LoginAttemptRepo;
use shared::lp_ledger_repo::LpLedgerRepo;
use shared::lp_repo::LpRepo;
use shared::object_store::ObjectStore;
use shared::otp_repo::OtpRepo;
use shared::position_repo::PositionRepo;
use shared::submitted_loan_repo::SubmittedLoanRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;

use crate::auth::JwtKeys;
use crate::captcha::CaptchaVerifier;
use crate::config::{KybLimits, StellarVoucherChainConfig, TransferAddressSets};

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
    /// LP (business entity) registry for the custom KYB service (`lps`).
    pub lp_repo: LpRepo,
    /// Append-only ledger of every movement of an LP's claim (`lp_ledger`),
    /// backing `GET /v1/lp-ledger` and `POST /v1/lp-ledger/deposits`.
    pub lp_ledger_repo: LpLedgerRepo,
    /// KYB supporting documents (`kyb_documents`) — untyped files per LP.
    pub kyb_document_repo: KybDocumentRepo,
    /// Private Spaces bucket holding the bytes behind `kyb_documents.file_ref`.
    pub object_store: ObjectStore,
    /// Size and count ceilings on KYB uploads. Carried on the state (not just
    /// applied at the router) because the per-file and per-LP limits are
    /// enforced inside the handler, where the body limit cannot reach.
    pub kyb_limits: KybLimits,
    /// The API's principals (`accounts`) — what both the wallet and the
    /// email/password credential resolve to.
    pub account_repo: AccountRepo,
    /// Outstanding email-verification passcodes (`otp_codes`).
    pub otp_repo: OtpRepo,
    /// Bot defense on the unauthenticated auth endpoints. Trait object so
    /// handlers can be exercised without a network round-trip, and so the
    /// provider is a one-impl swap.
    pub captcha: Box<dyn CaptchaVerifier>,
    /// Transactional email. Currently a logging stand-in — real delivery is
    /// tracked as its own blocking issue (see `shared::email`).
    pub email_sender: Arc<dyn EmailSender>,
    /// Failed sign-in counters (`login_attempts`) — `login`'s only bound, since
    /// it carries no captcha.
    pub login_attempt_repo: LoginAttemptRepo,
}
