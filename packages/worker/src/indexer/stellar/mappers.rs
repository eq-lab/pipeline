/// `StellarLogMapper` — implements `LogMapper` for Stellar/Soroban events.
///
/// Wraps a `StellarLog` and delegates DB operations to `EventRepo::insert_row`
/// (the chain-agnostic insert path that accepts a plain `contract_address: String`).
///
/// For `StakingDeposit` / `StakingWithdrawal` events, position fields
/// (`shares_balance`, `avg_buy_share_price`, `realized_pnl`) are computed
/// pre-insert via the shared `mappers::compute_position_fields` helper — same
/// path the EVM mapper uses. Without this, `/v1/pnl` and `PositionRepo`
/// summaries would never see Stellar positions.
///
/// `ShareTransfer` events go down the same path but write a per-side pair
/// (`shares_balance_from` / `shares_balance_to` and their `avg_buy_share_price`
/// counterparts), since one transfer moves two holders' balances.
///
/// For `AssetTransfer` events that touch the configured Withdrawal Queue
/// Wallet, a running `wallet_balance_after` field is computed the same way
/// (Issue #933) — see `compute_wallet_balance_field`.
use std::str::FromStr;
use std::sync::Arc;

use async_trait::async_trait;
use bigdecimal::BigDecimal;
use serde_json::Value;
use sqlx::PgConnection;

use shared::{db::EventRepo, events::EventRow, log_mapper::LogMapper};

use crate::indexer::mappers::{compute_position_fields, is_position_event_name};
use crate::indexer::stellar::parsers::StellarLog;

pub struct StellarLogMapper {
    log: StellarLog,
    chain_id: i64,
    repo: Arc<EventRepo>,
    /// Withdrawal Queue Wallet address — `Some` only when configured for this
    /// chain. Used to compute a running `wallet_balance_after` on `AssetTransfer`
    /// rows that touch it.
    withdrawal_queue_wallet_id: Option<String>,
}

impl StellarLogMapper {
    pub fn new(log: StellarLog, chain_id: i64, repo: Arc<EventRepo>) -> Self {
        Self {
            log,
            chain_id,
            repo,
            withdrawal_queue_wallet_id: None,
        }
    }

    /// Attach the Withdrawal Queue Wallet address so `insert` computes a
    /// running balance for `AssetTransfer` rows that touch it.
    pub fn with_withdrawal_queue_wallet(mut self, wallet_id: Option<String>) -> Self {
        self.withdrawal_queue_wallet_id = wallet_id;
        self
    }
}

#[async_trait]
impl LogMapper for StellarLogMapper {
    async fn is_duplicate(&self, conn: &mut PgConnection) -> anyhow::Result<bool> {
        self.repo
            .is_duplicate(
                conn,
                self.chain_id,
                &self.log.contract_address,
                self.log.block_number,
                self.log.log_index,
            )
            .await
    }

    async fn insert(&self, conn: &mut PgConnection) -> anyhow::Result<()> {
        let mut params = self.log.params.clone();
        if is_position_event_name(&self.log.event_name) {
            compute_position_fields(
                conn,
                self.chain_id,
                &self.log.contract_address,
                &self.log.event_name,
                &mut params,
            )
            .await?;
        }
        if self.log.event_name == "AssetTransfer" {
            if let Some(wallet) = &self.withdrawal_queue_wallet_id {
                compute_wallet_balance_field(
                    conn,
                    self.chain_id,
                    &self.log.contract_address,
                    wallet,
                    &mut params,
                )
                .await?;
            }
        }
        let row = EventRow {
            contract_address: self.log.contract_address.clone(),
            event_name: self.log.event_name.clone(),
            block_number: self.log.block_number,
            tx_hash: self.log.tx_hash.clone(),
            log_index: self.log.log_index,
            block_timestamp: self.log.block_timestamp,
            params,
        };
        self.repo.insert_row(conn, &row, self.chain_id).await
    }

    fn block_number(&self) -> u64 {
        self.log.block_number
    }

    /// No-op — Stellar mappers pre-populate `block_timestamp` from `ledgerClosedAt`
    /// during `poll()`. The trait method would otherwise clobber the real value with
    /// `0` from `StellarEventPoller::get_block_timestamp` (which doesn't have access
    /// to the per-event close time). The pre-populated value is authoritative.
    fn set_block_timestamp(&mut self, _ts: u64) {}
}

/// Compute a running USDC balance for `wallet` (the Withdrawal Queue Wallet)
/// and write it into `params.wallet_balance_after` (Issue #933) — same
/// pre-insert pattern as `compute_position_fields` for staking, so the current
/// (or as-of-any-block) balance is queryable straight from `contract_logs`
/// without re-summing every transfer at read time.
///
/// No-op (leaves `params` untouched) when neither `from` nor `to` is `wallet`
/// — this also covers custody/ramp-only rows persisted by the `#[789]`
/// internal-movement filter, which don't touch the wallet at all.
async fn compute_wallet_balance_field(
    conn: &mut PgConnection,
    chain_id: i64,
    asset_address: &str,
    wallet: &str,
    params: &mut Value,
) -> anyhow::Result<()> {
    let from = params.get("from").and_then(|v| v.as_str()).unwrap_or("");
    let to = params.get("to").and_then(|v| v.as_str()).unwrap_or("");
    let is_in = to == wallet;
    let is_out = from == wallet;
    if !is_in && !is_out {
        return Ok(());
    }

    let zero = BigDecimal::from(0i64);
    let amount = params
        .get("amount")
        .and_then(|v| v.as_str())
        .and_then(|s| BigDecimal::from_str(s).ok())
        .unwrap_or_else(|| zero.clone());

    // Query through the transaction connection so uncommitted inserts in the
    // same batch are visible, mirroring `compute_position_fields`.
    let prev: Option<String> = sqlx::query_scalar(
        "SELECT params->>'wallet_balance_after'
         FROM contract_logs
         WHERE chain_id = $1
           AND contract_address = $2
           AND event_name = 'AssetTransfer'
           AND (params->>'from' = $3 OR params->>'to' = $3)
           AND params ? 'wallet_balance_after'
         ORDER BY block_number DESC, log_index DESC
         LIMIT 1",
    )
    .bind(chain_id)
    .bind(asset_address)
    .bind(wallet)
    .fetch_optional(&mut *conn)
    .await?;

    let prev_balance = match prev {
        Some(s) => BigDecimal::from_str(&s).unwrap_or_else(|_| zero.clone()),
        None => zero.clone(),
    };

    // A self-transfer (from == to == wallet) nets to zero — both arms apply.
    let mut new_balance = prev_balance;
    if is_in {
        new_balance += &amount;
    }
    if is_out {
        new_balance -= &amount;
    }

    if let Some(obj) = params.as_object_mut() {
        obj.insert(
            "wallet_balance_after".to_owned(),
            serde_json::Value::String(new_balance.to_string()),
        );
    }

    Ok(())
}
