// spec: docs/references/backend.md#stellar-pocket-indexing
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use bigdecimal::BigDecimal;
use stellar_xdr::curr::ScVal;

use shared::pocket::PocketSeedRow;
use shared::pocket_repo::PocketRepo;

use crate::indexer::stellar::loan_registry_reader::{expect_map, map_i128, map_u32, simulate_view};
use crate::indexer::stellar::rpc::StellarRpc;

pub const POCKET_SEED_INTERVAL: Duration = Duration::from_mins(1);
pub use crate::indexer::stellar::supervise::backoff_delay;

pub type SeedBackoff = crate::indexer::stellar::supervise::SeedBackoff<u32>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PocketDataView {
    pub snapshot_ledger: u32,
    pub supply_at_snapshot: i128,
    pub held: i128,
    pub released_total: i128,
    pub burned_total: i128,
    pub claimed_total: i128,
}

pub fn decode_pocket_data(scval: &ScVal) -> Result<PocketDataView> {
    let map = expect_map(scval, "PocketData")?;
    Ok(PocketDataView {
        snapshot_ledger: map_u32(&map, "snapshot_ledger", "PocketData")?,
        supply_at_snapshot: map_i128(&map, "supply_at_snapshot", "PocketData")?,
        held: map_i128(&map, "held", "PocketData")?,
        released_total: map_i128(&map, "released_total", "PocketData")?,
        burned_total: map_i128(&map, "burned_total", "PocketData")?,
        claimed_total: map_i128(&map, "claimed_total", "PocketData")?,
    })
}

pub fn is_no_pocket_error(msg: &str) -> bool {
    msg.contains("Error(Contract, #2)")
}

pub fn seed_row(loan_id: u32, view: &PocketDataView, as_of_ledger: u64) -> PocketSeedRow {
    PocketSeedRow {
        loan_id: BigDecimal::from(loan_id),
        as_of_ledger: as_of_ledger as i64,
        snapshot_ledger: i64::from(view.snapshot_ledger),
        supply_at_snapshot: BigDecimal::from(view.supply_at_snapshot),
        held: BigDecimal::from(view.held),
        released_total: BigDecimal::from(view.released_total),
        burned_total: BigDecimal::from(view.burned_total),
        claimed_total: BigDecimal::from(view.claimed_total),
    }
}

async fn read_pocket(
    rpc: &StellarRpc,
    pocket_id: &str,
    loan_id: u32,
) -> Result<(PocketDataView, u64)> {
    let (value, latest_ledger) =
        simulate_view(rpc, pocket_id, "pocket", vec![ScVal::U32(loan_id)]).await?;
    Ok((decode_pocket_data(&value)?, latest_ledger))
}

async fn seed_cycle(
    rpc: &StellarRpc,
    repo: &PocketRepo,
    chain_id: i64,
    pocket_id: &str,
    registry_id: &str,
    backoff: &mut SeedBackoff,
) -> Result<()> {
    let candidates = repo
        .list_seed_candidates(chain_id, registry_id, pocket_id)
        .await?;
    for loan_id in candidates {
        if !backoff.is_due(loan_id, Instant::now()) {
            continue;
        }
        match read_pocket(rpc, pocket_id, loan_id).await {
            Ok((view, latest_ledger)) => {
                let row = seed_row(loan_id, &view, latest_ledger);
                match repo.insert_seed(chain_id, pocket_id, &row).await {
                    Ok(true) => {
                        backoff.clear(loan_id);
                        tracing::info!(chain_id, loan_id, "pocket view seed stored");
                    }
                    Ok(false) => backoff.clear(loan_id),
                    Err(e) => {
                        backoff.record_failure(loan_id, Instant::now());
                        if backoff.first_insert_warning(loan_id) {
                            tracing::warn!(chain_id, loan_id, error = %e, "pocket seed insert failed");
                        } else {
                            tracing::debug!(chain_id, loan_id, error = %e, "pocket seed insert failed");
                        }
                    }
                }
            }
            Err(e) if is_no_pocket_error(&e.to_string()) => {
                backoff.record_failure(loan_id, Instant::now());
                tracing::debug!(chain_id, loan_id, "no pocket for defaulted loan yet");
            }
            Err(e) => {
                backoff.record_failure(loan_id, Instant::now());
                if backoff.first_read_warning(loan_id) {
                    tracing::warn!(chain_id, loan_id, error = %e, "pocket view seed read failed");
                } else {
                    tracing::debug!(chain_id, loan_id, error = %e, "pocket view seed read failed");
                }
            }
        }
    }
    Ok(())
}

pub async fn run_pocket_seed_loop(
    rpc: Arc<StellarRpc>,
    repo: PocketRepo,
    chain_id: i64,
    pocket_id: String,
    registry_id: String,
) {
    let mut backoff = SeedBackoff::default();
    loop {
        if let Err(e) = seed_cycle(
            &rpc,
            &repo,
            chain_id,
            &pocket_id,
            &registry_id,
            &mut backoff,
        )
        .await
        {
            tracing::warn!(chain_id, error = %e, "pocket seed cycle failed");
        }
        tokio::time::sleep(POCKET_SEED_INTERVAL).await;
    }
}
