// spec: docs/references/backend.md#loanregistry-rate-ppm-backfill
use shared::{
    book_weighting::RATE_EVENT_NAMES,
    contract_logs_repo::{ContractLogsRepo, RateBackfillRow},
    loan_economics::{ppm_to_bps_floor, rate_ppm_from_event},
};
use sqlx::PgPool;

use super::loan_metadata::{ImmutableDataResolver, LoanAddress, LoanId};

pub fn plan_rate_ppm_backfill(
    genesis_ppm: u32,
    rows: &[RateBackfillRow],
) -> Result<Vec<(i64, u32)>, String> {
    let genesis_bps = i64::from(ppm_to_bps_floor(genesis_ppm));
    if let Some(bad) = rows
        .iter()
        .find(|r| r.stored_bps.is_some_and(|b| b != genesis_bps))
    {
        return Err(format!(
            "row {} stores senior_interest_rate_bps {:?}, genesis ppm {genesis_ppm} floors to {genesis_bps}",
            bad.id, bad.stored_bps
        ));
    }
    let mut current = genesis_ppm;
    let mut plan = Vec::new();
    for row in rows {
        if RATE_EVENT_NAMES.contains(&row.event_name.as_str()) {
            if let Some(rate) = row.new_rate {
                current = rate_ppm_from_event(rate);
            }
        }
        if !row.has_ppm {
            plan.push((row.id, current));
        }
    }
    Ok(plan)
}

pub async fn run_rate_ppm_backfill<A: LoanAddress, Id: LoanId>(
    chain_id: i64,
    contract: &A,
    repo: &ContractLogsRepo,
    pool: &PgPool,
    resolver: &dyn ImmutableDataResolver<A, Id>,
) {
    let address = contract.as_db_string();
    let loans = match repo.list_loans_missing_rate_ppm(chain_id, &address).await {
        Ok(loans) => loans,
        Err(e) => {
            tracing::warn!(chain_id, error = %e, "rate ppm backfill: listing loans failed");
            return;
        }
    };
    let (mut loans_done, mut rows_done, mut loans_skipped) = (0usize, 0usize, 0usize);
    for loan in &loans {
        match backfill_loan(chain_id, contract, &address, repo, pool, resolver, loan).await {
            Ok(rows) => {
                loans_done += 1;
                rows_done += rows;
            }
            Err(e) => {
                loans_skipped += 1;
                tracing::warn!(chain_id, loan_id = %loan, error = %e, "rate ppm backfill: loan skipped");
            }
        }
    }
    tracing::info!(
        chain_id,
        loans_done,
        rows_done,
        loans_skipped,
        "rate ppm backfill finished"
    );
}

async fn backfill_loan<A: LoanAddress, Id: LoanId>(
    chain_id: i64,
    contract: &A,
    address: &str,
    repo: &ContractLogsRepo,
    pool: &PgPool,
    resolver: &dyn ImmutableDataResolver<A, Id>,
    loan: &bigdecimal::BigDecimal,
) -> anyhow::Result<usize> {
    let loan_id = Id::from_bigdecimal(loan)?;
    let genesis_ppm = resolver
        .immutable_loan_data(contract, loan_id)
        .await?
        .senior_interest_rate_ppm;
    let rows = repo
        .list_rate_backfill_rows(chain_id, address, loan)
        .await?;
    let plan = plan_rate_ppm_backfill(genesis_ppm, &rows).map_err(anyhow::Error::msg)?;
    let mut tx = pool.begin().await?;
    for (id, current_ppm) in &plan {
        ContractLogsRepo::set_snapshot_rate_ppm(&mut tx, *id, genesis_ppm, *current_ppm).await?;
    }
    tx.commit().await?;
    Ok(plan.len())
}
