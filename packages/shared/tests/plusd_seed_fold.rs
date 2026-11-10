// spec: docs/references/backend.md#plusd-balance-seed
use shared::contract_logs_repo::PlusdStepRow;
use shared::plusd_seed::{
    balance_at, balance_from_sums, parse_seed, plusd_delta, seeded_plusd, Backfill, PlusdCoverage,
    PlusdSeed, PlusdSeedRow, PlusdWindowSums,
};

const LEDGER: i64 = 110;
const SEED_TS: i64 = 1100;

fn row(block: i64, ts: i64, amount: &str, incoming: bool, outgoing: bool) -> PlusdStepRow {
    PlusdStepRow {
        block_number: block,
        block_timestamp: ts,
        amount: Some(amount.to_owned()),
        incoming,
        outgoing,
    }
}

fn credit(block: i64, ts: i64, amount: &str) -> PlusdStepRow {
    row(block, ts, amount, true, false)
}

fn debit(block: i64, ts: i64, amount: &str) -> PlusdStepRow {
    row(block, ts, amount, false, true)
}

fn seed(balance: i128, reanchor: bool) -> PlusdSeed {
    PlusdSeed {
        as_of_ledger: LEDGER,
        as_of_timestamp: SEED_TS,
        balance,
        reanchor,
    }
}

fn coverage(block: i64, ts: i64) -> PlusdCoverage {
    PlusdCoverage {
        block_number: block,
        block_timestamp: ts,
    }
}

fn pre_rows() -> Vec<PlusdStepRow> {
    vec![
        credit(100, 1000, "1000"),
        debit(101, 1010, "600"),
        debit(102, 1020, "100"),
        credit(103, 1030, "100"),
        debit(104, 1040, "50"),
        credit(105, 1050, "25"),
        credit(106, 1060, "200"),
    ]
}

fn pre_steps() -> Vec<(i64, i128)> {
    vec![
        (1000, 1000),
        (1010, -600),
        (1020, -100),
        (1030, 100),
        (1040, -50),
        (1050, 25),
        (1060, 200),
    ]
}

fn seed_row(balance: Option<&str>, kind: &str) -> PlusdSeedRow {
    PlusdSeedRow {
        as_of_ledger: 7,
        as_of_timestamp: 8,
        balance: balance.map(str::to_owned),
        kind: kind.to_owned(),
    }
}

#[test]
fn parse_seed_accepts_a_good_value_and_the_kind() {
    let s = parse_seed(&seed_row(Some("575"), "initial")).unwrap();
    assert_eq!(
        s,
        PlusdSeed {
            as_of_ledger: 7,
            as_of_timestamp: 8,
            balance: 575,
            reanchor: false
        }
    );
    assert!(
        parse_seed(&seed_row(Some("0"), "reanchor"))
            .unwrap()
            .reanchor
    );
    let max = i128::MAX.to_string();
    assert_eq!(
        parse_seed(&seed_row(Some(&max), "initial"))
            .unwrap()
            .balance,
        i128::MAX
    );
}

#[test]
fn parse_seed_rejects_malformed_rows() {
    assert!(parse_seed(&seed_row(None, "initial")).is_none());
    assert!(parse_seed(&seed_row(Some(""), "initial")).is_none());
    assert!(parse_seed(&seed_row(Some(&"1".repeat(40)), "initial")).is_none());
    let above = "340282366920938463463374607431768211455";
    assert!(parse_seed(&seed_row(Some(above), "initial")).is_none());
    assert!(parse_seed(&seed_row(Some("-5"), "initial")).is_none());
    assert!(parse_seed(&seed_row(Some("1e5"), "initial")).is_none());
    assert!(parse_seed(&seed_row(Some("5"), "other")).is_none());
}

#[test]
fn delta_signs_and_self_transfer() {
    assert_eq!(plusd_delta(&credit(1, 1, "9")), Some(9));
    assert_eq!(plusd_delta(&debit(1, 1, "9")), Some(-9));
    assert_eq!(plusd_delta(&row(1, 1, "9", true, true)), Some(0));
    let mut bad = credit(1, 1, "9");
    bad.amount = None;
    assert_eq!(plusd_delta(&bad), None);
}

