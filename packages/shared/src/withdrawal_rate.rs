// spec: docs/product-specs/withdrawals.md#stellar-queue-read-model-1791
use bigdecimal::{BigDecimal, RoundingMode};

pub const RATE_ONE: i64 = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct LogPosition {
    pub block_number: i64,
    pub log_index: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RateSetPoint {
    pub contract_address: String,
    pub position: LogPosition,
    pub new_rate: BigDecimal,
}

pub fn rate_one() -> BigDecimal {
    BigDecimal::from(RATE_ONE)
}

pub fn convert_to_assets(amount: &BigDecimal, rate: &BigDecimal) -> BigDecimal {
    (amount * rate / rate_one()).with_scale_round(0, RoundingMode::Down)
}

pub fn rate_at_claim(
    claim: LogPosition,
    rate_set: Option<(LogPosition, &BigDecimal)>,
) -> BigDecimal {
    match rate_set {
        Some((position, rate)) if position < claim => rate.clone(),
        _ => rate_one(),
    }
}

pub fn current_rate(rate_sets: &[RateSetPoint], scope: Option<&str>) -> BigDecimal {
    rate_sets
        .iter()
        .filter(|p| scope.is_none_or(|s| p.contract_address == s))
        .max_by_key(|p| p.position)
        .map_or_else(rate_one, |p| p.new_rate.clone())
}
