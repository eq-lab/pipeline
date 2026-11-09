// spec: docs/product-specs/lp-total-balance.md#behavior
use std::str::FromStr;

use bigdecimal::num_bigint::BigInt;
use bigdecimal::{BigDecimal, RoundingMode, Zero};
use chrono::{DateTime, Utc};
use shared::position_repo::{PositionHistoryBucket, SharePriceBucket};

use crate::intervals::Interval;
use crate::routes::common::SeriesStat;
use crate::routes::pnl::{history_item, PositionHistoryItem};

const MAX_DECIMALS: u32 = 18;
const MAX_NUMBER_LEN: usize = 64;
const MAX_SCALE: i64 = 64;
const OUT_SCALE: i64 = 6;

pub fn parse_bounded_decimal(s: &str) -> Option<BigDecimal> {
    if s.is_empty()
        || s.len() > MAX_NUMBER_LEN
        || s.contains(['e', 'E'])
        || s.matches('.').count() > 1
    {
        return None;
    }
    BigDecimal::from_str(s).ok()
}

pub fn plain_bounded(v: &BigDecimal) -> String {
    if (-MAX_SCALE..=MAX_SCALE).contains(&v.as_bigint_and_exponent().1) {
        v.to_plain_string()
    } else {
        v.to_string()
    }
}

fn base6_decimal(units: i128) -> BigDecimal {
    BigDecimal::new(BigInt::from(units), OUT_SCALE)
}

fn fmt6(v: &BigDecimal) -> String {
    v.with_scale_round(OUT_SCALE, RoundingMode::Down)
        .to_plain_string()
}

pub fn fold_escrow(
    steps: Vec<(i64, i128)>,
    interval: Interval,
) -> Option<Vec<(DateTime<Utc>, i128)>> {
    let mut out: Vec<(DateTime<Utc>, i128)> = Vec::new();
    let mut running: i128 = 0;
    for (at, delta) in steps {
        running = running.checked_add(delta)?;
        if running < 0 {
            return None;
        }
        let bucket = interval.truncate(DateTime::from_timestamp(at, 0)?);
        match out.last_mut() {
            Some(last) if last.0 == bucket => last.1 = running,
            _ => out.push((bucket, running)),
        }
    }
    Some(out)
}

pub fn escrow_outcome(
    has_positions: bool,
    wire: anyhow::Result<Option<Vec<(i64, i128)>>>,
) -> anyhow::Result<Option<Vec<(i64, i128)>>> {
    match wire {
        Err(e) if has_positions => {
            tracing::warn!(error = %e, "failed to fetch wire-outs; omitting wire_out_escrow");
            Ok(None)
        }
        other => other,
    }
}

pub fn composite_window_start(
    first_position: Option<i64>,
    first_escrow: Option<i64>,
) -> Option<DateTime<Utc>> {
    let earliest = match (first_position, first_escrow) {
        (Some(a), Some(b)) => a.min(b),
        (Some(a), None) | (None, Some(a)) => a,
        (None, None) => return None,
    };
    DateTime::from_timestamp(earliest, 0)
}

pub struct Carry<'a, T> {
    rows: &'a [T],
    next: usize,
    current: Option<&'a T>,
}

impl<'a, T> Carry<'a, T> {
    pub fn new(rows: &'a [T]) -> Self {
        Self {
            rows,
            next: 0,
            current: None,
        }
    }

    pub fn at(
        &mut self,
        bucket: DateTime<Utc>,
        key: impl Fn(&T) -> DateTime<Utc>,
    ) -> Option<&'a T> {
        while let Some(row) = self.rows.get(self.next).filter(|r| key(r) <= bucket) {
            self.current = Some(row);
            self.next += 1;
        }
        self.current
    }
}

pub fn walk_grid(
    interval: Interval,
    start: DateTime<Utc>,
    now: DateTime<Utc>,
    mut visit: impl FnMut(DateTime<Utc>),
) {
    let mut bucket = interval.truncate(start);
    let end = interval.truncate(now);
    let step = interval.step();
    while bucket <= end {
        visit(bucket);
        bucket += step;
    }
}

pub struct CompositeInputs<'a> {
    pub positions: &'a [PositionHistoryBucket],
    pub prices: &'a [SharePriceBucket],
    pub escrow: Option<&'a [(DateTime<Utc>, i128)]>,
    pub share_decimals: u32,
}

pub struct CompositeSeries {
    pub items: Vec<PositionHistoryItem>,
    pub shares_balance: SeriesStat,
    pub cumulative_realized_pnl: SeriesStat,
    pub splusd_value: Option<SeriesStat>,
    pub total_balance: Option<SeriesStat>,
}

fn splusd_value(
    carried: Option<&PositionHistoryBucket>,
    price: Option<&BigDecimal>,
    share_decimals: u32,
) -> Option<BigDecimal> {
    let zero = || BigDecimal::from(0).with_scale(OUT_SCALE);
    let Some(row) = carried else {
        return Some(zero());
    };
    if row.shares_balance.is_zero() {
        return Some(zero());
    }
    let (int, scale) = row.shares_balance.as_bigint_and_exponent();
    if !(-MAX_SCALE..=MAX_SCALE).contains(&scale) || share_decimals > MAX_DECIMALS {
        return None;
    }
    let units = BigDecimal::new(int, scale + i64::from(share_decimals));
    Some((units * price?).with_scale_round(OUT_SCALE, RoundingMode::Down))
}

