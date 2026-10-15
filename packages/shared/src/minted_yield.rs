// spec: docs/references/backend.md#minted-yield
use bigdecimal::BigDecimal;

use crate::chains::{normalize_usdc_amount, ChainKind};
use crate::contract_logs_repo::RepaymentMintRow;

pub fn is_live_at(row: &RepaymentMintRow, as_of: i64) -> bool {
    row.block_timestamp <= as_of && row.reversed_at.is_none_or(|t| t > as_of)
}

pub fn net_repayment_minted_raw(rows: &[RepaymentMintRow], as_of: i64) -> BigDecimal {
    rows.iter()
        .filter(|r| is_live_at(r, as_of))
        .map(|r| &r.interest_minted + r.fee_amount.clone().unwrap_or_default())
        .sum()
}

pub fn loan_minted_yield(
    kind: ChainKind,
    legacy_raw: &BigDecimal,
    rows: &[RepaymentMintRow],
    as_of: i64,
) -> BigDecimal {
    normalize_usdc_amount(kind, &(legacy_raw + net_repayment_minted_raw(rows, as_of)))
}
