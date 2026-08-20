//! Time-bucket enum shared by time-series endpoints.
//!
//! Used by `/v1/stats/yield` (where it maps to a sample step in seconds), and by
//! `/v1/stats/prices` and `/v1/positions/history` (where it maps to a Postgres
//! `DATE_TRUNC` argument). All three deserialize the URL query value
//! `"hourly" | "daily" | "weekly"` into the same type so the public API surface is
//! consistent.

use chrono::{DateTime, Datelike, Duration, NaiveTime, TimeZone, Timelike, Utc};
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
    /// One bucket's width, for stepping a dense bucket grid.
    ///
    /// Exact for all three variants because the grid is built in UTC, where an
    /// hour, a day and a week are fixed lengths — no DST discontinuities to
    /// worry about.
    pub fn step(self) -> Duration {
        Duration::seconds(self.step_secs())
    }

    /// Truncate `dt` to the start of the bucket containing it, matching Postgres
    /// `DATE_TRUNC(as_pg_trunc(), …)` evaluated in UTC — so a grid built in Rust
    /// lands on the same instants as the query's event buckets.
    ///
    /// Weekly buckets start Monday, as Postgres `DATE_TRUNC('week', …)` does.
    pub fn truncate(self, dt: DateTime<Utc>) -> DateTime<Utc> {
        match self {
            Self::Hourly => dt
                .with_minute(0)
                .and_then(|d| d.with_second(0))
                .and_then(|d| d.with_nanosecond(0))
                .unwrap_or(dt),
            Self::Daily => Utc.from_utc_datetime(&dt.date_naive().and_time(NaiveTime::MIN)),
            Self::Weekly => {
                let date = dt.date_naive();
                let monday =
                    date - Duration::days(i64::from(date.weekday().num_days_from_monday()));
                Utc.from_utc_datetime(&monday.and_time(NaiveTime::MIN))
            }
        }
    }

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