#[test]
fn covered_with_a_zero_start_has_no_leading_step() {
    let mut rows = pre_rows();
    rows.push(debit(120, 1200, "75"));
    let out = seeded_plusd(&seed(575, false), &rows, Some(coverage(100, 1000))).unwrap();
    assert_eq!(out.backfill, Backfill::Covered);
    assert_eq!(out.from, 1000);
    assert!(!out.blank_total_before);
    let mut expected = pre_steps();
    expected.push((1200, -75));
    assert_eq!(out.steps, expected);
}

#[test]
fn covered_with_a_non_zero_start_leads_with_the_bound() {
    let out = seeded_plusd(&seed(1575, false), &pre_rows(), Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Covered);
    assert_eq!(out.from, 900);
    assert!(out.blank_total_before);
    assert_eq!(out.steps[0], (900, 1000));
    assert_eq!(out.steps[1..], pre_steps()[..]);
    let end: i128 = out.steps.iter().map(|s| s.1).sum();
    assert_eq!(end, 1575);
}

#[test]
fn covered_for_a_wallet_with_no_rows_is_flat_from_the_bound() {
    let out = seeded_plusd(&seed(300, false), &[], Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Covered);
    assert_eq!(out.steps, vec![(900, 300)]);
    assert!(out.blank_total_before);
}

#[test]
fn covered_with_a_zero_seed_and_no_rows_is_empty_and_keeps_the_total() {
    let out = seeded_plusd(&seed(0, false), &[], Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Covered);
    assert!(out.steps.is_empty());
    assert_eq!(out.from, 900);
    assert!(!out.blank_total_before);
}

#[test]
fn a_negative_back_computed_start_is_inconsistent() {
    let rows = vec![credit(105, 1050, "50"), debit(120, 1200, "0")];
    let out = seeded_plusd(&seed(0, false), &rows, Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Inconsistent);
    assert_eq!(out.steps, vec![(1200, 0)]);
    assert_eq!(out.from, SEED_TS.min(1200));
    assert!(out.blank_total_before);
}

#[test]
fn a_negative_start_with_a_zero_seed_has_no_leading_step() {
    let rows = vec![credit(105, 1050, "50")];
    let out = seeded_plusd(&seed(0, false), &rows, Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Inconsistent);
    assert!(out.steps.is_empty());
    assert_eq!(out.from, SEED_TS);
    assert!(out.blank_total_before);
}

#[test]
fn a_negative_running_value_midway_is_inconsistent() {
    let rows = vec![debit(101, 1010, "100"), credit(102, 1020, "200")];
    let out = seeded_plusd(&seed(100, false), &rows, Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Inconsistent);
    assert_eq!(out.steps, vec![(SEED_TS, 100)]);
    assert!(out.blank_total_before);
}

#[test]
fn overflow_while_back_computing_is_inconsistent() {
    let max = i128::MAX.to_string();
    let rows = vec![credit(101, 1010, &max), credit(102, 1020, &max)];
    let out = seeded_plusd(&seed(5, false), &rows, Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Inconsistent);

    let rows = vec![debit(101, 1010, "1")];
    let out = seeded_plusd(&seed(i128::MAX, false), &rows, Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Inconsistent);
}

#[test]
fn a_reanchor_seed_is_never_back_computed() {
    let out = seeded_plusd(&seed(575, true), &pre_rows(), Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Inconsistent);
    assert_eq!(out.steps, vec![(SEED_TS, 575)]);
    assert_eq!(out.from, SEED_TS);
    assert!(out.blank_total_before);

    let zero = seeded_plusd(&seed(0, true), &[], Some(coverage(100, 900))).unwrap();
    assert!(zero.blank_total_before);
    assert!(zero.steps.is_empty());
}

#[test]
fn no_coverage_row_keeps_the_total_only_for_a_zero_seed() {
    let zero = seeded_plusd(&seed(0, false), &[], None).unwrap();
    assert_eq!(zero.backfill, Backfill::NoCoverage);
    assert!(!zero.blank_total_before);
    assert!(zero.steps.is_empty());

    let some = seeded_plusd(&seed(5, false), &[], None).unwrap();
    assert_eq!(some.backfill, Backfill::NoCoverage);
    assert!(some.blank_total_before);
    assert_eq!(some.steps, vec![(SEED_TS, 5)]);
}

#[test]
fn a_bound_after_the_seed_is_no_coverage() {
    let out = seeded_plusd(&seed(5, false), &[], Some(coverage(LEDGER + 1, 2000))).unwrap();
    assert_eq!(out.backfill, Backfill::NoCoverage);
    assert_eq!(out.steps, vec![(SEED_TS, 5)]);
}

