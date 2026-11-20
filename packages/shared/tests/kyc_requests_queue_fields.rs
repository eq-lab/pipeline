use bigdecimal::BigDecimal;
use shared::chains::ChainKind;
use shared::kyc_repo::{all_requests_sql, GroupedRequest, RequestEventRow};
use std::str::FromStr;

fn dec(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).unwrap()
}

fn row(chain_id: i64, event_name: &str, amount: &str, is_claimed: bool) -> RequestEventRow {
    RequestEventRow {
        chain_id,
        event_name: event_name.to_owned(),
        request_id: Some(dec("7")),
        amount: Some(dec(amount)),
        assets: None,
        shares: None,
        kyt_status: Some(1),
        block_timestamp: 1_700_000_000,
        is_claimed,
        on_chain_allowed: true,
        queued: None,
        claim_block_number: None,
        claim_log_index: None,
        rate_set_rate: None,
    }
}

fn golden_rows() -> Vec<RequestEventRow> {
    vec![
        row(560_048, "WithdrawalRequested", "5000000", false),
        row(560_048, "WithdrawalRequested", "5000000", true),
        row(560_048, "DepositRequested", "1000000", false),
        RequestEventRow {
            assets: Some(dec("2000000")),
            shares: Some(dec("1900000")),
            ..row(560_048, "StakingDeposit", "2000000", true)
        },
        row(99_000_001, "DepositRequested", "10000000", false),
    ]
}

const GOLDEN: [&str; 5] = [
    r#"{"chain_id":560048,"type":"Withdraw","request_id":"7","amount":"5000000","status":"PendingClaim","created_at":"2023-11-14T22:13:20Z"}"#,
    r#"{"chain_id":560048,"type":"Withdraw","request_id":"7","amount":"5000000","status":"Completed","created_at":"2023-11-14T22:13:20Z"}"#,
    r#"{"chain_id":560048,"type":"Deposit","request_id":"7","amount":"1000000","status":"PendingClaim","created_at":"2023-11-14T22:13:20Z"}"#,
    r#"{"chain_id":560048,"type":"Stake","request_id":"7","amount":"2000000","assets":"2000000","shares":"1900000","status":"Completed","created_at":"2023-11-14T22:13:20Z"}"#,
    r#"{"chain_id":99000001,"type":"Deposit","request_id":"7","amount":"10000000","status":"PendingClaim","created_at":"2023-11-14T22:13:20Z"}"#,
];

#[test]
fn golden_existing_rows_serialize_byte_identically() {
    let out: Vec<String> = golden_rows()
        .into_iter()
        .map(|r| {
            let kind = if r.chain_id == 99_000_001 {
                ChainKind::Stellar
            } else {
                ChainKind::Evm
            };
            serde_json::to_string(&GroupedRequest::from_row(r, false, Some(kind))).unwrap()
        })
        .collect();
    assert_eq!(out, GOLDEN);
}

fn stellar_withdraw(is_claimed: bool) -> RequestEventRow {
    RequestEventRow {
        queued: Some(dec("31875000000")),
        ..row(99_000_001, "WithdrawalRequested", "100", is_claimed)
    }
}

fn with_claim(row: RequestEventRow, block: i64, idx: i64) -> RequestEventRow {
    RequestEventRow {
        claim_block_number: Some(block),
        claim_log_index: Some(idx),
        ..row
    }
}

fn with_rate_set(row: RequestEventRow, rate: i64) -> RequestEventRow {
    RequestEventRow {
        rate_set_rate: Some(BigDecimal::from(rate)),
        ..row
    }
}

fn stellar(r: RequestEventRow) -> GroupedRequest {
    GroupedRequest::from_row(r, false, Some(ChainKind::Stellar))
}

#[test]
fn unclaimed_stellar_withdraw_has_queued_through_and_no_usdc_paid() {
    let g = stellar(stellar_withdraw(false));
    assert_eq!(g.queued_through.as_deref(), Some("31875000000"));
    assert_eq!(g.usdc_paid, None);
    assert_eq!(g.amount, "100");
}

#[test]
fn queued_through_is_rendered_plain_never_scientific() {
    let r = RequestEventRow {
        queued: Some(dec("20000000000000000")),
        ..stellar_withdraw(false)
    };
    assert_eq!(
        stellar(r).queued_through.as_deref(),
        Some("20000000000000000")
    );
}

