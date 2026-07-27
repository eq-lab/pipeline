//! Compute-layer tests for the `/v1/ramp` API group (#936). Exercise
//! `filter_pending_on_ramp_events` directly against fixture `AssetTransferRow`s, no
//! HTTP/DB layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named, no inline `#[cfg(test)]` modules in `src/`).

use std::collections::HashSet;

use bigdecimal::BigDecimal;
use chrono::Utc;

use pipeline_api::config::TransferAddressSets;
use pipeline_api::routes::ramp::filter_pending_on_ramp_events;
use shared::contract_logs_repo::AssetTransferRow;

const CUSTODY: &str = "GAFB7IYPCYZCODQBB5BR5JO45JC4PPVLARUAXQSFHWTLH2KMHPWJ36GD";
const RAMP: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const EXTERNAL: &str = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

fn addr_sets() -> TransferAddressSets {
    TransferAddressSets {
        custody: [CUSTODY.to_owned()].into_iter().collect::<HashSet<_>>(),
        ramp: [RAMP.to_owned()].into_iter().collect::<HashSet<_>>(),
        asset_decimals: 6,
    }
}

fn transfer(id: i64, from: &str, to: &str, whole: i64, approved: bool) -> AssetTransferRow {
    AssetTransferRow {
        id,
        chain_id: 1,
        from_addr: from.to_owned(),
        to_addr: to.to_owned(),
        amount: usdc(whole),
        block_timestamp: 1_000 + id,
        approved_at: approved.then(Utc::now),
    }
}

#[test]
fn keeps_only_pending_ramp_to_custody_transfers() {
    let transfers = vec![
        transfer(1, RAMP, CUSTODY, 10, false), // on-ramp, pending: kept
        transfer(2, RAMP, CUSTODY, 20, true),  // on-ramp, approved: excluded
        transfer(3, CUSTODY, RAMP, 30, false), // off-ramp: excluded (wrong direction)
        transfer(4, RAMP, RAMP, 40, false),    // ramp↔ramp shuffle: excluded
        transfer(5, CUSTODY, CUSTODY, 50, false), // custody↔custody shuffle: excluded
        transfer(6, RAMP, EXTERNAL, 60, false), // untracked recipient: excluded
        transfer(7, EXTERNAL, CUSTODY, 70, false), // untracked sender: excluded
    ];
    let events = filter_pending_on_ramp_events(&transfers, &addr_sets());

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].id, 1);
    assert_eq!(events[0].from, RAMP);
    assert_eq!(events[0].to, CUSTODY);
    assert_eq!(events[0].amount, "10.000000");
    assert_eq!(events[0].created_at, 1_001);
}

#[test]
fn empty_transfers_yield_no_events() {
    let events = filter_pending_on_ramp_events(&[], &addr_sets());
    assert!(events.is_empty());
}

#[test]
fn normalizes_amount_to_canonical_6_decimals() {
    // usdc(100) = raw base units 100_000_000. Read at a 7-decimal asset scale that's
    // 10.0000000 of the asset, which normalizes to "10.000000" at the canonical
    // 6-decimal scale (divided by 10^(7-6)).
    let sets = TransferAddressSets {
        asset_decimals: 7,
        ..addr_sets()
    };
    let transfers = vec![transfer(1, RAMP, CUSTODY, 100, false)];
    let events = filter_pending_on_ramp_events(&transfers, &sets);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].amount, "10.000000");
}
