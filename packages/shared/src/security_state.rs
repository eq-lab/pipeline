// spec: docs/product-specs/loan-security-state.md#computed-fields
use bigdecimal::num_bigint::{BigInt, Sign};
use bigdecimal::{BigDecimal, RoundingMode, ToPrimitive};

pub const UNIT: i128 = 10_000_000;
pub const BPS_ONE: u128 = 10_000;
pub const U32_MAX_BPS: u32 = u32::MAX;

const MAX_DECIMAL_SCALE: i64 = 20_000;
const MIN_DECIMAL_SCALE: i64 = -40;

pub fn ltv_bps(debt: u128, value: i128) -> u32 {
    if debt == 0 {
        return 0;
    }
    let Ok(value) = u128::try_from(value) else {
        return U32_MAX_BPS;
    };
    if value == 0 {
        return U32_MAX_BPS;
    }
    match debt.checked_mul(BPS_ONE) {
        Some(n) => u32::try_from(n.div_ceil(value)).unwrap_or(U32_MAX_BPS),
        None => U32_MAX_BPS,
    }
}

pub fn coverage_bps(debt: u128, value: i128) -> u32 {
    let value = u128::try_from(value).unwrap_or(0);
    match value.checked_mul(BPS_ONE).and_then(|n| n.checked_div(debt)) {
        Some(bps) => u32::try_from(bps).unwrap_or(U32_MAX_BPS),
        None => U32_MAX_BPS,
    }
}

pub fn counts_toward_value(status: &str, protection: &str) -> bool {
    status == "Active" && protection != "InsuranceLossPayee"
}

pub fn is_open_status(status: &str) -> bool {
    !matches!(status, "Released" | "Enforced")
}

pub fn is_in_storage(protection: &str) -> bool {
    matches!(protection, "WarehousePledge" | "CollateralManagement")
}

pub fn attestation_stale(now: u64, attested_at: u64, interval: u64) -> bool {
    interval != 0 && now.saturating_sub(attested_at) > interval
}

pub fn inspection_stale(
    now: u64,
    protection: &str,
    perfected_at: u64,
    lot_latest_inspected_at: Option<u64>,
    interval: u64,
) -> bool {
    let checked_at = lot_latest_inspected_at.unwrap_or(perfected_at);
    is_in_storage(protection) && interval != 0 && now.saturating_sub(checked_at) > interval
}

pub fn mark_stale(now: u64, is_goods: bool, mark_at: Option<u64>, price_stale_after: u64) -> bool {
    if !is_goods {
        return false;
    }
    match mark_at {
        None => true,
        Some(at) => price_stale_after != 0 && now.saturating_sub(at) > price_stale_after,
    }
}

pub fn mark_age(now: u64, counted_goods_mark_ats: &[Option<u64>]) -> u64 {
    let mut oldest: Option<u64> = None;
    for mark_at in counted_goods_mark_ats {
        match mark_at {
            None => return u64::MAX,
            Some(at) => oldest = Some(oldest.map_or(*at, |o| o.min(*at))),
        }
    }
    oldest.map_or(0, |at| now.saturating_sub(at))
}

pub fn price_stale(mark_age: u64, price_stale_after: u64, any_unmarked: bool) -> bool {
    any_unmarked || (price_stale_after != 0 && mark_age > price_stale_after)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CountedTerm {
    pub record_id: u32,
    pub goods: bool,
    pub counted_quantity: i128,
    pub value_per_unit: i128,
}

fn term_numerator(t: &CountedTerm) -> Option<i128> {
    if t.goods {
        t.counted_quantity.checked_mul(t.value_per_unit)
    } else {
        t.counted_quantity.checked_mul(UNIT)
    }
}

pub fn counted_value_excluding(terms: &[CountedTerm], exclude: u32) -> Option<i128> {
    let mut sum: i128 = 0;
    for t in terms.iter().filter(|t| t.record_id != exclude) {
        sum = sum.checked_add(term_numerator(t)?)?;
    }
    Some(sum / UNIT)
}

pub fn record_term_value(t: &CountedTerm) -> Option<i128> {
    term_numerator(t).map(|n| n / UNIT)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentRelease {
    Allowed,
    NeedsConsent,
}

impl AgentRelease {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Allowed => "allowed",
            Self::NeedsConsent => "needs_consent",
        }
    }
}

pub fn release_unconditional(status: &str, protection: &str, outstanding: Option<u128>) -> bool {
    status == "PendingPerfection" || protection == "InsuranceLossPayee" || outstanding == Some(0)
}

pub fn agent_release(
    status: &str,
    protection: &str,
    outstanding: u128,
    accrued: u128,
    terms: &[CountedTerm],
    record_id: u32,
    advance_ratio_bps: u32,
) -> AgentRelease {
    if release_unconditional(status, protection, Some(outstanding)) {
        return AgentRelease::Allowed;
    }
    let (Some(debt), Some(value)) = (
        outstanding.checked_add(accrued),
        counted_value_excluding(terms, record_id),
    ) else {
        return AgentRelease::NeedsConsent;
    };
    if ltv_bps(debt, value) <= advance_ratio_bps {
        AgentRelease::Allowed
    } else {
        AgentRelease::NeedsConsent
    }
}

pub fn cure_by(
    margin_call_at: u64,
    open_events: &[(u64, u64)],
    snapshot: Option<(u64, u64)>,
) -> (Option<u64>, Option<&'static str>) {
    if margin_call_at == 0 {
        return (None, None);
    }
    if let Some((_, cure_by)) = open_events
        .iter()
        .rev()
        .find(|(opened_at, _)| *opened_at == margin_call_at)
    {
        return (Some(*cure_by), Some("event"));
    }
    match snapshot {
        Some((at, cure_by)) if at == margin_call_at => (Some(cure_by), Some("coverage_detail")),
        _ => (None, None),
    }
}

pub fn dec_to_integer(d: &BigDecimal) -> Option<BigInt> {
    let (int, scale) = d.as_bigint_and_exponent();
    match scale {
        0 => Some(int),
        MIN_DECIMAL_SCALE..=-1 => {
            let shift = u32::try_from(-scale).ok()?;
            Some(int * BigInt::from(10u8).pow(shift))
        }
        1..=MAX_DECIMAL_SCALE => Some(
            d.with_scale_round(0, RoundingMode::Down)
                .as_bigint_and_exponent()
                .0,
        ),
        _ => None,
    }
}

pub fn dec_to_i128(d: &BigDecimal) -> Option<i128> {
    dec_to_integer(d)?.to_i128()
}

pub fn dec_to_u128(d: &BigDecimal) -> Option<u128> {
    dec_to_integer(d)?.to_u128()
}

pub fn dec_to_u64(d: &BigDecimal) -> Option<u64> {
    dec_to_integer(d)?.to_u64()
}

pub fn integer_string(d: &BigDecimal) -> Option<String> {
    dec_to_integer(d).map(|i| i.to_string())
}

pub fn format_7dp_i128(raw: i128) -> String {
    let abs = raw.unsigned_abs();
    let unit = UNIT.unsigned_abs();
    let sign = if raw < 0 { "-" } else { "" };
    format!("{sign}{}.{:07}", abs / unit, abs % unit)
}

pub fn format_7dp(raw: &BigDecimal) -> Option<String> {
    let int = dec_to_integer(raw)?;
    let negative = int.sign() == Sign::Minus;
    let digits = int.magnitude().to_string();
    let padded = format!("{digits:0>8}");
    let split = padded.len() - 7;
    let sign = if negative { "-" } else { "" };
    Some(format!("{sign}{}.{}", &padded[..split], &padded[split..]))
}