#[test]
fn usdc_paid_is_rendered_plain_for_large_amounts() {
    let r = RequestEventRow {
        amount: Some(dec("20000000000000000")),
        ..with_claim(stellar_withdraw(true), 50, 0)
    };
    assert_eq!(stellar(r).usdc_paid.as_deref(), Some("20000000000000000"));
}

#[test]
fn claimed_without_rate_set_pays_the_amount() {
    let g = stellar(with_claim(stellar_withdraw(true), 50, 0));
    assert_eq!(g.usdc_paid.as_deref(), Some("100"));
    assert_eq!(g.status, "Completed");
}

#[test]
fn claimed_with_a_rate_in_force_pays_the_floored_rate() {
    let r = with_rate_set(with_claim(stellar_withdraw(true), 50, 0), 850_000);
    assert_eq!(stellar(r).usdc_paid.as_deref(), Some("85"));
    let odd = RequestEventRow {
        amount: Some(dec("7")),
        ..with_rate_set(with_claim(stellar_withdraw(true), 50, 0), 850_000)
    };
    assert_eq!(stellar(odd).usdc_paid.as_deref(), Some("5"));
}

#[test]
fn unclaimed_row_never_gets_usdc_paid_even_with_a_rate() {
    let r = with_rate_set(stellar_withdraw(false), 850_000);
    assert_eq!(stellar(r).usdc_paid, None);
}

#[test]
fn stellar_non_withdraw_rows_get_no_new_fields() {
    for event in ["DepositRequested", "StakingDeposit", "StakingWithdrawal"] {
        let r = RequestEventRow {
            queued: Some(dec("5")),
            ..with_rate_set(
                with_claim(row(99_000_001, event, "100", true), 50, 0),
                850_000,
            )
        };
        let g = stellar(r);
        assert_eq!(g.queued_through, None);
        assert_eq!(g.usdc_paid, None);
    }
}

#[test]
fn evm_withdraw_with_queue_columns_serializes_like_the_golden() {
    let r = RequestEventRow {
        queued: Some(dec("999")),
        ..with_rate_set(
            with_claim(row(560_048, "WithdrawalRequested", "5000000", true), 50, 0),
            850_000,
        )
    };
    let json =
        serde_json::to_string(&GroupedRequest::from_row(r, false, Some(ChainKind::Evm))).unwrap();
    assert_eq!(json, GOLDEN[1]);
}

#[test]
fn unconfigured_chain_gets_no_new_fields() {
    let r = with_rate_set(with_claim(stellar_withdraw(true), 50, 0), 850_000);
    let g = GroupedRequest::from_row(r, false, None);
    assert_eq!(g.queued_through, None);
    assert_eq!(g.usdc_paid, None);
}

fn norm(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn requests_sql_claim_lateral_is_scoped_and_earliest_first() {
    let sql = norm(&all_requests_sql(true, false));
    assert!(sql.contains("FROM contract_logs c3 WHERE c3.chain_id = r.chain_id AND c3.contract_address = r.contract_address AND c3.event_name = 'RequestClaimed' AND c3.params->>'request_id' = r.params->>'request_id' ORDER BY c3.block_number, c3.log_index LIMIT 1"), "{sql}");
    assert!(
        sql.contains("(claim.block_number IS NOT NULL) AS is_claimed"),
        "{sql}"
    );
    assert!(!sql.contains("c2."), "{sql}");
}

#[test]
fn requests_sql_rate_lateral_is_latest_valid_rate_strictly_before_the_claim() {
    let sql = norm(&all_requests_sql(true, false));
    assert!(sql.contains("FROM contract_logs s WHERE r.event_name = 'WithdrawalRequested' AND claim.block_number IS NOT NULL AND s.chain_id = r.chain_id AND s.contract_address = r.contract_address AND s.event_name = 'WithdrawalRateSet' AND s.params ? 'new_rate' AND (s.block_number, s.log_index::bigint) < (claim.block_number, claim.log_index) ORDER BY s.block_number DESC, s.log_index DESC LIMIT 1"), "{sql}");
}

#[test]
fn requests_sql_pending_filter_uses_the_claim_lookup() {
    let pending = norm(&all_requests_sql(false, true));
    assert!(pending.contains("AND claim.block_number IS NULL AND r.event_name NOT IN ('StakingDeposit', 'StakingWithdrawal') ORDER BY"), "{pending}");
    assert!(!pending.contains("r.chain_id = $2"), "{pending}");
    assert!(norm(&all_requests_sql(true, false)).contains("AND r.chain_id = $2"));
}
