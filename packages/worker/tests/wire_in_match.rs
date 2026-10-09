/// Unit tests for the relayer's wire-in matching phase (Issue #1416).
///
/// The phase's work is two SQL statements, which the repo's no-database test
/// rule puts out of reach here. What is testable is the phase's contract with
/// the store: which calls it makes, with which arguments, what it reports, and
/// how it behaves when a call fails. The statements themselves are reviewed
/// against the schema and exercised by hand once the minter is deployed.
use std::sync::Mutex;

use anyhow::{anyhow, Result};
use async_trait::async_trait;

use pipeline_worker::relayer::wire_in_match::phase_match_wire_ins;
use shared::lp_bank_deposit_repo::WireInMatcher;

const MINTER: &str = "CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX";
const CHAIN: i64 = 99_000_001;

#[derive(Default)]
struct Calls {
    direct: Vec<(i64, String)>,
    assigned: Vec<(i64, String)>,
    unmatched: Vec<(i64, String)>,
}

struct FakeMatcher {
    direct_rows: u64,
    assigned_rows: u64,
    unmatched_rows: i64,
    fail_direct: bool,
    calls: Mutex<Calls>,
}

impl FakeMatcher {
    fn new(direct_rows: u64, assigned_rows: u64, unmatched_rows: i64) -> Self {
        Self {
            direct_rows,
            assigned_rows,
            unmatched_rows,
            fail_direct: false,
            calls: Mutex::new(Calls::default()),
        }
    }

    fn failing() -> Self {
        Self {
            fail_direct: true,
            ..Self::new(0, 0, 0)
        }
    }
}

#[async_trait]
impl WireInMatcher for FakeMatcher {
    async fn mark_minted_direct(&self, chain_id: i64, minter_id: &str) -> Result<u64> {
        if self.fail_direct {
            return Err(anyhow!("database unavailable"));
        }
        self.calls
            .lock()
            .unwrap()
            .direct
            .push((chain_id, minter_id.to_owned()));
        Ok(self.direct_rows)
    }

    async fn mark_minted_assigned(&self, chain_id: i64, minter_id: &str) -> Result<u64> {
        self.calls
            .lock()
            .unwrap()
            .assigned
            .push((chain_id, minter_id.to_owned()));
        Ok(self.assigned_rows)
    }

    async fn count_unmatched_wire_ins(&self, chain_id: i64, minter_id: &str) -> Result<i64> {
        self.calls
            .lock()
            .unwrap()
            .unmatched
            .push((chain_id, minter_id.to_owned()));
        Ok(self.unmatched_rows)
    }
}

#[tokio::test]
async fn both_rules_run_and_their_counts_are_reported() {
    let matcher = FakeMatcher::new(2, 1, 0);
    let summary = phase_match_wire_ins(&matcher, CHAIN, MINTER)
        .await
        .expect("a healthy store should not fail the phase");

    assert_eq!(summary.direct, 2);
    assert_eq!(summary.assigned, 1);
    assert_eq!(summary.unmatched, 0);
}

#[tokio::test]
async fn every_statement_is_scoped_to_the_chain_and_the_minter() {
    let matcher = FakeMatcher::new(0, 0, 0);
    phase_match_wire_ins(&matcher, CHAIN, MINTER)
        .await
        .expect("should succeed");

    let calls = matcher.calls.lock().unwrap();
    let expected = vec![(CHAIN, MINTER.to_owned())];
    assert_eq!(calls.direct, expected);
    assert_eq!(
        calls.assigned, expected,
        "Rule B must be scoped to the configured minter, not just the chain: rows \
         emitted by a previous deployment keep their own contract_address"
    );
    assert_eq!(
        calls.unmatched, expected,
        "and so must the unmatched count, or it reports another deployment's events"
    );
}

#[tokio::test]
async fn a_quiet_tick_matches_nothing_and_still_reports() {
    let matcher = FakeMatcher::new(0, 0, 0);
    let summary = phase_match_wire_ins(&matcher, CHAIN, MINTER)
        .await
        .expect("should succeed");
    assert_eq!(
        (summary.direct, summary.assigned, summary.unmatched),
        (0, 0, 0)
    );
}

#[tokio::test]
async fn unmatched_wire_ins_are_counted_not_swallowed() {
    let matcher = FakeMatcher::new(0, 0, 3);
    let summary = phase_match_wire_ins(&matcher, CHAIN, MINTER)
        .await
        .expect("should succeed");
    assert_eq!(
        summary.unmatched, 3,
        "a WireIn with no deposit row at all must surface as a figure, not vanish; escrowed wires are NOT in this count, they have a deposit row (TD-118)"
    );
}

#[tokio::test]
async fn a_failing_statement_fails_the_tick() {
    let matcher = FakeMatcher::failing();
    let err = phase_match_wire_ins(&matcher, CHAIN, MINTER)
        .await
        .expect_err("a store error must not be reported as a successful tick");
    let chain = format!("{err:#}");
    assert!(
        chain.contains("database unavailable"),
        "the cause must survive in the error chain, got {chain}"
    );
    assert!(
        chain.contains("marking directly staked wire-ins minted"),
        "and the context must say which statement failed, got {chain}"
    );
}

const EVM_MINTER: &str = "0xE75814d9618285AE4d789D4424672597DC494D3E";
const EVM_CHAIN: i64 = 560_048;

#[tokio::test]
async fn an_evm_minter_is_scoped_by_its_checksummed_address_verbatim() {
    let matcher = FakeMatcher::new(1, 0, 0);
    phase_match_wire_ins(&matcher, EVM_CHAIN, EVM_MINTER)
        .await
        .expect("should succeed");

    let calls = matcher.calls.lock().unwrap();
    let expected = vec![(EVM_CHAIN, EVM_MINTER.to_owned())];
    assert_eq!(calls.direct, expected);
    assert_eq!(calls.assigned, expected);
    assert_eq!(
        calls.unmatched, expected,
        "the phase must not re-case the id: EVM contract_logs rows are checksummed text"
    );
}
