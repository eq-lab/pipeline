// spec: docs/product-specs/trustee-attention-counts.md#api-contract
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use bigdecimal::BigDecimal;
use pipeline_api::auth::Claims;
use pipeline_api::config::ConfiguredChain;
use pipeline_api::error::ApiError;
use pipeline_api::routes::attention_counts::{
    self, authorize, build_response, cash_management_counts, loan_counts, origination_counts,
    AttentionCountsDoc, ChainAttentionCounts,
};
use pipeline_api::routes::common::ChainScope;
use pipeline_api::routes::ramp::{filter_pending_ramp_events, RampEvent};
use pipeline_api::{config::TransferAddressSets, AppState};
use serde_json::json;
use shared::chains::ChainKind;
use shared::contract_logs_repo::{
    AssetTransferRow, ContractLogsRepo, LifecycleRow, LoanSnapshotRow, MinterEventRow,
};
use shared::kyc_repo::KycRepo;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};
use shared::position_repo::PositionRepo;
use shared::submitted_loan_repo::SubmissionCountsRow;
use tower::ServiceExt;
use utoipa::OpenApi;

const EVM: ConfiguredChain = ConfiguredChain {
    chain_id: 560_048,
    kind: ChainKind::Evm,
};
const STELLAR: ConfiguredChain = ConfiguredChain {
    chain_id: 99_000_001,
    kind: ChainKind::Stellar,
};
const MINTER: &str = "CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX";
const LP: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const CUSTODY: &str = "GAFB7IYPCYZCODQBB5BR5JO45JC4PPVLARUAXQSFHWTLH2KMHPWJ36GD";
const RAMP: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const NOW: i64 = 2_000_000_000;

