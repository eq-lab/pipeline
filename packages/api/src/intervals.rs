//! Time-bucket enum shared by time-series endpoints.
//!
//! Used by `/v1/stats/yield` (where it maps to a sample step in seconds), and by
//! `/v1/stats/prices` and `/v1/positions/history` (where it maps to a Postgres
//! `DATE_TRUNC` argument). All three deserialize the URL query value
//! `"hourly" | "daily" | "weekly"` into the same type so the public API surface is
//! consistent.

use serde::Deserialize;
use utoipa::ToSchema;

/// Maximum number of time buckets any time-series endpoint will return. Caps
/// `(now - from) / step + 1` and protects against runaway compute on
/// `days = huge` requests: 1_000 daily samples ≈ 2.7 years, 1_000 weekly ≈ 19
/// years, 1_000 hourly ≈ 42 days.
///
/// Shared by `/v1/stats/prices`, `/v1/stats/yield`, and `/v1/positions/history` so the
/// three stay in step — they previously each declared their own copy.
pub const MAX_SAMPLES: i64 = 1_000;

#[derive(Debug, Default, Deserialize, ToSchema, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Interval {
    Hourly,
    #[default]
    Daily,
    Weekly,
}

impl Interval {
    /// Number of seconds in one bucket.
    pub fn step_secs(self) -> i64 {
        match self {
            Self::Hourly => 3_600,
            Self::Daily => 86_400,
            Self::Weekly => 604_800,
        }
    }

    /// Postgres `DATE_TRUNC` field argument.
    pub fn as_pg_trunc(self) -> &'static str {
        match self {
            Self::Hourly => "hour",
            Self::Daily => "day",
            Self::Weekly => "week",
        }
    }

    /// Lowercase string representation for response payloads (`"hourly" | "daily" | "weekly"`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Hourly => "hourly",
            Self::Daily => "daily",
            Self::Weekly => "weekly",
        }
    }
}
