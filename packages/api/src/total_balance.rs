// spec: docs/product-specs/lp-total-balance.md#behavior
use std::collections::HashSet;
use std::str::FromStr;
use std::sync::{Mutex, OnceLock, PoisonError};

use alloy::primitives::Address;
use bigdecimal::num_bigint::BigInt;
use bigdecimal::{BigDecimal, RoundingMode, Zero};
use chrono::{DateTime, Utc};
use shared::chains::ChainKind;
use shared::contract_logs_repo::PlusdStepRow;
use shared::plusd_seed::{
    parse_seed, plusd_delta, seeded_plusd, Backfill, PlusdCoverage, PlusdSeedRow,
};
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

pub fn fold_steps(
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

pub type Folded = Vec<(DateTime<Utc>, i128)>;

pub struct WireTerm {
    pub escrow: Folded,
    pub raw: Option<Folded>,
}

pub fn fold_term(
    steps: Vec<(i64, i128)>,
    interval: Interval,
    chain_id: i64,
    field: &str,
) -> Option<Folded> {
    let folded = fold_steps(steps, interval);
    if folded.is_none() {
        tracing::warn!(chain_id, field, "balance term fold failed; omitting it");
    }
    folded
}

pub fn term_outcome<T>(
    has_other_data: bool,
    result: anyhow::Result<Option<T>>,
    field: &str,
) -> anyhow::Result<Option<T>> {
    match result {
        Err(e) if has_other_data => {
            tracing::warn!(error = %e, field, "failed to fetch balance term; omitting it");
            Ok(None)
        }
        other => other,
    }
}

pub struct PlusdTerm {
    pub folded: Folded,
    pub from: Option<DateTime<Utc>>,
    pub blank_total_before: bool,
}

pub fn term_outcomes(
    has_positions: bool,
    wire: anyhow::Result<Option<WireTerm>>,
    plusd: anyhow::Result<Option<PlusdTerm>>,
) -> anyhow::Result<(Option<WireTerm>, Option<PlusdTerm>)> {
    let wire_present = matches!(&wire, Ok(Some(t)) if !t.escrow.is_empty());
    let plusd_present = matches!(&plusd, Ok(Some(t)) if !t.folded.is_empty());
    let wire = term_outcome(has_positions || plusd_present, wire, "wire_out_escrow")?;
    let plusd = term_outcome(has_positions || wire_present, plusd, "plusd_balance")?;
    Ok((wire, plusd))
}

pub fn composite_window_start(firsts: &[Option<i64>]) -> Option<DateTime<Utc>> {
    let earliest = firsts.iter().flatten().min().copied()?;
    DateTime::from_timestamp(earliest, 0)
}

pub fn plusd_holder_key(kind: ChainKind, wallet: &str) -> Option<String> {
    match kind {
        ChainKind::Evm => Some(wallet.parse::<Address>().ok()?.to_checksum(None)),
        ChainKind::Stellar => Some(wallet.to_uppercase()),
    }
}

pub fn plusd_steps(rows: &[PlusdStepRow]) -> Option<Vec<(i64, i128)>> {
    rows.iter()
        .map(|r| Some((r.block_timestamp, plusd_delta(r)?)))
        .collect()
}

pub struct SeedInputs<'a> {
    pub seed: Option<&'a PlusdSeedRow>,
    pub coverage: Option<PlusdCoverage>,
    pub cursor: u64,
    pub holder: &'a str,
}

const INCONSISTENT_WARNED_CAP: usize = 10_000;

fn first_inconsistent_warning(chain_id: i64, holder: &str, ledger: i64) -> bool {
    static WARNED: OnceLock<Mutex<HashSet<(i64, String, i64)>>> = OnceLock::new();
    let mut set = WARNED
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if set.len() >= INCONSISTENT_WARNED_CAP {
        set.clear();
    }
    set.insert((chain_id, holder.to_owned(), ledger))
}