fn make_test_state() -> AppState {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap();

    AppState {
        pool: pool.clone(),
        kyc_repo: KycRepo::new(pool.clone()),
        position_repo: PositionRepo::new(pool.clone()),
        contract_logs_repo: ContractLogsRepo::new(pool.clone()),
        default_chain_id: 1,
        chains: vec![EVM, STELLAR],
        sumsub_client: None,
        sumsub_settings: None,
        voucher_signers: HashMap::new(),
        dm_domains: HashMap::new(),
        wq_domains: HashMap::new(),
        stellar_voucher_signers: HashMap::new(),
        transfer_addresses: HashMap::new(),
        withdrawal_queue_wallets: HashMap::new(),
        asset_decimals: HashMap::new(),
        loan_registry_addresses: HashMap::new(),
        minter_addresses: HashMap::new(),
        capital_allocation_from_minter: std::collections::HashSet::new(),
        withdrawal_queue_addresses: HashMap::new(),
        pocket_addresses: HashMap::new(),
        security_marks: shared::security_marks::MarkSettings::default(),
        security_registry_addresses: HashMap::new(),
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
        system_configuration_repo: shared::system_configuration_repo::SystemConfigurationRepo::new(
            pool.clone(),
        ),
        lp_requested_bank_details_repo:
            shared::lp_requested_bank_details_repo::LpRequestedBankDetailsRepo::new(pool.clone()),
        kyb_document_repo: shared::kyb_document_repo::KybDocumentRepo::new(pool.clone()),
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

fn sub_row(chain: i64, in_review: i64, changes: i64, approved: i64) -> SubmissionCountsRow {
    SubmissionCountsRow {
        target_chain_id: chain,
        in_review,
        changes_requested: changes,
        approved_undrawn: approved,
    }
}

#[test]
fn origination_counts_in_review_and_approved_undrawn_only() {
    let c = origination_counts(STELLAR.chain_id, &[sub_row(STELLAR.chain_id, 2, 5, 3)]);
    assert_eq!(c.count, 5);
    assert_eq!(c.in_review, 2);
    assert_eq!(c.changes_requested, 5);
    assert_eq!(c.approved_undrawn, 3);
}

#[test]
fn origination_ignores_rows_of_other_chains() {
    let c = origination_counts(STELLAR.chain_id, &[sub_row(EVM.chain_id, 4, 1, 1)]);
    assert_eq!(
        (
            c.count,
            c.in_review,
            c.changes_requested,
            c.approved_undrawn
        ),
        (0, 0, 0, 0)
    );
}

#[test]
fn origination_with_no_rows_is_zero() {
    let c = origination_counts(STELLAR.chain_id, &[]);
    assert_eq!(c.count, 0);
}

fn loan(id: BigDecimal, status: &str, maturity: i64) -> LoanSnapshotRow {
    LoanSnapshotRow {
        chain_id: STELLAR.chain_id,
        loan_id: id,
        block_number: 0,
        log_index: 0,
        event_name: "LoanDrawn".to_owned(),
        block_timestamp: 0,
        snapshot: LoanSnapshot {
            originator: "o".to_owned(),
            borrower_id: "b".to_owned(),
            commodity: "c".to_owned(),
            corridor: "cr".to_owned(),
            governing_law: "EN".to_owned(),
            protection: String::new(),
            metadata_uri: None,
            documents: Vec::new(),
            original_facility_size: BigDecimal::from(0_i64),
            original_senior_tranche: BigDecimal::from(0_i64),
            original_equity_tranche: BigDecimal::from(0_i64),
            original_offtaker_price: BigDecimal::from(0_i64),
            senior_interest_rate_bps: 0,
            origination_date: 0,
            original_maturity_date: maturity,
            next_economics_epochs_id: BigDecimal::from(1_i64),
            next_repayment_id: BigDecimal::from(0_i64),
            status: status.to_owned(),
            current_maturity_timestamp: maturity,
            current_rate: 0,
            closure_reason: "None".to_owned(),
            carved_out: false,
            disbursed: BigDecimal::from(0_i64),
            repaid: BigDecimal::from(0_i64),
            written_down: BigDecimal::from(0_i64),
            interest_adjustment: BigDecimal::from(0_i64),
            metadata_uri_onchain: String::new(),
            repayment: RepaymentSnapshot {
                offtaker_received: BigDecimal::from(0_i64),
                senior_principal_repaid: BigDecimal::from(0_i64),
                senior_interest: BigDecimal::from(0_i64),
                equity_distributed: BigDecimal::from(0_i64),
                mgmt_fee: BigDecimal::from(0_i64),
                perf_fee: BigDecimal::from(0_i64),
                oet_alloc: BigDecimal::from(0_i64),
            },
        },
    }
}

fn l(id: i64, status: &str, maturity: i64) -> LoanSnapshotRow {
    loan(BigDecimal::from(id), status, maturity)
}

fn complete(ids: &[i64]) -> HashMap<String, bool> {
    ids.iter().map(|i| (i.to_string(), true)).collect()
}

fn margins(ids: &[&str]) -> HashSet<String> {
    ids.iter().map(|s| (*s).to_owned()).collect()
}

fn lc(
    rows: &[LoanSnapshotRow],
    disbursed: &HashMap<String, bool>,
    margins: Option<&HashSet<String>>,
    now: i64,
) -> pipeline_api::routes::attention_counts::LoanCounts {
    loan_counts(rows, &[], disbursed, margins, now)
}

fn event(name: &str, id: i64, ts: i64, status: Option<&str>) -> LifecycleRow {
    LifecycleRow {
        chain_id: STELLAR.chain_id,
        event_name: name.to_owned(),
        block_timestamp: ts,
        loan_id: BigDecimal::from(id),
        status: status.map(str::to_owned),
    }
}

const NO_MARGINS: Option<&HashSet<String>> = None;
const FUTURE: i64 = NOW + 1_000;
const PAST: i64 = NOW - 1_000;

#[test]
fn a_watch_list_loan_with_off_ramp_complete_counts() {
    let c = lc(
        &[l(1, "WatchList", FUTURE)],
        &complete(&[1]),
        NO_MARGINS,
        NOW,
    );
    assert_eq!(
        (c.count, c.watch_list, c.past_due, c.disbursing),
        (1, 1, 0, 0)
    );
}

#[test]
fn a_performing_loan_past_maturity_is_past_due_and_counts() {
    let c = lc(
        &[l(1, "Performing", PAST)],
        &complete(&[1]),
        NO_MARGINS,
        NOW,
    );
    assert_eq!((c.count, c.past_due), (1, 1));
}

#[test]
fn a_loan_without_a_disbursement_row_is_disbursing_and_counts() {
    let c = lc(
        &[l(1, "Performing", PAST)],
        &HashMap::new(),
        NO_MARGINS,
        NOW,
    );
    assert_eq!((c.count, c.disbursing, c.past_due), (1, 1, 0));
}

#[test]
fn a_healthy_performing_loan_does_not_count() {
    let c = lc(
        &[l(1, "Performing", FUTURE)],
        &complete(&[1]),
        NO_MARGINS,
        NOW,
    );
    assert_eq!(c.count, 0);
}

#[test]
fn a_defaulted_loan_is_served_but_not_counted_even_with_a_margin_call() {
    let m = margins(&["1"]);
    let c = lc(&[l(1, "Default", PAST)], &complete(&[1]), Some(&m), NOW);
    assert_eq!((c.count, c.defaulted, c.margin_call_open), (0, 1, Some(1)));
}

#[test]
fn a_closed_loan_with_a_margin_call_is_ignored() {
    let m = margins(&["1"]);
    let c = lc(&[l(1, "Closed", PAST)], &complete(&[1]), Some(&m), NOW);
    assert_eq!((c.count, c.defaulted, c.margin_call_open), (0, 0, Some(0)));
}

#[test]
fn a_performing_loan_with_a_margin_call_counts() {
    let m = margins(&["1"]);
    let c = lc(
        &[l(1, "Performing", FUTURE)],
        &complete(&[1]),
        Some(&m),
        NOW,
    );
    assert_eq!((c.count, c.margin_call_open), (1, Some(1)));
}

#[test]
fn a_watch_list_loan_with_a_margin_call_counts_once() {
    let m = margins(&["1"]);
    let c = lc(&[l(1, "WatchList", FUTURE)], &complete(&[1]), Some(&m), NOW);
    assert_eq!((c.count, c.watch_list, c.margin_call_open), (1, 1, Some(1)));
}

#[test]
fn no_security_registry_gives_a_null_margin_field_and_unchanged_others() {
    let rows = [l(1, "WatchList", FUTURE), l(2, "Performing", PAST)];
    let c = lc(&rows, &complete(&[1, 2]), NO_MARGINS, NOW);
    assert_eq!(c.margin_call_open, None);
    assert_eq!((c.count, c.watch_list, c.past_due), (2, 1, 1));
}

#[test]
fn margin_call_ids_match_snapshot_ids_regardless_of_scale() {
    let scaled = loan("7.0".parse().unwrap(), "Performing", FUTURE);
    let negative_scale = loan(BigDecimal::new(1.into(), -1), "Performing", FUTURE);
    let disbursed: HashMap<String, bool> =
        HashMap::from([("7".to_owned(), true), ("10".to_owned(), true)]);
    let m = margins(&["7", "10"]);
    let c = lc(&[scaled, negative_scale], &disbursed, Some(&m), NOW);
    assert_eq!((c.count, c.margin_call_open), (2, Some(2)));
}

#[test]
fn a_loan_originating_in_the_future_is_not_counted() {
    let mut future = l(1, "WatchList", FUTURE);
    future.snapshot.origination_date = FUTURE;
    let m = margins(&["1"]);
    let c = loan_counts(&[future], &[], &complete(&[1]), Some(&m), NOW);
    assert_eq!((c.count, c.watch_list, c.margin_call_open), (0, 0, Some(0)));
}

#[test]
fn a_legacy_closed_event_removes_a_loan_the_snapshot_still_shows_open() {
    let ev = [event("LoanClosed", 1, NOW - 10, None)];
    let c = loan_counts(
        &[l(1, "WatchList", FUTURE)],
        &ev,
        &complete(&[1]),
        NO_MARGINS,
        NOW,
    );
    assert_eq!(c.count, 0);
}

#[test]
fn a_legacy_defaulted_event_makes_the_loan_defaulted_not_counted() {
    let ev = [event("LoanDefaulted", 1, NOW - 10, None)];
    let c = loan_counts(
        &[l(1, "WatchList", FUTURE)],
        &ev,
        &complete(&[1]),
        NO_MARGINS,
        NOW,
    );
    assert_eq!((c.count, c.defaulted), (0, 1));
}

fn row(name: &str, block: i64, params: serde_json::Value) -> MinterEventRow {
    MinterEventRow {
        event_name: name.to_owned(),
        block_number: block,
        log_index: 0,
        block_timestamp: 1_790_000_000,
        params,
    }
}

fn wire_in(block: i64, id: i64, receiver: &str) -> MinterEventRow {
    row(
        "WireIn",
        block,
        json!({"id": id, "receiver": receiver, "amount": "10000000", "value_date": "1789000000", "ref_hash": "ab"}),
    )
}

fn ramp_opened(block: i64, id: i64, direction: &str, amount: &str) -> MinterEventRow {
    row(
        "RampOpened",
        block,
        json!({"id": id.to_string(), "direction": direction, "amount": amount, "ref_hash": "cd"}),
    )
}

fn ramp_closed(block: i64, id: i64) -> MinterEventRow {
    row(
        "RampClosed",
        block,
        json!({"id": id.to_string(), "received": "10000000", "loss": "0", "ref_hash": "ef"}),
    )
}

fn pending(id: i64, from: &str, to: &str, base6: i64) -> AssetTransferRow {
    AssetTransferRow {
        id,
        chain_id: STELLAR.chain_id,
        from_addr: from.to_owned(),
        to_addr: to.to_owned(),
        amount: BigDecimal::from(base6),
        block_timestamp: 1_000 + id,
        review_decision: None,
        review_reason: None,
        reviewed_at: None,
    }
}

fn events(transfers: &[AssetTransferRow]) -> Vec<RampEvent> {
    let addr = TransferAddressSets {
        custody: HashSet::from([CUSTODY.to_owned()]),
        ramp: HashSet::from([RAMP.to_owned()]),
        asset_decimals: 6,
    };
    filter_pending_ramp_events(transfers, &addr)
}

#[test]
fn wire_ins_count_only_while_escrowed() {
    let rows = vec![
        wire_in(1, 1, MINTER),
        wire_in(2, 2, LP),
        wire_in(3, 3, MINTER),
        row("WireInAssigned", 4, json!({"id": 3, "receiver": LP})),
        wire_in(5, 4, MINTER),
        row("WireInReturned", 6, json!({"id": "4", "ref_hash": "ff"})),
    ];
    let c = cash_management_counts(Some((&rows, MINTER)), None, 0);
    assert_eq!(c.escrowed_wire_ins, Some(1));
    assert_eq!(c.count, 1);
}

#[test]
fn wire_outs_count_only_while_pending() {
    let rows = vec![
        row(
            "WireOutRequested",
            1,
            json!({"id": "1", "lp": LP, "amount": "10"}),
        ),
        row(
            "WireOutRequested",
            2,
            json!({"id": "2", "lp": LP, "amount": "10"}),
        ),
        row(
            "WireOutSettled",
            3,
            json!({"id": "2", "value_date": "1", "ref_hash": "aa"}),
        ),
        row(
            "WireOutRequested",
            4,
            json!({"id": "3", "lp": LP, "amount": "10"}),
        ),
        row("WireOutCancelled", 5, json!({"id": "3"})),
    ];
    let c = cash_management_counts(Some((&rows, MINTER)), None, 0);
    assert_eq!(c.pending_wire_outs, Some(1));
    assert_eq!(c.count, 1);
}

#[test]
fn ramps_count_only_while_open() {
    let rows = vec![
        ramp_opened(1, 1, "BankToUsdc", "10000000"),
        ramp_opened(2, 2, "UsdcToBank", "20000000"),
        ramp_closed(3, 2),
    ];
    let c = cash_management_counts(Some((&rows, MINTER)), None, 0);
    assert_eq!((c.open_ramps, c.count), (Some(1), 1));
}

#[test]
fn a_malformed_wire_in_is_skipped() {
    let rows = vec![row("WireIn", 1, json!({"id": 1, "receiver": MINTER}))];
    let c = cash_management_counts(Some((&rows, MINTER)), None, 0);
    assert_eq!((c.escrowed_wire_ins, c.count), (Some(0), 0));
}

#[test]
fn a_minter_chain_counts_open_ramps_and_ignores_pending_review_events() {
    let rows = vec![ramp_opened(1, 1, "BankToUsdc", "10000000")];
    let ev = events(&[pending(1, RAMP, CUSTODY, 1_000_000)]);
    let c = cash_management_counts(Some((&rows, MINTER)), Some(&ev), 0);
    assert_eq!(
        (c.open_ramps, c.pending_ramp_events, c.count),
        (Some(1), None, 1)
    );
}

#[test]
fn a_chain_without_a_minter_counts_pending_review_events() {
    let ev = events(&[pending(1, RAMP, CUSTODY, 1_000_000)]);
    let c = cash_management_counts(None, Some(&ev), 0);
    assert_eq!(
        (c.open_ramps, c.pending_ramp_events, c.count),
        (None, Some(1), 1)
    );
}

#[test]
fn a_chain_entry_counts_pending_bank_deposits_in_its_count() {
    let c = cash_management_counts(None, None, 4);
    assert_eq!((c.pending_bank_deposits, c.count), (4, 4));
}

#[test]
fn combined_pending_bank_deposits_are_added_to_the_count_once() {
    let a = chain_entry(1, cash_management_counts(None, None, 4), None, 0);
    let b = chain_entry(2, cash_management_counts(None, None, 4), None, 0);
    let resp = build_response(vec![a, b]);
    assert_eq!(resp.cash_management.pending_bank_deposits, 4);
    assert_eq!(resp.cash_management.count, 4);
    assert!(resp.chains.iter().all(|c| c.cash_management.count == 4));
}

#[test]
fn without_a_minter_only_ramp_events_count() {
    let ev = events(&[
        pending(1, RAMP, CUSTODY, 1_000_000),
        pending(2, CUSTODY, RAMP, 1_000_000),
    ]);
    let c = cash_management_counts(None, Some(&ev), 0);
    assert_eq!(c.escrowed_wire_ins, None);
    assert_eq!(c.pending_wire_outs, None);
    assert_eq!(c.open_ramps, None);
    assert_eq!(c.pending_ramp_events, Some(2));
    assert_eq!(c.count, 2);
}

#[test]
fn all_sources_absent_is_zero_with_null_terms() {
    let c = cash_management_counts(None, None, 0);
    assert_eq!(c.count, 0);
    assert_eq!(c.pending_ramp_events, None);
    assert_eq!(c.open_ramps, None);
}

fn chain_entry(
    id: i64,
    cash: pipeline_api::routes::attention_counts::CashManagementCounts,
    margin: Option<i64>,
    sub: i64,
) -> ChainAttentionCounts {
    let origination = origination_counts(id, &[sub_row(id, sub, 0, 0)]);
    let mut loans = lc(&[], &HashMap::new(), NO_MARGINS, NOW);
    loans.margin_call_open = margin;
    ChainAttentionCounts {
        chain_id: id,
        origination,
        loans,
        cash_management: cash,
    }
}

#[test]
fn the_union_sums_chains_and_adds_bank_deposits_once() {
    let rows = vec![wire_in(1, 1, MINTER)];
    let stellar_cash = cash_management_counts(Some((&rows, MINTER)), None, 3);
    let evm_events = events(&[pending(1, RAMP, CUSTODY, 1_000_000)]);
    let evm_cash = cash_management_counts(None, Some(&evm_events), 3);
    let resp = build_response(vec![
        chain_entry(STELLAR.chain_id, stellar_cash, Some(2), 2),
        chain_entry(EVM.chain_id, evm_cash, None, 1),
    ]);
    assert_eq!(resp.origination.count, 3);
    assert_eq!(resp.loans.margin_call_open, Some(2));
    assert_eq!(resp.cash_management.escrowed_wire_ins, Some(1));
    assert_eq!(resp.cash_management.pending_ramp_events, Some(1));
    assert_eq!(resp.cash_management.pending_bank_deposits, 3);
    assert_eq!(resp.cash_management.count, 1 + 1 + 3);
    assert_eq!(resp.chains[0].cash_management.count, 4);
    assert_eq!(resp.chains[1].cash_management.count, 4);
}

#[test]
fn a_nullable_field_is_null_only_when_every_chain_is_null() {
    let a = chain_entry(1, cash_management_counts(None, None, 0), None, 0);
    let b = chain_entry(2, cash_management_counts(None, None, 0), None, 0);
    let resp = build_response(vec![a, b]);
    assert_eq!(resp.loans.margin_call_open, None);
    assert_eq!(resp.cash_management.open_ramps, None);
    assert_eq!(resp.cash_management.escrowed_wire_ins, None);
}

#[test]
fn an_empty_chain_list_is_zero_counts_with_null_fields() {
    let resp = build_response(Vec::new());
    assert_eq!(resp.origination.count, 0);
    assert_eq!(resp.loans.count, 0);
    assert_eq!(resp.cash_management.count, 0);
    assert_eq!(resp.loans.margin_call_open, None);
    assert!(resp.chains.is_empty());
}

#[test]
fn chains_keep_their_input_order() {
    let a = chain_entry(99_000_001, cash_management_counts(None, None, 0), None, 0);
    let b = chain_entry(560_048, cash_management_counts(None, None, 0), None, 0);
    let resp = build_response(vec![a, b]);
    let ids: Vec<i64> = resp.chains.iter().map(|c| c.chain_id).collect();
    assert_eq!(ids, vec![99_000_001, 560_048]);
}

#[test]
fn the_json_shape_has_exact_keys_and_explicit_nulls() {
    let entry = chain_entry(560_048, cash_management_counts(None, None, 2), None, 1);
    let v = serde_json::to_value(build_response(vec![entry])).unwrap();
    assert_eq!(
        v,
        json!({
            "origination": {"count": 1, "in_review": 1, "changes_requested": 0, "approved_undrawn": 0},
            "loans": {"count": 0, "watch_list": 0, "past_due": 0, "margin_call_open": null, "disbursing": 0, "defaulted": 0},
            "cash_management": {"count": 2, "escrowed_wire_ins": null, "pending_wire_outs": null, "open_ramps": null, "pending_ramp_events": null, "pending_bank_deposits": 2},
            "chains": [{
                "chain_id": 560_048,
                "origination": {"count": 1, "in_review": 1, "changes_requested": 0, "approved_undrawn": 0},
                "loans": {"count": 0, "watch_list": 0, "past_due": 0, "margin_call_open": null, "disbursing": 0, "defaulted": 0},
                "cash_management": {"count": 2, "escrowed_wire_ins": null, "pending_wire_outs": null, "open_ramps": null, "pending_ramp_events": null, "pending_bank_deposits": 2}
            }]
        })
    );
}

fn claims(roles: &[&str]) -> Claims {
    Claims {
        sub: "sub".to_owned(),
        chain_id: None,
        account_id: uuid::Uuid::nil(),
        roles: roles.iter().map(|r| (*r).to_owned()).collect(),
        exp: 0,
        iat: 0,
    }
}

fn uri(q: &str) -> axum::http::Uri {
    format!("/v1/attention-counts{q}").parse().unwrap()
}

#[test]
fn a_non_trustee_gets_403_with_or_without_a_chain_id() {
    let chains = [EVM, STELLAR];
    for q in ["", "?chain_id=99000001", "?chain_id=abc", "?chain_id=5"] {
        let err = authorize(&claims(&[]), &uri(q), &chains).unwrap_err();
        assert!(matches!(err, ApiError::Forbidden(_)), "{q}: {err:?}");
    }
}

#[test]
fn a_trustee_with_a_malformed_or_repeated_chain_id_gets_400() {
    let chains = [EVM, STELLAR];
    for q in ["?chain_id=abc", "?chain_id=1&chain_id=2", "?chain_id="] {
        let err = authorize(&claims(&["trustee"]), &uri(q), &chains).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(_)), "{q}: {err:?}");
    }
}

