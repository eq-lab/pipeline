//! Unit tests for the Soroban `getEvents` filter construction.
//!
//! Soroban rejects a `contract` filter with more than 5 contract IDs
//! (`-32602 … maximum 5 contract IDs per filter`), so `build_contract_filters`
//! chunks the IDs into ≤5-ID filters. No RPC, no DB.

use pipeline_worker::indexer::stellar::rpc::build_contract_filters;

fn ids(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("C{i:0>55}")).collect()
}

/// Extract the `contractIds` length of each filter in order.
fn filter_sizes(filters: &[serde_json::Value]) -> Vec<usize> {
    filters
        .iter()
        .map(|f| {
            f["contractIds"]
                .as_array()
                .expect("contractIds array")
                .len()
        })
        .collect()
}

#[test]
fn empty_ids_yield_no_filters() {
    assert!(build_contract_filters(&[]).is_empty());
}

#[test]
fn five_ids_fit_in_one_filter() {
    let filters = build_contract_filters(&ids(5));
    assert_eq!(filter_sizes(&filters), vec![5]);
}

#[test]
fn six_ids_split_into_two_filters() {
    // The exact case that triggered the `-32602 maximum 5 contract IDs` error:
    // DM, WQ, sPLUSD, loan-registry, yield-minter, + asset.
    let filters = build_contract_filters(&ids(6));
    assert_eq!(filter_sizes(&filters), vec![5, 1]);
}

#[test]
fn every_filter_stays_within_the_cap() {
    let filters = build_contract_filters(&ids(13));
    assert_eq!(filter_sizes(&filters), vec![5, 5, 3]);
    assert!(
        filters
            .iter()
            .all(|f| f["contractIds"].as_array().unwrap().len() <= 5),
        "no filter may exceed 5 contract IDs"
    );
}

#[test]
fn each_filter_is_a_contract_filter_and_ids_are_preserved() {
    let input = ids(6);
    let filters = build_contract_filters(&input);
    // Every filter is typed "contract".
    assert!(filters.iter().all(|f| f["type"] == "contract"));
    // The union of all filters' contractIds equals the input, in order.
    let flattened: Vec<String> = filters
        .iter()
        .flat_map(|f| {
            f["contractIds"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_owned())
        })
        .collect();
    assert_eq!(flattened, input);
}

// ── Per-request chunking ─────────────────────────────────────────────────────

use pipeline_worker::indexer::stellar::rpc::chunk_contract_ids_per_request;

fn chunk_sizes(n: usize) -> Vec<usize> {
    chunk_contract_ids_per_request(&ids(n))
        .iter()
        .map(Vec::len)
        .collect()
}

#[test]
fn no_ids_issue_no_request() {
    assert!(chunk_contract_ids_per_request(&[]).is_empty());
}

#[test]
fn twenty_five_ids_fit_one_request() {
    assert_eq!(chunk_sizes(25), vec![25]);
}

#[test]
fn twenty_six_ids_split_into_two_requests() {
    assert_eq!(chunk_sizes(26), vec![25, 1]);
}

#[test]
fn sixty_ids_split_into_three_requests() {
    assert_eq!(chunk_sizes(60), vec![25, 25, 10]);
}

#[test]
fn every_request_chunk_fits_five_filters_of_five_ids() {
    for chunk in chunk_contract_ids_per_request(&ids(60)) {
        let filters = build_contract_filters(&chunk);
        assert!(filters.len() <= 5);
        assert!(filter_sizes(&filters).iter().all(|n| *n <= 5));
    }
}
