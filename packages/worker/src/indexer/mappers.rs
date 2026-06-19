use std::str::FromStr;
use std::sync::Arc;

use async_trait::async_trait;
use bigdecimal::BigDecimal;
use serde_json::Value;
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
        let event_ref = if self.track_position && is_staking_event_name(&self.event.event_name) {
            event_copy = clone_contract_log(&self.event);
            let vault_address = event_copy.contract_address.to_checksum(None);
            compute_position_fields(
                conn,
                self.chain_id,
                &vault_address,
                &event_copy.event_name,
                &mut event_copy.params,
            )
            .await?;
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

/// Shared by EVM `ContractLogMapper` and Stellar `StellarLogMapper`.
pub fn is_staking_event_name(event_name: &str) -> bool {
    event_name == "StakingDeposit" || event_name == "StakingWithdrawal"
}

fn clone_contract_log(e: &ContractLog) -> ContractLog {
    ContractLog {
        contract_address: e.contract_address,
        event_name: e.event_name.clone(),
        block_number: e.block_number,
        tx_hash: e.tx_hash,
        log_index: e.log_index,
        block_timestamp: e.block_timestamp,
        params: e.params.clone(),
    }
}

/// Query previous position from contract_logs within the same transaction,
/// then compute shares_balance, avg_buy_share_price, and realized_pnl.
/// Results are written back into `params`.
///
/// `vault_address` and `event_name` are passed by reference so this function
/// is chain-agnostic: EVM callers stringify the `Address` (checksummed hex),
/// Stellar callers pass the Strkey `C…` directly. The SQL self-join uses
/// `LOWER(...)` symmetrically, so case-insensitive equality works for both.
pub async fn compute_position_fields(
    conn: &mut PgConnection,
    chain_id: i64,
    vault_address: &str,
    event_name: &str,
    params: &mut Value,
) -> anyhow::Result<()> {
    // StakingDeposit / StakingWithdrawal both use `owner` as the position holder.
    // Legacy Stellar `StakingDeposit` rows (pre EVM-parity normalization in the
    // parser) lack `owner` and expose the share holder under `from`. Fall back
    // only for `StakingDeposit` — withdrawals' `receiver`/`from` aren't safe
    // proxies for `owner`.
    let owner_address = params
        .get("owner")
        .or_else(|| {
            if event_name == "StakingDeposit" {
                params.get("from")
            } else {
                None
            }
        })
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_lowercase();

    let zero = BigDecimal::from(0i64);

    let assets_raw = params
        .get("assets")
        .and_then(|v| v.as_str())
        .and_then(|s| BigDecimal::from_str(s).ok())
        .unwrap_or_else(|| zero.clone());

    let shares_raw = params
        .get("shares")
        .and_then(|v| v.as_str())
        .and_then(|s| BigDecimal::from_str(s).ok())
        .unwrap_or_else(|| zero.clone());

    if shares_raw == 0i64 {
        return Ok(());
    }

    // Query through the transaction connection so uncommitted inserts are visible.
    // Read shares_balance and avg_buy_share_price from the JSONB params column.
    // The CASE branch matches legacy Stellar `StakingDeposit` rows that lack
    // `owner` and store the share holder under `from` instead (see comment above).
    let prev: Option<(String, String)> = sqlx::query_as(
        "SELECT params->>'shares_balance', params->>'avg_buy_share_price'
         FROM contract_logs
         WHERE chain_id = $1
           AND LOWER(contract_address) = LOWER($2)
           AND LOWER(COALESCE(
               params->>'owner',
               CASE WHEN event_name = 'StakingDeposit' THEN params->>'from' END
           )) = $3
           AND event_name IN ('StakingDeposit', 'StakingWithdrawal')
           AND params ? 'shares_balance'
         ORDER BY block_number DESC, log_index DESC
         LIMIT 1",
    )
    .bind(chain_id)
    .bind(vault_address)
    .bind(&owner_address)
    .fetch_optional(&mut *conn)
    .await?;

    let (prev_shares, prev_avg_price) = match prev {
        Some((s, p)) => (
            BigDecimal::from_str(&s).unwrap_or_else(|_| zero.clone()),
            BigDecimal::from_str(&p).unwrap_or_else(|_| zero.clone()),
        ),
        None => (zero.clone(), zero.clone()),
    };

    let is_stake = event_name == "StakingDeposit";

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
                vault = vault_address,
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

    // Write computed position fields back into params.
    if let Some(obj) = params.as_object_mut() {
        obj.insert(
            "shares_balance".to_owned(),
            serde_json::Value::String(new_shares.to_string()),
        );
        obj.insert(
            "avg_buy_share_price".to_owned(),
            serde_json::Value::String(new_avg_price.to_string()),
        );
        obj.insert(
            "realized_pnl".to_owned(),
            serde_json::Value::String(realized_pnl.to_string()),
        );
    }

    Ok(())
}
