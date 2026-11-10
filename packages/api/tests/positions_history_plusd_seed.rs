// spec: docs/product-specs/lp-total-balance.md#behavior
use std::cell::RefCell;
use std::io;
use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Once;

use bigdecimal::BigDecimal;
use chrono::{DateTime, TimeZone, Utc};
use pipeline_api::intervals::Interval;
use pipeline_api::routes::pnl::PositionHistoryItem;
use pipeline_api::total_balance::{
    build_composite_history, plusd_steps, plusd_term_from, term_outcomes, CompositeInputs,
    CompositeSeries, PlusdTerm, SeedInputs, WireTerm,
};
use shared::chains::ChainKind;
use shared::contract_logs_repo::PlusdStepRow;
use shared::plusd_seed::{PlusdCoverage, PlusdSeedRow};
use shared::position_repo::{PositionHistoryBucket, SharePriceBucket};

const DAY: i64 = 86_400;
const E7: i128 = 10_000_000;
const LEDGER: i64 = 110;
const CHAIN: i64 = 99_000_001;

fn ts(secs: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(1_790_000_000 - 1_790_000_000 % DAY + secs, 0)
        .unwrap()
}

fn unix(secs: i64) -> i64 {
    ts(secs).timestamp()
}

fn row(block: i64, at: i64, units: i128, incoming: bool) -> PlusdStepRow {
    PlusdStepRow {
        block_number: block,
        block_timestamp: unix(at),
        amount: Some((units * E7).to_string()),
        incoming,
        outgoing: !incoming,
    }
}

fn seed_row(units: i128, kind: &str, at: i64) -> PlusdSeedRow {
    PlusdSeedRow {
        as_of_ledger: LEDGER,
        as_of_timestamp: unix(at),
        balance: Some((units * E7).to_string()),
        kind: kind.to_owned(),
    }
}

fn coverage(block: i64, at: i64) -> PlusdCoverage {
    PlusdCoverage {
        block_number: block,
        block_timestamp: unix(at),
    }
}

fn positions() -> Vec<PositionHistoryBucket> {
    vec![PositionHistoryBucket {
        vault_address: "vault".to_owned(),
        bucket: ts(0),
        shares_balance: BigDecimal::from_str("1000000").unwrap(),
        avg_buy_share_price: BigDecimal::from_str("1").unwrap(),
        cumulative_realized_pnl: BigDecimal::from_str("0").unwrap(),
    }]
}

fn prices() -> Vec<SharePriceBucket> {
    vec![SharePriceBucket {
        bucket: ts(0),
        price: "2".to_owned(),
    }]
}

fn build(
    term: Option<&PlusdTerm>,
    with_positions: bool,
    start_day: i64,
    now_day: i64,
) -> CompositeSeries {
    let pos = if with_positions { positions() } else { vec![] };
    let pr = if with_positions { prices() } else { vec![] };
    build_composite_history(
        &CompositeInputs {
            positions: &pos,
            prices: &pr,
            escrow: None,
            escrow_raw: None,
            plusd: term.map(|t| t.folded.as_slice()),
            plusd_from: term.and_then(|t| t.from),
            blank_total_before: term.is_some_and(|t| t.blank_total_before),
            share_decimals: 6,
            asset_decimals: 7,
        },
        Interval::Daily,
        ts(start_day * DAY),
        ts(now_day * DAY),
    )
}

fn col<'a>(
    items: &'a [PositionHistoryItem],
    f: impl Fn(&'a PositionHistoryItem) -> &'a Option<String>,
) -> Vec<Option<&'a str>> {
    items.iter().map(|i| f(i).as_deref()).collect()
}

fn stellar_at(
    holder: &str,
    cursor: u64,
    seed: Option<&PlusdSeedRow>,
    cov: Option<PlusdCoverage>,
    rows: &[PlusdStepRow],
) -> Option<PlusdTerm> {
    plusd_term_from(
        ChainKind::Stellar,
        &SeedInputs {
            seed,
            coverage: cov,
            cursor,
            holder,
        },
        rows,
        Interval::Daily,
        CHAIN,
    )
}

fn stellar(
    seed: Option<&PlusdSeedRow>,
    cov: Option<PlusdCoverage>,
    rows: &[PlusdStepRow],
) -> Option<PlusdTerm> {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let holder = format!("G{}", NEXT.fetch_add(1, Ordering::SeqCst));
    stellar_at(&holder, 1_000, seed, cov, rows)
}

fn history_rows() -> Vec<PlusdStepRow> {
    vec![
        row(103, 3 * DAY, 10, true),
        row(105, 5 * DAY, 4, false),
        row(120, 7 * DAY, 1, false),
    ]
}

