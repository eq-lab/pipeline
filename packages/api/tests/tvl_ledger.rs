// spec: docs/product-specs/dashboards-tvl-ledger.md#ledger
use bigdecimal::BigDecimal;

use pipeline_api::routes::dashboard::{
    compute_summary, compute_tvl_history, compute_tvl_series, merge_flows,
};
use shared::chains::ChainKind;
use shared::contract_logs_repo::{normalise_plusd_ledger, PlusdDeltaRow, PLUSD_LEDGER_SQL};

const DAY: i64 = 86_400;

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

fn step(day: i64, log_index: i64, whole: i64) -> PlusdDeltaRow {
    PlusdDeltaRow {
        block_timestamp: day * DAY,
        block_number: day,
        log_index,
        delta: usdc(whole),
    }
}

fn raw(day: i64, log_index: i64, units: i64) -> PlusdDeltaRow {
    PlusdDeltaRow {
        block_timestamp: day * DAY,
        block_number: day,
        log_index,
        delta: BigDecimal::from(units),
    }
}

fn tvl_at(rows: &[PlusdDeltaRow], day: i64) -> String {
    let series = compute_tvl_series(rows, day * DAY, day * DAY, DAY);
    series.last().expect("series").tvl.clone()
}

fn summary_tvl(rows: &[PlusdDeltaRow], to_day: i64) -> String {
    compute_summary(&[], &[], rows, &[], to_day * DAY).tvl
}

// ── The #1631 example ────────────────────────────────────────────────────────

#[test]
fn the_1631_example_is_about_500_and_never_negative() {
    let rows = vec![
        step(0, 0, 1_000),
        step(2, 0, 50),
        step(4, 0, -1_050),
        step(5, 0, 500),
    ];
    let hist = compute_tvl_history(&rows, 0, 6 * DAY, DAY);
    assert_eq!(hist.series.last().expect("point").tvl, "500.000000");
    assert_eq!(summary_tvl(&rows, 6), "500.000000");
    assert_eq!(hist.min, "0.000000");
    for p in &hist.series {
        assert!(!p.tvl.starts_with('-'), "negative TVL at {}", p.timestamp);
    }
}

// ── Rules ────────────────────────────────────────────────────────────────────

#[test]
fn withdrawal_is_subtracted_at_claim_not_at_request() {
    let rows = vec![step(0, 0, 1_000), step(5, 0, -400)];
    assert_eq!(tvl_at(&rows, 3), "1000.000000");
    assert_eq!(tvl_at(&rows, 4), "1000.000000");
    assert_eq!(tvl_at(&rows, 5), "600.000000");
}

#[test]
fn ledger_sql_never_takes_a_delta_from_the_withdrawal_request() {
    assert_eq!(PLUSD_LEDGER_SQL.matches("'WithdrawalRequested'").count(), 1);
    assert!(PLUSD_LEDGER_SQL.contains("q.event_name = 'WithdrawalRequested'"));
}

#[test]
fn pending_deposit_counts_before_any_claim() {
    let rows = vec![step(1, 0, 500)];
    assert_eq!(summary_tvl(&rows, 2), "500.000000");
}

#[test]
fn only_withdrawal_queue_claims_are_ledger_rows_so_deposit_claims_add_nothing() {
    let claim = PLUSD_LEDGER_SQL
        .split("c.event_name = 'RequestClaimed'")
        .nth(1)
        .expect("claim branch");
    let exists = claim.split("UNION ALL").next().expect("branch");
    assert!(exists.contains("EXISTS"));
    assert!(exists.contains("q.contract_address = c.contract_address"));
    assert!(exists.contains("q.event_name = 'WithdrawalRequested'"));
    assert_eq!(PLUSD_LEDGER_SQL.matches("'RequestClaimed'").count(), 1);
}

#[test]
fn reversal_fee_burn_is_limited_to_the_reversals_own_minter() {
    let branch = PLUSD_LEDGER_SQL
        .rsplit("UNION ALL")
        .next()
        .expect("reversal branch");
    assert!(branch.contains("v.event_name = 'CashRepaymentReversed'"));
    assert!(branch.contains("w.event_name = 'StakingWithdrawal'"));
    assert!(branch.contains("w.tx_hash = v.tx_hash"));
    assert!(branch.contains("LOWER(w.params->>'sender') = LOWER(v.contract_address)"));
}

#[test]
fn batched_reversals_each_pair_with_their_own_preceding_burn() {
    let branch = PLUSD_LEDGER_SQL
        .rsplit("UNION ALL")
        .next()
        .expect("reversal branch");
    // Both arms burn before emitting `CashRepaymentReversed`, so a burn belongs to the
    // first reversal after it in the same transaction.
    assert!(branch.contains("w.log_index < v.log_index"));
    assert!(branch.contains("w.log_index > COALESCE(("));
    assert!(branch.contains("v2.event_name = 'CashRepaymentReversed'"));
    assert!(branch.contains("v2.log_index < v.log_index"));
}

#[test]
fn repayment_fee_leg_is_a_keyed_join_not_a_correlated_lateral() {
    assert!(PLUSD_LEDGER_SQL.contains("WITH repayment_fees AS"));
    assert!(PLUSD_LEDGER_SQL.contains("LEFT JOIN repayment_fees pr"));
    assert!(PLUSD_LEDGER_SQL.contains("p.log_index DESC"));
    assert_eq!(PLUSD_LEDGER_SQL.matches("LEFT JOIN LATERAL").count(), 1);
}

