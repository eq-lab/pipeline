// spec: docs/references/backend.md#stellar-pocket-indexing
use pipeline_worker::indexer::stellar::pocket_seed::{
    decode_pocket_data, is_no_pocket_error, seed_row, PocketDataView,
};
use stellar_xdr::curr::{Int128Parts, ScMap, ScMapEntry, ScSymbol, ScVal, StringM, VecM};

fn sym_val(s: &str) -> ScVal {
    let sym: StringM<32> = s.try_into().unwrap();
    ScVal::Symbol(ScSymbol(sym))
}

fn i128_val(v: i128) -> ScVal {
    ScVal::I128(Int128Parts {
        hi: (v >> 64) as i64,
        lo: (v & 0xFFFF_FFFF_FFFF_FFFF) as u64,
    })
}

fn map_val(pairs: Vec<(&str, ScVal)>) -> ScVal {
    let entries: Vec<ScMapEntry> = pairs
        .into_iter()
        .map(|(k, val)| ScMapEntry {
            key: sym_val(k),
            val,
        })
        .collect();
    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
}

fn full_pairs() -> Vec<(&'static str, ScVal)> {
    vec![
        ("snapshot_ledger", ScVal::U32(5_500_000)),
        ("supply_at_snapshot", i128_val(10_000_000_000)),
        ("held", i128_val(500)),
        ("released_total", i128_val(350)),
        ("burned_total", i128_val(i128::from(u64::MAX) * 3)),
        ("claimed_total", i128_val(310)),
    ]
}

#[test]
fn decodes_pocket_data() {
    let view = decode_pocket_data(&map_val(full_pairs())).unwrap();
    assert_eq!(
        view,
        PocketDataView {
            snapshot_ledger: 5_500_000,
            supply_at_snapshot: 10_000_000_000,
            held: 500,
            released_total: 350,
            burned_total: i128::from(u64::MAX) * 3,
            claimed_total: 310,
        }
    );
}

#[test]
fn missing_field_is_error() {
    let mut pairs = full_pairs();
    pairs.retain(|(k, _)| *k != "held");
    assert!(decode_pocket_data(&map_val(pairs)).is_err());
}

#[test]
fn wrong_type_is_error() {
    let mut pairs = full_pairs();
    pairs.retain(|(k, _)| *k != "snapshot_ledger");
    pairs.push(("snapshot_ledger", i128_val(5)));
    assert!(decode_pocket_data(&map_val(pairs)).is_err());
    assert!(decode_pocket_data(&ScVal::Void).is_err());
}

#[test]
fn no_pocket_error_detection() {
    assert!(is_no_pocket_error("HostError: Error(Contract, #2)"));
    assert!(!is_no_pocket_error("HostError: Error(Contract, #3)"));
    assert!(!is_no_pocket_error("connection refused"));
}

#[test]
fn seed_row_carries_as_of_ledger_and_totals() {
    let view = decode_pocket_data(&map_val(full_pairs())).unwrap();
    let row = seed_row(4, &view, 5_500_100);
    assert_eq!(row.loan_id.to_string(), "4");
    assert_eq!(row.as_of_ledger, 5_500_100);
    assert_eq!(row.snapshot_ledger, 5_500_000);
    assert_eq!(row.held.to_string(), "500");
    assert_eq!(row.claimed_total.to_string(), "310");
}

#[test]
fn backoff_schedule_doubles_to_the_cap() {
    use pipeline_worker::indexer::stellar::pocket_seed::backoff_delay;
    use std::time::Duration;
    assert_eq!(backoff_delay(1), Duration::from_mins(1));
    assert_eq!(backoff_delay(2), Duration::from_mins(2));
    assert_eq!(backoff_delay(3), Duration::from_mins(4));
    assert_eq!(backoff_delay(6), Duration::from_mins(32));
    assert_eq!(backoff_delay(7), Duration::from_hours(1));
    assert_eq!(backoff_delay(40), Duration::from_hours(1));
}

#[test]
fn failing_loans_are_skipped_until_due_and_cleared_on_success() {
    use pipeline_worker::indexer::stellar::pocket_seed::SeedBackoff;
    use std::time::{Duration, Instant};
    let mut backoff = SeedBackoff::default();
    let t0 = Instant::now();
    assert!(backoff.is_due(1, t0));
    assert_eq!(backoff.record_failure(1, t0), 1);
    assert!(!backoff.is_due(1, t0 + Duration::from_secs(59)));
    assert!(backoff.is_due(1, t0 + Duration::from_mins(1)));
    assert_eq!(backoff.record_failure(1, t0 + Duration::from_mins(1)), 2);
    assert!(!backoff.is_due(1, t0 + Duration::from_secs(179)));
    assert!(backoff.is_due(1, t0 + Duration::from_mins(3)));
    assert!(backoff.is_due(2, t0));
    backoff.clear(1);
    assert!(backoff.is_due(1, t0));
}

#[test]
fn warnings_fire_once_per_loan() {
    use pipeline_worker::indexer::stellar::pocket_seed::SeedBackoff;
    let mut backoff = SeedBackoff::default();
    assert!(backoff.first_read_warning(1));
    assert!(!backoff.first_read_warning(1));
    assert!(backoff.first_insert_warning(1));
    assert!(!backoff.first_insert_warning(1));
    assert!(backoff.first_read_warning(2));
}
