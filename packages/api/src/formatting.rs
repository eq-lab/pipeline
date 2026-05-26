//! Shared response-formatting helpers used across the API surface.
//!
//! Centralised here so endpoint modules agree on JSON conventions for timestamps
//! and monetary values without duplicating format strings.

use std::sync::LazyLock;

use bigdecimal::{BigDecimal, RoundingMode};
use chrono::{DateTime, TimeZone, Utc};

/// Canonical ISO-8601 UTC format string used by every JSON response in the API.
const ISO_8601_UTC: &str = "%Y-%m-%dT%H:%M:%SZ";

/// 10^6 — the divisor used to convert 6-decimal base units to dollar units.
/// Cached once so hot loops (e.g. portfolio yield's per-sample formatting) don't
/// re-allocate a `BigInt` per call.
static USDC_BASE_DIVISOR: LazyLock<BigDecimal> = LazyLock::new(|| BigDecimal::from(1_000_000_i64));

/// Format a `DateTime<Utc>` as ISO-8601, e.g. `"2026-05-26T00:00:00Z"`.
pub fn iso_utc(dt: &DateTime<Utc>) -> String {
    dt.format(ISO_8601_UTC).to_string()
}

/// Format a unix-seconds value as ISO-8601 UTC. Falls back to the raw integer
/// rendered as a string for out-of-range timestamps.
pub fn iso_utc_from_unix(t: i64) -> String {
    Utc.timestamp_opt(t, 0)
        .single()
        .map_or_else(|| t.to_string(), |dt| iso_utc(&dt))
}

/// Convert a 6-decimal base-unit BigDecimal (e.g. USDC stored in `loan_details`)
/// to a 6-decimal dollar-units string, e.g. `986_301_369` → `"986.301369"`.
/// Truncates any sub-base-unit fractions toward zero.
pub fn base6_to_decimal_string(base_units: &BigDecimal) -> String {
    (base_units / &*USDC_BASE_DIVISOR)
        .with_scale_round(6, RoundingMode::Down)
        .to_plain_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_utc_formats_epoch() {
        let dt = Utc.timestamp_opt(0, 0).single().unwrap();
        assert_eq!(iso_utc(&dt), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn iso_utc_formats_known_instant() {
        let dt = Utc.with_ymd_and_hms(2026, 5, 26, 0, 0, 0).single().unwrap();
        assert_eq!(iso_utc(&dt), "2026-05-26T00:00:00Z");
    }

    #[test]
    fn iso_utc_from_unix_agrees_with_iso_utc() {
        // The two helpers must agree on the canonical format string. Combined with
        // `iso_utc_formats_known_instant`, this transitively pins `iso_utc_from_unix`.
        let dt = Utc
            .with_ymd_and_hms(2026, 5, 26, 12, 34, 56)
            .single()
            .unwrap();
        assert_eq!(iso_utc(&dt), iso_utc_from_unix(dt.timestamp()));
    }

    #[test]
    fn base6_to_decimal_string_six_dp_exact() {
        assert_eq!(
            base6_to_decimal_string(&BigDecimal::from(986_301_369_i64)),
            "986.301369"
        );
    }

    #[test]
    fn base6_to_decimal_string_zero() {
        assert_eq!(
            base6_to_decimal_string(&BigDecimal::from(0_i64)),
            "0.000000"
        );
    }

    #[test]
    fn base6_to_decimal_string_truncates_toward_zero() {
        // 0.5 base units → 0.0000005 USDC → truncated to "0.000000".
        let half_base = BigDecimal::from(1_i64) / BigDecimal::from(2_i64);
        assert_eq!(base6_to_decimal_string(&half_base), "0.000000");
    }
}