thread_local! {
    static CAPTURED: RefCell<Option<Vec<u8>>> = const { RefCell::new(None) };
}

struct ThreadCapture;

impl io::Write for ThreadCapture {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        CAPTURED.with(|c| {
            if let Some(out) = c.borrow_mut().as_mut() {
                out.extend_from_slice(buf);
            }
        });
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn init_capture() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let sub = tracing_subscriber::fmt()
            .with_writer(|| ThreadCapture)
            .with_ansi(false)
            .finish();
        tracing::subscriber::set_global_default(sub).unwrap();
        tracing::callsite::rebuild_interest_cache();
    });
}

fn captured<R>(f: impl FnOnce() -> R) -> (R, String) {
    init_capture();
    CAPTURED.with(|c| *c.borrow_mut() = Some(Vec::new()));
    let out = f();
    let log =
        CAPTURED.with(|c| String::from_utf8(c.borrow_mut().take().unwrap_or_default()).unwrap());
    (out, log)
}

fn assert_plain(s: &CompositeSeries) {
    let mut all: Vec<&str> = Vec::new();
    for i in &s.items {
        for f in [&i.plusd_balance, &i.total_balance, &i.splusd_value] {
            all.extend(f.as_deref());
        }
    }
    for stat in [&s.total_balance, &s.splusd_value].into_iter().flatten() {
        all.extend([stat.max.as_str(), stat.min.as_str(), stat.average.as_str()]);
    }
    assert!(all.iter().all(|v| !v.contains(['e', 'E'])), "{all:?}");
}

#[test]
fn an_unseeded_stellar_wallet_omits_the_term_and_keeps_the_present_total() {
    assert!(stellar(None, Some(coverage(100, 2 * DAY)), &history_rows()).is_none());
    let s = build(None, true, 0, 2);
    assert!(s.items.iter().all(|i| i.plusd_balance.is_none()));
    assert_eq!(
        col(&s.items, |i| &i.total_balance),
        col(&s.items, |i| &i.splusd_value)
    );
    assert_eq!(col(&s.items, |i| &i.total_balance), [Some("2.000000"); 3]);
    assert!(s.total_balance.is_some());
}

#[test]
fn a_malformed_seed_omits_the_term() {
    let mut bad = seed_row(8, "initial", 6 * DAY);
    bad.balance = None;
    assert!(stellar(Some(&bad), Some(coverage(100, 2 * DAY)), &history_rows()).is_none());
}

#[test]
fn covered_with_a_non_zero_start_blanks_the_total_before_the_bound() {
    let seed = seed_row(8, "initial", 6 * DAY + DAY / 2);
    let term = stellar(Some(&seed), Some(coverage(100, 2 * DAY)), &history_rows()).unwrap();
    assert_eq!(term.from, Some(ts(2 * DAY)));
    assert!(term.blank_total_before);
    let s = build(Some(&term), true, 0, 8);
    assert_eq!(s.items.len(), 9);
    assert_eq!(
        col(&s.items, |i| &i.plusd_balance),
        [
            None,
            None,
            Some("2.000000"),
            Some("12.000000"),
            Some("12.000000"),
            Some("8.000000"),
            Some("8.000000"),
            Some("7.000000"),
            Some("7.000000"),
        ]
    );
    assert_eq!(
        col(&s.items, |i| &i.total_balance),
        [
            None,
            None,
            Some("4.000000"),
            Some("14.000000"),
            Some("14.000000"),
            Some("10.000000"),
            Some("10.000000"),
            Some("9.000000"),
            Some("9.000000"),
        ]
    );
    assert_eq!(
        col(&s.items, |i| &i.splusd_value)[..2],
        [Some("2.000000"); 2]
    );
    assert!(s.total_balance.is_none());
    assert!(s.splusd_value.is_some());
    assert_plain(&s);
}

#[test]
fn covered_with_a_zero_start_keeps_the_total_and_draws_no_step() {
    let seed = seed_row(6, "initial", 6 * DAY + DAY / 2);
    let term = stellar(Some(&seed), Some(coverage(100, 2 * DAY)), &history_rows()).unwrap();
    assert!(!term.blank_total_before);
    let s = build(Some(&term), true, 0, 8);
    assert_eq!(
        col(&s.items, |i| &i.plusd_balance),
        [
            None,
            None,
            Some("0.000000"),
            Some("10.000000"),
            Some("10.000000"),
            Some("6.000000"),
            Some("6.000000"),
            Some("5.000000"),
            Some("5.000000"),
        ]
    );
    let totals = col(&s.items, |i| &i.total_balance);
    assert_eq!(totals[..3], [Some("2.000000"); 3]);
    assert_eq!(totals[3], Some("12.000000"));
    assert!(s.total_balance.is_some());
    assert_plain(&s);
}

