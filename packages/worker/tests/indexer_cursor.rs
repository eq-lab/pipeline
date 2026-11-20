use pipeline_worker::indexer::cursor::{commit_end, covered_to};

#[test]
fn commit_end_normal_case_returns_requested_end() {
    assert_eq!(commit_end(100, 150, 150), Some(150));
    assert_eq!(commit_end(100, 150, 400), Some(150));
}

#[test]
fn commit_end_lagging_node_stops_one_short() {
    assert_eq!(commit_end(100, 150, 149), Some(149));
}

#[test]
fn commit_end_covered_equals_cursor_commits_one_ledger() {
    assert_eq!(commit_end(100, 150, 100), Some(100));
}

#[test]
fn commit_end_covered_below_cursor_commits_nothing() {
    assert_eq!(commit_end(100, 150, 99), None);
}

#[test]
fn commit_end_never_exceeds_requested_end() {
    assert_eq!(commit_end(100, 120, 500), Some(120));
}

#[test]
fn covered_to_empty_is_requested_end() {
    assert_eq!(covered_to(150, Vec::<u64>::new()), 150);
}

#[test]
fn covered_to_single_value() {
    assert_eq!(covered_to(150, [140]), 140);
}

#[test]
fn covered_to_minimum_wins() {
    assert_eq!(covered_to(150, [149, 140, 150]), 140);
}

#[test]
fn covered_to_all_above_requested_end_is_capped() {
    assert_eq!(covered_to(150, [200, 300]), 150);
}

#[test]
fn issue_1739_lagging_getevents_node_does_not_skip_latest_ledger() {
    let cursor = 100;
    let end = 110;
    let covered = covered_to(end, [109]);
    let commit = commit_end(cursor, end, covered).expect("cursor ledger is covered");
    assert_eq!(commit, 109);
    assert_eq!(commit + 1, 110);
}
