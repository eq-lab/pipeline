// spec: docs/references/backend.md#minted-yield
use bigdecimal::BigDecimal;
use shared::chains::ChainKind;
use shared::contract_logs_repo::RepaymentMintRow;
use shared::minted_yield::{loan_minted_yield, net_repayment_minted_raw};

fn bd(n: i64) -> BigDecimal {
    BigDecimal::from(n)
}

fn row(
    ts: i64,
    interest: i64,
    fee_amount: Option<i64>,
    reversed_at: Option<i64>,
) -> RepaymentMintRow {
    RepaymentMintRow {
        loan_id: bd(1),
        repayment_id: bd(0),
        block_timestamp: ts,
        interest_minted: bd(interest),
        fee_amount: fee_amount.map(bd),
        reversed_at,
        defaulted_at: None,
    }
}

const FAR: i64 = i64::MAX;

#[test]
fn evm_legacy_only() {
    assert_eq!(
        loan_minted_yield(ChainKind::Evm, &bd(40_000_000), &[], FAR),
        bd(40_000_000)
    );
}

#[test]
fn evm_live_repayment_adds_payment_recorded_fees() {
    let rows = [row(10, 50_000_000, Some(50_000_000), None)];
    assert_eq!(
        loan_minted_yield(ChainKind::Evm, &bd(0), &rows, FAR),
        bd(100_000_000)
    );
}

#[test]
fn evm_legacy_and_minter_legs_combine() {
    let rows = [row(10, 50_000_000, Some(50_000_000), None)];
    assert_eq!(
        loan_minted_yield(ChainKind::Evm, &bd(40_000_000), &rows, FAR),
        bd(140_000_000)
    );
}

#[test]
fn stellar_sums_raw_then_normalises_once() {
    let rows = [row(10, 500_000_005, Some(5), None)];
    assert_eq!(
        loan_minted_yield(ChainKind::Stellar, &bd(0), &rows, FAR),
        bd(50_000_001)
    );
    assert_eq!(
        loan_minted_yield(ChainKind::Stellar, &bd(5), &rows, FAR),
        bd(50_000_001)
    );
    assert_eq!(
        loan_minted_yield(ChainKind::Stellar, &bd(10), &rows, FAR),
        bd(50_000_002)
    );
}

#[test]
fn reversal_excludes_from_its_timestamp_only() {
    let rows = [row(10, 100, Some(0), Some(50))];
    assert_eq!(net_repayment_minted_raw(&rows, 49), bd(100));
    assert_eq!(net_repayment_minted_raw(&rows, 50), bd(0));
    assert_eq!(net_repayment_minted_raw(&rows, FAR), bd(0));
}

#[test]
fn repayment_after_as_of_is_excluded() {
    let rows = [row(100, 100, Some(0), None)];
    assert_eq!(net_repayment_minted_raw(&rows, 99), bd(0));
    assert_eq!(net_repayment_minted_raw(&rows, 100), bd(100));
}

#[test]
fn null_fee_amount_counts_zero_fees() {
    let rows = [
        row(10, 100, None, None),
        row(11, 100, Some(0), None),
        row(12, 100, None, Some(20)),
    ];
    assert_eq!(net_repayment_minted_raw(&rows, 11), bd(200));
}

#[test]
fn reversed_repayment_drops_interest_and_fees() {
    let rows = [row(10, 100, Some(40), Some(50))];
    assert_eq!(net_repayment_minted_raw(&rows, 49), bd(140));
    assert_eq!(net_repayment_minted_raw(&rows, FAR), bd(0));
}

#[test]
fn multiple_repayments_one_reversed() {
    let rows = [
        row(10, 100, Some(20), None),
        row(20, 1_000, Some(200), Some(30)),
        row(40, 10, Some(0), None),
    ];
    assert_eq!(net_repayment_minted_raw(&rows, FAR), bd(130));
}