pub fn plusd_term_from(
    kind: ChainKind,
    inputs: &SeedInputs<'_>,
    rows: &[PlusdStepRow],
    interval: Interval,
    chain_id: i64,
) -> Option<PlusdTerm> {
    if kind == ChainKind::Evm {
        let Some(steps) = plusd_steps(rows) else {
            tracing::warn!(
                chain_id,
                "PLUSD balance steps malformed; omitting plusd_balance"
            );
            return None;
        };
        return fold_term(steps, interval, chain_id, "plusd_balance").map(|folded| PlusdTerm {
            folded,
            from: None,
            blank_total_before: false,
        });
    }
    let Some(seed_row) = inputs.seed else {
        tracing::debug!(
            chain_id,
            "no PLUSD balance seed for wallet; omitting plusd_balance"
        );
        return None;
    };
    let Some(seed) = parse_seed(seed_row) else {
        tracing::warn!(
            chain_id,
            "PLUSD balance seed malformed; omitting plusd_balance"
        );
        return None;
    };
    let indexed_through = i64::try_from(inputs.cursor).unwrap_or(i64::MAX) - 1;
    if indexed_through < seed.as_of_ledger {
        tracing::debug!(
            chain_id,
            seed_ledger = seed.as_of_ledger,
            indexed_through,
            "PLUSD balance seed is ahead of the indexer; omitting plusd_balance"
        );
        return None;
    }
    let Some(seeded) = seeded_plusd(&seed, rows, inputs.coverage) else {
        tracing::warn!(
            chain_id,
            "PLUSD balance steps malformed; omitting plusd_balance"
        );
        return None;
    };
    if seeded.backfill == Backfill::Inconsistent && !seed.reanchor {
        if first_inconsistent_warning(chain_id, inputs.holder, seed.as_of_ledger) {
            tracing::warn!(
                chain_id,
                holder = inputs.holder,
                "PLUSD back-computed balance inconsistent; pre-seed buckets incomplete"
            );
        } else {
            tracing::debug!(
                chain_id,
                holder = inputs.holder,
                "PLUSD back-computed balance inconsistent; pre-seed buckets incomplete"
            );
        }
    }
    let folded = fold_term(seeded.steps, interval, chain_id, "plusd_balance")?;
    Some(PlusdTerm {
        folded,
        from: DateTime::from_timestamp(seeded.from, 0),
        blank_total_before: seeded.blank_total_before,
    })
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
    pub escrow_raw: Option<&'a [(DateTime<Utc>, i128)]>,
    pub plusd: Option<&'a [(DateTime<Utc>, i128)]>,
    pub plusd_from: Option<DateTime<Utc>>,
    pub blank_total_before: bool,
    pub share_decimals: u32,
    pub asset_decimals: u32,
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
    if inputs.positions.is_empty()
        && inputs.escrow.is_none_or(<[_]>::is_empty)
        && inputs.plusd.is_none_or(<[_]>::is_empty)
    {
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

    if inputs.plusd.is_some() && inputs.asset_decimals > MAX_DECIMALS {
        tracing::warn!(
            asset_decimals = inputs.asset_decimals,
            "asset decimals out of range; omitting plusd_balance"
        );
    }
    let plusd: Option<Vec<(DateTime<Utc>, BigDecimal)>> = inputs
        .plusd
        .filter(|_| inputs.asset_decimals <= MAX_DECIMALS)
        .map(|rows| {
            rows.iter()
                .map(|&(bucket, raw)| {
                    let units =
                        BigDecimal::new(BigInt::from(raw), i64::from(inputs.asset_decimals));
                    (
                        bucket,
                        units.with_scale_round(OUT_SCALE, RoundingMode::Down),
                    )
                })
                .collect()
        });

    let mut pos_carry = Carry::new(inputs.positions);
    let mut price_carry = Carry::new(&prices);
    let mut escrow_carry = Carry::new(escrow.as_deref().unwrap_or(&[]));
    let mut plusd_carry = Carry::new(plusd.as_deref().unwrap_or(&[]));
    let mut plusd_raw_carry = Carry::new(inputs.plusd.unwrap_or(&[]));
    let mut escrow_raw_carry = Carry::new(inputs.escrow_raw.unwrap_or(&[]));

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
        let complete = inputs
            .plusd_from
            .is_none_or(|from| bucket >= interval.truncate(from));
        let plusd_now = plusd.as_ref().filter(|_| complete).map(|_| {
            plusd_carry
                .at(bucket, |e| e.0)
                .map_or_else(|| base6_decimal(0), |e| e.1.clone())
        });
        let splusd = splusd_value(carried, price, inputs.share_decimals);
        let plusd_raw = plusd_raw_carry.at(bucket, |e| e.0).map_or(0, |e| e.1);
        let escrow_raw = escrow_raw_carry.at(bucket, |e| e.0).map_or(0, |e| e.1);
        let exact_held =
            (plusd_now.is_some() && escrow_now.is_some() && inputs.escrow_raw.is_some())
                .then(|| plusd_raw.checked_add(escrow_raw))
                .flatten()
                .map(|raw| BigDecimal::new(BigInt::from(raw), i64::from(inputs.asset_decimals)));
        let blank_total = !complete && inputs.blank_total_before;
        let total = splusd.as_ref().filter(|_| !blank_total).map(|s| {
            if let Some(held) = &exact_held {
                return (s + held).with_scale_round(OUT_SCALE, RoundingMode::Down);
            }
            let mut sum = s.clone();
            if let Some(e) = &escrow_now {
                sum += e;
            }
            if let Some(p) = &plusd_now {
                sum += p;
            }
            sum
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
        item.plusd_balance = plusd_now.as_ref().map(fmt6);
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
