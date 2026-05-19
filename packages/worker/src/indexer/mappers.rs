use std::str::FromStr;
use std::sync::Arc;

use async_trait::async_trait;
use bigdecimal::BigDecimal;
use sqlx::PgConnection;

use shared::{db::EventRepo, events::ContractLog, log_mapper::LogMapper};

pub struct ContractLogMapper {
    pub event: ContractLog,
    chain_id: i64,
    repo: Arc<EventRepo>,
    track_position: bool,
}

impl ContractLogMapper {
    pub fn new(event: ContractLog, chain_id: i64, repo: Arc<EventRepo>) -> Self {
        Self {
            event,
            chain_id,
            repo,
            track_position: false,
        }
    }

    pub fn with_position_tracking(mut self) -> Self {
        self.track_position = true;
        self
    }
}

#[async_trait]
impl LogMapper for ContractLogMapper {
    async fn is_duplicate(&self, conn: &mut PgConnection) -> anyhow::Result<bool> {
        self.repo
            .is_duplicate(
                conn,
                self.chain_id,
                &self.event.contract_address.to_checksum(None),
                self.event.block_number,
                self.event.log_index,
            )
            .await
    }

    async fn insert(&self, conn: &mut PgConnection) -> anyhow::Result<()> {
        let mut event_copy;
        let event_ref = if self.track_position && is_staking_event(&self.event) {
            event_copy = clone_contract_log(&self.event);
            compute_position_fields(conn, self.chain_id, &mut event_copy).await?;
            &event_copy
        } else {
            &self.event
        };

        self.repo.insert_log(conn, event_ref, self.chain_id).await
    }

    fn block_number(&self) -> u64 {
        self.event.block_number
    }

    fn set_block_timestamp(&mut self, ts: u64) {
        self.event.block_timestamp = ts;
    }
}

fn is_staking_event(event: &ContractLog) -> bool {
    event.event_name == "StakingDeposit" || event.event_name == "StakingWithdrawal"
}

fn clone_contract_log(e: &ContractLog) -> ContractLog {
    ContractLog {
        contract_address: e.contract_address,
        event_name: e.event_name.clone(),
        block_number: e.block_number,
        tx_hash: e.tx_hash,
        log_index: e.log_index,
        block_timestamp: e.block_timestamp,
        sender: e.sender,
        receiver: e.receiver,
        amount: e.amount,
        request_id: e.request_id,
        cumulative: e.cumulative,
        assets: e.assets,
        shares: e.shares,
        shares_balance: e.shares_balance.clone(),
        avg_buy_share_price: e.avg_buy_share_price.clone(),
        realized_pnl: e.realized_pnl.clone(),
    }
}

/// Query previous position from contract_logs within the same transaction,
/// then compute shares_balance, avg_buy_share_price, and realized_pnl.
async fn compute_position_fields(
    conn: &mut PgConnection,
    chain_id: i64,
    event: &mut ContractLog,
) -> anyhow::Result<()> {
    let vault_address = event.contract_address.to_checksum(None);
    let owner_address = event
        .sender
        .map(|a| a.to_checksum(None))
        .unwrap_or_default()
        .to_lowercase();

    let zero = BigDecimal::from(0i64);

    let assets_raw = event.assets.map_or_else(
        || zero.clone(),
        |v| BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal"),
    );
    let shares_raw = event.shares.map_or_else(
        || zero.clone(),
        |v| BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal"),
    );

    if shares_raw == 0i64 {
        return Ok(());
    }

    // Query through the transaction connection so uncommitted inserts are visible
    let prev: Option<(BigDecimal, BigDecimal)> = sqlx::query_as(
        "SELECT shares_balance, avg_buy_share_price
         FROM contract_logs
         WHERE chain_id = $1
           AND LOWER(contract_address) = LOWER($2)
           AND LOWER(sender) = $3
           AND event_name IN ('StakingDeposit', 'StakingWithdrawal')
           AND shares_balance IS NOT NULL
         ORDER BY block_number DESC, log_index DESC
         LIMIT 1",
    )
    .bind(chain_id)
    .bind(&vault_address)
    .bind(&owner_address)
    .fetch_optional(&mut *conn)
    .await?;

    let (prev_shares, prev_avg_price) = prev.unwrap_or((zero.clone(), zero.clone()));

    let is_stake = event.event_name == "StakingDeposit";

    let (new_shares, new_avg_price, realized_pnl) = if is_stake {
        let new_shares = &prev_shares + &shares_raw;
        let new_avg_price = if new_shares > zero {
            (&prev_avg_price * &prev_shares + &assets_raw) / &new_shares
        } else {
            zero.clone()
        };
        (new_shares, new_avg_price, zero)
    } else {
        let new_shares = &prev_shares - &shares_raw;
        if new_shares < zero {
            tracing::warn!(
                vault = %vault_address,
                owner = %owner_address,
                prev_shares = %prev_shares,
                withdrawn = %shares_raw,
                "withdrawal exceeds balance — clamping to zero"
            );
            let realized = &assets_raw - &prev_shares * &prev_avg_price;
            (zero.clone(), zero.clone(), realized)
        } else {
            let new_avg_price = prev_avg_price.clone();
            let realized = &assets_raw - &shares_raw * &prev_avg_price;
            (new_shares, new_avg_price, realized)
        }
    };

    event.shares_balance = Some(new_shares);
    event.avg_buy_share_price = Some(new_avg_price);
    event.realized_pnl = Some(realized_pnl);

    Ok(())
}