struct StatAcc {
    integral: BigDecimal,
    max: Option<BigDecimal>,
    min: Option<BigDecimal>,
    last: BigDecimal,
    count: usize,
}

impl StatAcc {
    fn new() -> Self {
        Self {
            integral: BigDecimal::from(0),
            max: None,
            min: None,
            last: BigDecimal::from(0),
            count: 0,
        }
    }

    fn push(&mut self, v: &BigDecimal, hold_secs: i64) {
        self.integral += v * BigDecimal::from(hold_secs);
        if self.max.as_ref().is_none_or(|m| v > m) {
            self.max = Some(v.clone());
        }
        if self.min.as_ref().is_none_or(|m| v < m) {
            self.min = Some(v.clone());
        }
        self.last = v.clone();
        self.count += 1;
    }

    fn finish(self, total_secs: i64, fmt: fn(&BigDecimal) -> String) -> SeriesStat {
        let zero = BigDecimal::from(0);
        let average = if total_secs > 0 {
            self.integral / BigDecimal::from(total_secs)
        } else {
            self.last
        };
        SeriesStat {
            max: fmt(&self.max.unwrap_or_else(|| zero.clone())),
            min: fmt(&self.min.unwrap_or(zero)),
            average: fmt(&average),
        }
    }
}

fn zero_stat() -> SeriesStat {
    SeriesStat {
        max: "0".to_owned(),
        min: "0".to_owned(),
        average: "0".to_owned(),
    }
}

pub fn build_composite_history(
    inputs: &CompositeInputs<'_>,
    interval: Interval,
    window_start: DateTime<Utc>,
    now: DateTime<Utc>,
) -> CompositeSeries {
    if inputs.positions.is_empty() && inputs.escrow.is_none_or(<[_]>::is_empty) {
        return CompositeSeries {
            items: Vec::new(),
            shares_balance: zero_stat(),
            cumulative_realized_pnl: zero_stat(),
            splusd_value: None,
            total_balance: None,
        };
    }

    let prices: Vec<(DateTime<Utc>, BigDecimal)> = inputs
        .prices
        .iter()
        .filter_map(|p| {
            parse_bounded_decimal(&p.price)
                .filter(|v| v.sign() != bigdecimal::num_bigint::Sign::Minus)
                .map(|v| (p.bucket, v))
        })
        .collect();
    let escrow: Option<Vec<(DateTime<Utc>, BigDecimal)>> = inputs.escrow.map(|rows| {
        rows.iter()
            .map(|&(bucket, units)| (bucket, base6_decimal(units)))
            .collect()
    });

    let mut pos_carry = Carry::new(inputs.positions);
    let mut price_carry = Carry::new(&prices);
    let mut escrow_carry = Carry::new(escrow.as_deref().unwrap_or(&[]));

    let end = interval.truncate(now);
    let step_secs = interval.step().num_seconds();
    let total_secs = (now - interval.truncate(window_start)).num_seconds().max(0);
    let zero = BigDecimal::from(0);

    let mut items = Vec::new();
    let mut shares_acc = StatAcc::new();
    let mut pnl_acc = StatAcc::new();
    let mut splusd_acc = StatAcc::new();
    let mut total_acc = StatAcc::new();

    walk_grid(interval, window_start, now, |bucket| {
        let carried = pos_carry.at(bucket, |r| r.bucket);
        let price = price_carry.at(bucket, |p| p.0).map(|p| &p.1);
        let escrow_now = escrow.as_ref().map(|_| {
            escrow_carry
                .at(bucket, |e| e.0)
                .map_or_else(|| base6_decimal(0), |e| e.1.clone())
        });
        let splusd = splusd_value(carried, price, inputs.share_decimals);
        let total = splusd.as_ref().map(|s| match &escrow_now {
            Some(e) => s + e,
            None => s.clone(),
        });

        let hold = if bucket == end {
            (now - bucket).num_seconds().max(0)
        } else {
            step_secs
        };
        shares_acc.push(carried.map_or(&zero, |r| &r.shares_balance), hold);
        pnl_acc.push(carried.map_or(&zero, |r| &r.cumulative_realized_pnl), hold);
        if let Some(s) = &splusd {
            splusd_acc.push(s, hold);
        }
        if let Some(t) = &total {
            total_acc.push(t, hold);
        }

        let mut item = history_item(bucket, carried);
        item.splusd_value = splusd.as_ref().map(fmt6);
        item.wire_out_escrow = escrow_now.as_ref().map(fmt6);
        item.total_balance = total.as_ref().map(fmt6);
        items.push(item);
    });

    let len = items.len();
    let optional =
        |acc: StatAcc| (acc.count == len && len > 0).then(|| acc.finish(total_secs, fmt6));

    CompositeSeries {
        shares_balance: shares_acc.finish(total_secs, plain_bounded),
        cumulative_realized_pnl: pnl_acc.finish(total_secs, plain_bounded),
        splusd_value: optional(splusd_acc),
        total_balance: optional(total_acc),
        items,
    }
}