#[test]
fn scope_resolves_all_one_and_unconfigured() {
    let chains = [EVM, STELLAR];
    let t = claims(&["trustee"]);
    assert_eq!(authorize(&t, &uri(""), &chains).unwrap(), ChainScope::All);
    assert_eq!(
        authorize(&t, &uri("?chain_id=99000001"), &chains).unwrap(),
        ChainScope::One(STELLAR)
    );
    assert_eq!(
        authorize(&t, &uri("?chain_id=5"), &chains).unwrap(),
        ChainScope::Unconfigured(5)
    );
}

#[tokio::test]
async fn a_request_without_a_token_is_401_before_any_database_access() {
    let app = attention_counts::router().with_state(Arc::new(make_test_state()));
    let req = Request::builder()
        .method(Method::GET)
        .uri("/attention-counts")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

fn openapi_json() -> serde_json::Value {
    serde_json::to_value(AttentionCountsDoc::openapi()).expect("a serializable document")
}

#[test]
fn the_path_is_documented_with_an_optional_chain_id_and_bearer_security() {
    let doc = openapi_json();
    let get = &doc["paths"]["/v1/attention-counts"]["get"];
    assert!(get.is_object());
    let chain = get["parameters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "chain_id")
        .expect("chain_id parameter");
    assert_eq!(chain["required"], false);
    assert!(get["security"].to_string().contains("bearer_auth"));
    for status in ["200", "400", "401", "403", "500"] {
        assert!(get["responses"].get(status).is_some(), "missing {status}");
    }
}

#[test]
fn the_response_schemas_are_registered() {
    let doc = openapi_json();
    for name in [
        "AttentionCountsResponse",
        "ChainAttentionCounts",
        "OriginationCounts",
        "LoanCounts",
        "CashManagementCounts",
    ] {
        assert!(
            doc["components"]["schemas"].get(name).is_some(),
            "missing {name}"
        );
    }
}