#[test]
fn carved_out_interest_stays_until_a_write_down_burns_it() {
    let rows = vec![step(0, 0, 1_000), step(3, 0, 40), step(6, 0, -25)];
    assert_eq!(tvl_at(&rows, 4), "1040.000000");
    assert_eq!(tvl_at(&rows, 5), "1040.000000");
    assert_eq!(tvl_at(&rows, 6), "1015.000000");
}

// ── Every mint / burn path has a ledger source ───────────────────────────────

#[test]
fn every_mint_and_burn_path_has_a_ledger_source() {
    let sources = [
        ("deposit request (pending + claimed)", "'DepositRequested'"),
        ("wire-in mint", "'WireIn'"),
        ("wire-in return burn", "'WireInReturned'"),
        ("wire-out settle burn", "'WireOutSettled'"),
        ("repayment interest + fees mint", "'CashRepaid'"),
        ("repayment fee mint amount", "'PaymentRecorded'"),
        ("repayment reversal burns", "'CashRepaymentReversed'"),
        ("reversal fee-share burn", "'StakingWithdrawal'"),
        ("income mint", "params->>'reason' = 'Income'"),
        ("absorbed loss burn", "'LossAbsorbed'"),
        ("withdrawal claim burn", "c.event_name = 'RequestClaimed'"),
        ("write-down burn", "'LoanWrittenDown'"),
        ("legacy yield mint", "'YieldMinted'"),
    ];
    for (path, needle) in sources {
        assert!(PLUSD_LEDGER_SQL.contains(needle), "{path}: {needle}");
    }
}

#[test]
fn mint_corrected_and_cash_corrected_carry_no_supply_step_of_their_own() {
    assert!(!PLUSD_LEDGER_SQL.contains("'MintCorrected'"));
    assert!(!PLUSD_LEDGER_SQL.contains("'CashCorrected'"));
}

#[test]
fn signed_deltas_of_every_path_sum_into_tvl() {
    let paths: [(&str, i64); 11] = [
        ("deposit", 100),
        ("wire_in", 200),
        ("repay interest + fees", 30),
        ("income", 7),
        ("legacy yield", 3),
        ("wire_in_returned", -50),
        ("wire_out_settled", -20),
        ("wq claim", -60),
        ("loss absorbed", -4),
        ("write-down", -10),
        ("reversal burn", -6),
    ];
    let mut rows = Vec::new();
    let mut expected = 0;
    for (i, (_, amount)) in paths.iter().enumerate() {
        rows.push(step(i as i64, 0, *amount));
        expected += amount;
    }
    assert_eq!(summary_tvl(&rows, 20), format!("{expected}.000000"));
}

// ── Multi-chain normalisation and series ─────────────────────────────────────

#[test]
fn stellar_steps_normalise_by_the_running_total_not_per_event() {
    let rows = normalise_plusd_ledger(
        ChainKind::Stellar,
        vec![raw(0, 0, 15), raw(1, 0, 15), raw(2, 0, -10)],
    );
    let total: BigDecimal = rows.iter().map(|r| r.delta.clone()).sum();
    assert_eq!(total, BigDecimal::from(2));
    assert_eq!(rows[0].delta, BigDecimal::from(1));
    assert_eq!(rows[1].delta, BigDecimal::from(2));
    assert_eq!(rows[2].delta, BigDecimal::from(-1));
}

#[test]
fn evm_steps_are_unchanged_by_normalisation() {
    let input = vec![raw(0, 0, 1_500_000), raw(1, 0, -400_000)];
    assert_eq!(normalise_plusd_ledger(ChainKind::Evm, input.clone()), input);
}

#[test]
fn chains_sum_after_each_is_base_6() {
    let evm = normalise_plusd_ledger(
        ChainKind::Evm,
        vec![raw(0, 0, 100_000_000), raw(4, 0, -40_000_000)],
    );
    let stellar = normalise_plusd_ledger(ChainKind::Stellar, vec![raw(2, 0, 500_000_000)]);
    let merged = merge_flows(vec![evm, stellar]);
    assert_eq!(summary_tvl(&merged, 10), "110.000000");
    let hist = compute_tvl_history(&merged, 0, 10 * DAY, 5 * DAY);
    let points: Vec<&str> = hist.series.iter().map(|p| p.tvl.as_str()).collect();
    assert_eq!(points, ["100.000000", "110.000000", "110.000000"]);
}

#[test]
fn final_series_point_equals_the_summary() {
    let rows = vec![
        step(0, 0, 1_000),
        step(3, 1, 50),
        step(3, 2, -200),
        step(7, 0, 500),
    ];
    let to = 9;
    let hist = compute_tvl_history(&rows, 0, to * DAY, DAY);
    assert_eq!(
        hist.series.last().expect("point").tvl,
        summary_tvl(&rows, to)
    );
    assert_eq!(summary_tvl(&rows, to), "1350.000000");
}

#[test]
fn window_stats_follow_the_ledger_steps() {
    let rows = vec![step(0, 0, 100), step(5, 0, -40), step(8, 0, 40)];
    let hist = compute_tvl_history(&rows, 0, 10 * DAY, DAY);
    assert_eq!(hist.max, "100.000000");
    assert_eq!(hist.min, "60.000000");
}

#[test]
fn empty_ledger_is_zero() {
    assert_eq!(summary_tvl(&[], 1), "0.000000");
    assert!(compute_tvl_series(&[], 0, DAY, DAY).is_empty());
}
