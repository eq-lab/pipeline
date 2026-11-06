// spec: docs/references/backend.md#stellar-pocket-indexing
use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use bigdecimal::BigDecimal;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct PocketEventRow {
    pub loan_id: BigDecimal,
    pub event_name: String,
    pub block_number: i64,
    pub log_index: i64,
    pub block_timestamp: i64,
    pub params: Value,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PocketSeedRow {
    pub loan_id: BigDecimal,
    pub as_of_ledger: i64,
    pub snapshot_ledger: i64,
    pub supply_at_snapshot: BigDecimal,
    pub held: BigDecimal,
    pub released_total: BigDecimal,
    pub burned_total: BigDecimal,
    pub claimed_total: BigDecimal,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PocketFold {
    pub snapshot_ledger: i64,
    pub supply_at_snapshot: BigDecimal,
    pub opened: Option<BigDecimal>,
    pub held: BigDecimal,
    pub released_total: BigDecimal,
    pub burned_total: BigDecimal,
    pub claimed_total: BigDecimal,
    pub complete: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PocketClaimTotals {
    pub loan_id: BigDecimal,
    pub total: BigDecimal,
    pub after_seed: BigDecimal,
}

#[derive(Default)]
struct Totals {
    held: BigDecimal,
    released_total: BigDecimal,
    burned_total: BigDecimal,
    claimed_total: BigDecimal,
}

fn dec(params: &Value, key: &str) -> Option<BigDecimal> {
    BigDecimal::from_str(params.get(key)?.as_str()?).ok()
}

fn apply(totals: &mut Totals, event: &PocketEventRow) -> bool {
    let p = &event.params;
    let applied = match event.event_name.as_str() {
        "PocketReleased" => {
            dec(p, "released")
                .zip(dec(p, "interest"))
                .map(|(released, interest)| {
                    totals.held -= &released;
                    totals.released_total += released + interest;
                })
        }
        "PocketUnreleased" => {
            dec(p, "principal")
                .zip(dec(p, "interest"))
                .map(|(principal, interest)| {
                    totals.held += &principal;
                    totals.released_total -= principal + interest;
                })
        }
        "PocketBurned" => dec(p, "burned").map(|burned| {
            totals.held -= &burned;
            totals.burned_total += burned;
        }),
        "PocketClaimed" => dec(p, "paid").map(|paid| totals.claimed_total += paid),
        _ => Some(()),
    };
    if applied.is_none() {
        tracing::warn!(
            loan_id = %event.loan_id,
            event_name = %event.event_name,
            block_number = event.block_number,
            "pocket event with a missing or unparsable amount skipped"
        );
    }
    applied.is_some()
}

fn ordered(events: &[PocketEventRow]) -> Vec<&PocketEventRow> {
    let mut sorted: Vec<&PocketEventRow> = events.iter().collect();
    sorted.sort_by_key(|e| (e.block_number, e.log_index));
    sorted
}

pub fn fold_pocket(events: &[PocketEventRow], seed: Option<&PocketSeedRow>) -> Option<PocketFold> {
    fold_sorted(&ordered(events), None, seed)
}

fn fold_sorted(
    sorted: &[&PocketEventRow],
    claims: Option<&PocketClaimTotals>,
    seed: Option<&PocketSeedRow>,
) -> Option<PocketFold> {
    let opened = sorted.iter().find_map(|e| {
        if e.event_name != "PocketOpened" {
            return None;
        }
        let snapshot_ledger = e
            .params
            .get("snapshot_ledger")?
            .as_str()?
            .parse::<i64>()
            .ok()?;
        Some((
            dec(&e.params, "amount")?,
            snapshot_ledger,
            dec(&e.params, "supply_at_snapshot")?,
        ))
    });

    if let Some((amount, snapshot_ledger, supply_at_snapshot)) = opened {
        let mut totals = Totals {
            held: amount.clone(),
            ..Totals::default()
        };
        for event in sorted.iter().filter(|e| e.event_name != "PocketOpened") {
            apply(&mut totals, event);
        }
        if let Some(claims) = claims {
            totals.claimed_total += &claims.total;
        }
        return Some(PocketFold {
            snapshot_ledger,
            supply_at_snapshot,
            opened: Some(amount),
            held: totals.held,
            released_total: totals.released_total,
            burned_total: totals.burned_total,
            claimed_total: totals.claimed_total,
            complete: true,
        });
    }

    let seed = seed?;
    let mut totals = Totals {
        held: seed.held.clone(),
        released_total: seed.released_total.clone(),
        burned_total: seed.burned_total.clone(),
        claimed_total: seed.claimed_total.clone(),
    };
    for event in sorted.iter().filter(|e| e.block_number > seed.as_of_ledger) {
        apply(&mut totals, event);
    }
    if let Some(claims) = claims {
        totals.claimed_total += &claims.after_seed;
    }
    Some(PocketFold {
        snapshot_ledger: seed.snapshot_ledger,
        supply_at_snapshot: seed.supply_at_snapshot.clone(),
        opened: None,
        held: totals.held,
        released_total: totals.released_total,
        burned_total: totals.burned_total,
        claimed_total: totals.claimed_total,
        complete: false,
    })
}

pub fn fold_pockets(
    events: &[PocketEventRow],
    claims: &[PocketClaimTotals],
    seeds: &[PocketSeedRow],
) -> HashMap<BigDecimal, PocketFold> {
    let mut by_loan: HashMap<&BigDecimal, Vec<&PocketEventRow>> = HashMap::new();
    for event in events {
        by_loan.entry(&event.loan_id).or_default().push(event);
    }
    let seed_by_loan: HashMap<&BigDecimal, &PocketSeedRow> =
        seeds.iter().map(|s| (&s.loan_id, s)).collect();
    let claims_by_loan: HashMap<&BigDecimal, &PocketClaimTotals> =
        claims.iter().map(|c| (&c.loan_id, c)).collect();
    let loans: HashSet<&BigDecimal> = by_loan.keys().chain(seed_by_loan.keys()).copied().collect();

    loans
        .into_iter()
        .filter_map(|loan| {
            let loan_events = by_loan.get(loan).map_or(&[][..], Vec::as_slice);
            let fold = fold_sorted(
                loan_events,
                claims_by_loan.get(loan).copied(),
                seed_by_loan.get(loan).copied(),
            )?;
            Some((loan.clone(), fold))
        })
        .collect()
}