#[test]
fn an_inconsistent_back_compute_starts_at_the_seed_bucket_and_warns_once() {
    let seed = seed_row(3, "initial", 6 * DAY + DAY / 2);
    let (term, log) =
        captured(|| stellar(Some(&seed), Some(coverage(100, 2 * DAY)), &history_rows()));
    let term = term.unwrap();
    assert_eq!(
        log.matches("PLUSD back-computed balance inconsistent")
            .count(),
        1,
        "{log}"
    );
    assert!(term.blank_total_before);
    let s = build(Some(&term), true, 0, 8);
    assert_eq!(
        col(&s.items, |i| &i.plusd_balance),
        [
            None,
            None,
            None,
            None,
            None,
            None,
            Some("3.000000"),
            Some("2.000000"),
            Some("2.000000")
        ]
    );
    let totals = col(&s.items, |i| &i.total_balance);
    assert!(totals[..6].iter().all(Option::is_none));
    assert_eq!(
        totals[6..],
        [Some("5.000000"), Some("4.000000"), Some("4.000000")]
    );
    assert!(s.total_balance.is_none());
    assert!(s.splusd_value.is_some());
}

#[test]
fn a_reanchor_seed_moves_the_bound_to_the_seed_without_a_new_warning() {
    let seed = seed_row(3, "reanchor", 6 * DAY + DAY / 2);
    let (term, log) =
        captured(|| stellar(Some(&seed), Some(coverage(100, 2 * DAY)), &history_rows()));
    let term = term.unwrap();
    assert!(!log.contains("inconsistent"), "{log}");
    let s = build(Some(&term), true, 0, 8);
    let pl = col(&s.items, |i| &i.plusd_balance);
    assert!(pl[..6].iter().all(Option::is_none));
    assert_eq!(
        pl[6..],
        [Some("3.000000"), Some("2.000000"), Some("2.000000")]
    );
    assert!(col(&s.items, |i| &i.total_balance)[..6]
        .iter()
        .all(Option::is_none));
}

#[test]
fn no_coverage_with_a_zero_seed_and_no_rows_is_an_empty_fold() {
    let seed = seed_row(0, "initial", 4 * DAY + DAY / 2);
    let term = stellar(Some(&seed), None, &[]).unwrap();
    assert!(term.folded.is_empty());
    assert!(!term.blank_total_before);
    let s = build(Some(&term), true, 0, 6);
    assert_eq!(
        col(&s.items, |i| &i.plusd_balance),
        [
            None,
            None,
            None,
            None,
            Some("0.000000"),
            Some("0.000000"),
            Some("0.000000")
        ]
    );
    assert_eq!(col(&s.items, |i| &i.total_balance), [Some("2.000000"); 7]);
    assert!(s.total_balance.is_some());

    let none = build(Some(&term), false, 6, 6);
    assert!(none.items.is_empty());
    assert!(none.total_balance.is_none());
}

#[test]
fn a_post_seed_debit_larger_than_the_balance_drops_the_term_without_blanking() {
    let seed = seed_row(1, "initial", 6 * DAY + DAY / 2);
    let rows = vec![row(120, 7 * DAY, 5, false)];
    let (term, log) = captured(|| stellar(Some(&seed), Some(coverage(100, 2 * DAY)), &rows));
    assert!(term.is_none());
    assert!(log.contains("balance term fold failed"), "{log}");
    let s = build(None, true, 0, 8);
    assert!(s.items.iter().all(|i| i.plusd_balance.is_none()));
    assert_eq!(
        col(&s.items, |i| &i.total_balance),
        col(&s.items, |i| &i.splusd_value)
    );
    assert!(s.total_balance.is_some());
}

#[test]
fn a_window_after_the_bound_shows_no_blanking_and_a_straddling_one_blanks_only_before_it() {
    let seed = seed_row(8, "initial", 6 * DAY + DAY / 2);
    let term = stellar(Some(&seed), Some(coverage(100, 2 * DAY)), &history_rows()).unwrap();

    let after = build(Some(&term), true, 4, 8);
    assert_eq!(after.items.len(), 5);
    assert!(after
        .items
        .iter()
        .all(|i| i.plusd_balance.is_some() && i.total_balance.is_some()));
    assert!(after.total_balance.is_some());

    let straddle = build(Some(&term), true, 1, 8);
    let totals = col(&straddle.items, |i| &i.total_balance);
    assert!(totals[0].is_none());
    assert!(totals[1..].iter().all(Option::is_some));
    assert!(straddle.total_balance.is_none());
}

