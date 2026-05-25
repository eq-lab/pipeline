//! Parse JSON-encoded numeric strings into Rust types with helpful error context.
//!
//! Off-chain JSON documents (e.g. the metadata JSON fetched by `MetadataFetcher`) often
//! encode `uint256` and other numeric values as decimal strings because they exceed
//! `Number.MAX_SAFE_INTEGER`. These helpers centralise the "parse + reject malformed"
//! pattern so every consumer rejects the same set of bad inputs the same way.

use std::str::FromStr;

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
