//! Parse JSON-encoded numeric strings into Rust types with helpful error context.
//!
//! Off-chain JSON documents (e.g. the metadata JSON fetched by `MetadataFetcher`) often
//! encode `uint256` and other numeric values as decimal strings because they exceed
//! `Number.MAX_SAFE_INTEGER`. These helpers centralise the "parse + reject malformed"
//! pattern so every consumer rejects the same set of bad inputs the same way.

use std::str::FromStr;

use alloy_primitives::U256;
use bigdecimal::BigDecimal;

/// Parse a JSON decimal string into `BigDecimal` for binding to `NUMERIC(78,0)`.
///
/// Rejects values containing a decimal point — those columns are integer-only
/// (Solidity `uint256` representation).
pub fn parse_numeric(field: &str, value: &str) -> anyhow::Result<BigDecimal> {
    if value.contains('.') {
        anyhow::bail!("{field}: NUMERIC(78,0) field must not contain a decimal point: {value}");
    }
    BigDecimal::from_str(value)
        .map_err(|e| anyhow::anyhow!("{field}: invalid uint256 string `{value}`: {e}"))
}

/// Parse a JSON decimal string into `i64` with field-tagged error context.
pub fn parse_i64(field: &str, value: &str) -> anyhow::Result<i64> {
    value
        .parse::<i64>()
        .map_err(|e| anyhow::anyhow!("{field}: invalid i64 `{value}`: {e}"))
}

/// Parse a JSON decimal string into `i32` with field-tagged error context.
pub fn parse_i32(field: &str, value: &str) -> anyhow::Result<i32> {
    value
        .parse::<i32>()
        .map_err(|e| anyhow::anyhow!("{field}: invalid i32 `{value}`: {e}"))
}

/// Convert an alloy `U256` to a `BigDecimal`.
///
/// Goes through the U256 decimal string representation. Panics if the
/// conversion fails — this should be impossible since `U256::to_string()`
/// always produces a valid decimal literal.
pub fn u256_to_bigdecimal(v: U256) -> BigDecimal {
    BigDecimal::from_str(&v.to_string()).expect("U256 stringifies to a valid decimal")
}

/// Convert a `BigDecimal` (typically loaded from a `NUMERIC(78,0)` column) to
/// an alloy `U256`.
///
/// Panics if the conversion fails — `NUMERIC(78,0)` values always fit in
/// `U256` and never contain a fractional component. A failure here indicates
/// data corruption.
pub fn bigdecimal_to_u256(bd: &BigDecimal) -> U256 {
    let s = bd.to_plain_string();
    U256::from_str(&s).expect("NUMERIC(78,0) BigDecimal; always fits in U256")
}