#[test]
fn evm_ignores_the_seed_and_the_coverage_and_folds_from_zero() {
    let rows = vec![row(3, 3 * DAY, 10, true), row(5, 5 * DAY, 4, false)];
    let seed = seed_row(999, "initial", 6 * DAY);
    let inputs = SeedInputs {
        seed: Some(&seed),
        coverage: Some(coverage(1, DAY)),
        cursor: 0,
        holder: "0xabc",
    };
    let term = plusd_term_from(ChainKind::Evm, &inputs, &rows, Interval::Daily, 1).unwrap();
    assert!(term.from.is_none());
    assert!(!term.blank_total_before);
    let steps = plusd_steps(&rows).unwrap();
    let plain = pipeline_api::total_balance::fold_steps(steps, Interval::Daily).unwrap();
    assert_eq!(term.folded, plain);
    let s = build(Some(&term), true, 0, 6);
    assert_eq!(
        col(&s.items, |i| &i.plusd_balance),
        [
            Some("0.000000"),
            Some("0.000000"),
            Some("0.000000"),
            Some("10.000000"),
            Some("10.000000"),
            Some("6.000000"),
            Some("6.000000"),
        ]
    );
    assert!(s.total_balance.is_some());
    let bare = SeedInputs {
        seed: None,
        coverage: None,
        cursor: 0,
        holder: "0xabc",
    };
    let unseeded = plusd_term_from(ChainKind::Evm, &bare, &rows, Interval::Daily, 1).unwrap();
    assert_eq!(unseeded.folded, term.folded);
}

#[test]
fn term_outcomes_treat_a_seeded_term_like_a_folded_one() {
    let seed = seed_row(8, "initial", 6 * DAY + DAY / 2);
    let term = stellar(Some(&seed), Some(coverage(100, 2 * DAY)), &history_rows()).unwrap();
    let wire: anyhow::Result<Option<WireTerm>> = Err(anyhow::anyhow!("db down"));
    let (wire, plusd) = term_outcomes(false, wire, Ok(Some(term))).unwrap();
    assert!(wire.is_none() && plusd.is_some());

    let wire: anyhow::Result<Option<WireTerm>> = Err(anyhow::anyhow!("db down"));
    let empty = stellar(Some(&seed_row(0, "initial", DAY)), None, &[]);
    assert!(term_outcomes(false, wire, Ok(empty)).is_err());
}

#[test]
fn a_seed_ahead_of_the_indexer_cursor_omits_the_term_quietly() {
    let seed = seed_row(8, "initial", 6 * DAY + DAY / 2);
    let cov = Some(coverage(100, 2 * DAY));
    let rows = history_rows();
    let ((behind, edge, passed), log) = captured(|| {
        (
            stellar_at("G_GATE_BEHIND", 110, Some(&seed), cov, &rows),
            stellar_at("G_GATE_EDGE", 111, Some(&seed), cov, &rows),
            stellar_at("G_GATE_PASSED", 112, Some(&seed), cov, &rows),
        )
    });
    assert!(behind.is_none());
    assert!(edge.is_some());
    assert!(passed.is_some());
    assert!(!log.contains("WARN"), "{log}");
    let s = build(behind.as_ref(), true, 0, 4);
    assert!(s.items.iter().all(|i| i.plusd_balance.is_none()));
    assert_eq!(
        col(&s.items, |i| &i.total_balance),
        col(&s.items, |i| &i.splusd_value)
    );
}

#[test]
fn the_inconsistent_warning_fires_once_per_holder_and_seed() {
    let seed = seed_row(3, "initial", 6 * DAY + DAY / 2);
    let cov = Some(coverage(100, 2 * DAY));
    let rows = history_rows();
    let (terms, log) = captured(|| {
        (0..3)
            .map(|_| stellar_at("G_WARN_ONCE", 1_000, Some(&seed), cov, &rows))
            .collect::<Vec<_>>()
    });
    assert!(terms
        .iter()
        .all(|t| t.as_ref().is_some_and(|t| t.blank_total_before)));
    assert_eq!(
        log.matches("pre-seed buckets incomplete").count(),
        1,
        "{log}"
    );
    let (_, other) = captured(|| stellar_at("G_WARN_OTHER", 1_000, Some(&seed), cov, &rows));
    assert_eq!(
        other.matches("pre-seed buckets incomplete").count(),
        1,
        "{other}"
    );
    let newer = PlusdSeedRow {
        as_of_ledger: LEDGER + 1,
        ..seed_row(3, "initial", 6 * DAY + DAY / 2)
    };
    let (_, again) = captured(|| stellar_at("G_WARN_ONCE", 1_000, Some(&newer), cov, &rows));
    assert_eq!(
        again.matches("pre-seed buckets incomplete").count(),
        1,
        "{again}"
    );
}