#[test]
fn no_back_compute_drops_rows_up_to_the_seed_and_clamps_the_timestamp() {
    let rows = vec![
        credit(100, 1000, "40"),
        credit(LEDGER, SEED_TS, "10"),
        debit(111, 1090, "5"),
    ];
    let out = seeded_plusd(&seed(50, false), &rows, None).unwrap();
    assert_eq!(out.from, 1090);
    assert_eq!(out.steps, vec![(1090, 50), (1090, -5)]);

    let later = vec![debit(111, 1500, "5")];
    let out = seeded_plusd(&seed(50, false), &later, None).unwrap();
    assert_eq!(out.from, SEED_TS);
    assert_eq!(out.steps, vec![(SEED_TS, 50), (1500, -5)]);
}

#[test]
fn a_malformed_post_seed_row_omits_the_whole_term() {
    let mut bad = credit(200, 1050, "1");
    bad.amount = Some("x".to_owned());
    assert!(seeded_plusd(&seed(5, false), &[bad.clone()], Some(coverage(100, 900))).is_none());
    assert!(seeded_plusd(&seed(5, false), &[bad], None).is_none());
}

#[test]
fn balance_at_folds_the_window_after_the_seed() {
    let rows = vec![
        credit(100, 1000, "999"),
        credit(111, 1110, "30"),
        debit(115, 1150, "10"),
        credit(116, 1160, "7"),
    ];
    let s = seed(50, false);
    assert_eq!(balance_at(&s, &rows, 115), Some(70));
    assert_eq!(balance_at(&s, &rows, 116), Some(77));
    assert_eq!(balance_at(&s, &rows, 110), Some(50));
}

#[test]
fn balance_at_can_go_negative_and_reports_overflow_and_malformed() {
    let s = seed(5, false);
    assert_eq!(balance_at(&s, &[debit(111, 1, "9")], 120), Some(-4));
    let max = i128::MAX.to_string();
    assert_eq!(balance_at(&s, &[credit(111, 1, &max)], 120), None);
    let mut bad = credit(111, 1, "1");
    bad.amount = Some("x".to_owned());
    assert_eq!(balance_at(&s, &[bad], 120), None);
}

#[test]
fn a_malformed_pre_seed_row_only_disables_the_back_compute() {
    let mut bad = credit(100, 1000, "1");
    bad.amount = None;
    let rows = vec![bad.clone(), credit(105, 1050, "5"), debit(120, 1200, "2")];
    let out = seeded_plusd(&seed(50, false), &rows, Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Inconsistent);
    assert_eq!(out.steps, vec![(1100, 50), (1200, -2)]);
    assert!(out.blank_total_before);

    let none = seeded_plusd(&seed(50, false), &rows, None).unwrap();
    assert_eq!(none.backfill, Backfill::NoCoverage);

    let re = seeded_plusd(&seed(50, true), &rows, Some(coverage(100, 900))).unwrap();
    assert_eq!(re.backfill, Backfill::Inconsistent);
}

#[test]
fn back_compute_tolerates_an_upward_excursion_but_not_an_overflowing_one() {
    let rows = vec![credit(101, 1010, "10"), debit(102, 1020, "10")];
    let out = seeded_plusd(&seed(0, false), &rows, Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Covered);
    let rows = vec![credit(101, 1010, "5"), debit(102, 1020, "5")];
    let out = seeded_plusd(&seed(i128::MAX, false), &rows, Some(coverage(100, 900))).unwrap();
    assert_eq!(out.backfill, Backfill::Inconsistent);
}

fn sums(credit: &str, debit: &str, malformed: i64) -> PlusdWindowSums {
    PlusdWindowSums {
        credit: credit.to_owned(),
        debit: debit.to_owned(),
        malformed,
    }
}

#[test]
fn window_sums_give_the_expected_balance_or_none() {
    assert_eq!(balance_from_sums(50, &sums("30", "10", 0)), Some(70));
    assert_eq!(balance_from_sums(5, &sums("0", "9", 0)), Some(-4));
    assert_eq!(balance_from_sums(50, &sums("30", "10", 1)), None);
    assert_eq!(balance_from_sums(50, &sums("x", "10", 0)), None);
    assert_eq!(balance_from_sums(50, &sums("1e5", "0", 0)), None);
    assert_eq!(balance_from_sums(50, &sums(&"9".repeat(40), "0", 0)), None);
    let max = i128::MAX.to_string();
    assert_eq!(balance_from_sums(5, &sums(&max, "0", 0)), None);
}
