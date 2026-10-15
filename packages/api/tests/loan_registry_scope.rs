// spec: docs/exec-plans/completed/issue-1526-loanbook-registry-scope.md#test-strategy
use std::collections::HashMap;

use pipeline_api::error::ApiError;
use pipeline_api::routes::common::loan_registry_address;
use pipeline_api::routes::loan_book::handle_loan_book;
use pipeline_api::AppState;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::kyc_repo::KycRepo;
use shared::position_repo::PositionRepo;

fn make_test_state(loan_registry_addresses: HashMap<i64, String>) -> AppState {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap();

    AppState {
        pool: pool.clone(),
        kyc_repo: KycRepo::new(pool.clone()),
        position_repo: PositionRepo::new(pool.clone()),
        contract_logs_repo: ContractLogsRepo::new(pool.clone()),
        default_chain_id: 1,
        chains: Vec::new(),
        sumsub_client: None,
        sumsub_settings: None,
        voucher_signers: HashMap::new(),
        dm_domains: HashMap::new(),
        wq_domains: HashMap::new(),
        stellar_voucher_signers: HashMap::new(),
        transfer_addresses: HashMap::new(),
        withdrawal_queue_wallets: HashMap::new(),
        asset_decimals: HashMap::new(),
        loan_registry_addresses,
        crystal_enabled: false,
        elliptic_enabled: false,
        auth_user_repo: shared::auth_user_repo::AuthUserRepo::new(pool.clone()),
        submitted_loan_repo: shared::submitted_loan_repo::SubmittedLoanRepo::new(pool.clone()),
        loan_metadata_fetcher: std::sync::Arc::new(
            shared::loan_metadata::HttpLoanMetadataFetcher::new(
                shared::metadata_fetcher::MetadataFetcher::new(
                    reqwest::Client::new(),
                    "https://ipfs.io/ipfs/".to_owned(),
                ),
            ),
        ),
        loan_fee_schedule_repo: shared::loan_fee_schedule_repo::LoanFeeScheduleRepo::new(
            pool.clone(),
        ),
        loan_asset_price_repo: shared::loan_asset_price_repo::LoanAssetPriceRepo::new(pool.clone()),
        collateral_valuation_repo: shared::collateral_valuation_repo::CollateralValuationRepo::new(
            pool.clone(),
        ),
        loan_disbursement_repo: shared::loan_disbursement_repo::LoanDisbursementRepo::new(
            pool.clone(),
        ),
        jwt_keys: None,
        loan_capital_transfers_repo:
            shared::loan_capital_transfers_repo::LoanCapitalTransfersRepo::new(pool.clone()),
        lp_repo: shared::lp_repo::LpRepo::new(pool.clone()),
        lp_ledger_repo: shared::lp_ledger_repo::LpLedgerRepo::new(pool.clone()),
        lp_bank_deposit_repo: shared::lp_bank_deposit_repo::LpBankDepositRepo::new(pool.clone()),
        kyb_document_repo: shared::kyb_document_repo::KybDocumentRepo::new(pool.clone()),
        // Constructing an `ObjectStore` performs no I/O, so placeholder
        // credentials are enough to build the struct; the helpers under test
        // never touch it.
        object_store: shared::object_store::ObjectStore::new(
            "test-key",
            "test-secret",
            "https://test.digitaloceanspaces.com",
            "test",
            "test-bucket",
        ),
        kyb_limits: pipeline_api::config::KybLimits {
            max_document_bytes: pipeline_api::config::DEFAULT_KYB_MAX_DOCUMENT_BYTES,
            max_files_per_request: pipeline_api::config::DEFAULT_KYB_MAX_FILES_PER_REQUEST,
            max_documents_per_lp: pipeline_api::config::DEFAULT_KYB_MAX_DOCUMENTS_PER_LP,
        },
        account_repo: shared::account_repo::AccountRepo::new(pool.clone()),
        otp_repo: shared::otp_repo::OtpRepo::new(pool.clone()),
        captcha: Box::new(pipeline_api::captcha::DisabledCaptcha),
        email_sender: std::sync::Arc::new(shared::email::LoggingEmailSender),
        login_attempt_repo: shared::login_attempt_repo::LoginAttemptRepo::new(pool),
        password_reset: pipeline_api::password_reset::PasswordResetConfig {
            app_base_url: pipeline_api::password_reset::DEV_APP_BASE_URL.to_owned(),
            ttl_minutes: pipeline_api::password_reset::DEFAULT_PASSWORD_RESET_TTL_MINUTES,
        },
    }
}

fn two_chain_state() -> AppState {
    make_test_state(HashMap::from([
        (1, "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed".to_owned()),
        (
            99_000_001,
            "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO".to_owned(),
        ),
    ]))
}

#[tokio::test]
async fn returns_each_chains_own_registry() {
    let state = two_chain_state();
    assert_eq!(
        loan_registry_address(&state, 1).unwrap(),
        "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
    );
    assert_eq!(
        loan_registry_address(&state, 99_000_001).unwrap(),
        "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO"
    );
}

#[tokio::test]
async fn unconfigured_chain_is_bad_request() {
    let state = two_chain_state();
    assert!(matches!(
        loan_registry_address(&state, 42),
        Err(ApiError::BadRequest(msg)) if msg.contains("42")
    ));
}

#[tokio::test]
async fn loan_book_for_unconfigured_chain_is_empty_not_error() {
    let state = two_chain_state();
    let book = handle_loan_book(&state, 560_048).await.unwrap();
    assert!(book.loans.is_empty());
    assert_eq!(book.summary.total_deployed, "0.000000");
    assert_eq!(book.summary.deployed_senior, "0.000000");
    assert!(book.summary.total_collateral.is_none());
    assert!(book.summary.top_concentration.is_none());
}
