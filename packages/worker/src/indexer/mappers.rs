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
        let event_ref = if self.track_position && is_position_event_name(&self.event.event_name) {
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

/// Every event that moves a holder's share balance and therefore needs running
/// position fields computed pre-insert: the staking mint/burn pair plus
/// peer-to-peer `ShareTransfer` (Stellar only — the EVM indexer does not decode
/// ERC-20 transfers on the vault).
pub fn is_position_event_name(event_name: &str) -> bool {
    is_staking_event_name(event_name) || event_name == "ShareTransfer"
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
///
/// `ShareTransfer` rows are delegated to `compute_transfer_position_fields`,
/// which writes a per-side pair of fields instead of a single balance.
pub async fn compute_position_fields(
    conn: &mut PgConnection,
    chain_id: i64,
    vault_address: &str,
    event_name: &str,
    params: &mut Value,
) -> anyhow::Result<()> {
    if event_name == "ShareTransfer" {
        return compute_transfer_position_fields(conn, chain_id, vault_address, params).await;
    }

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

    let (prev_shares, prev_avg_price) =
        fetch_prev_position(&mut *conn, chain_id, vault_address, &owner_address).await?;

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

/// Latest `(shares_balance, avg_buy_share_price)` for one holder on one vault.
///
/// Reads the `position_events` view rather than `contract_logs` directly, so a
/// holder's most recent position is found whether it was last set by a staking
/// row or by either side of a `ShareTransfer`. Queried on the caller's
/// transaction connection so uncommitted inserts from the same batch are
/// visible — the running balance depends on strict event ordering.
///
/// Returns `(0, 0)` for a holder with no prior position.
async fn fetch_prev_position(
    conn: &mut PgConnection,
    chain_id: i64,
    vault_address: &str,
    holder: &str,
) -> anyhow::Result<(BigDecimal, BigDecimal)> {
    let prev: Option<(BigDecimal, BigDecimal)> = sqlx::query_as(
        "SELECT COALESCE(shares_balance, 0), COALESCE(avg_buy_share_price, 0)
         FROM position_events
         WHERE chain_id = $1
           AND LOWER(contract_address) = LOWER($2)
           AND holder = $3
         ORDER BY block_number DESC, log_index DESC
         LIMIT 1",
    )
    .bind(chain_id)
    .bind(vault_address)
    .bind(holder)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(prev.unwrap_or_else(|| (BigDecimal::from(0i64), BigDecimal::from(0i64))))
}

/// The two holders' positions after a share transfer, under carry-over basis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferPosition {
    pub shares_from: BigDecimal,
    pub avg_price_from: BigDecimal,
    pub shares_to: BigDecimal,
    pub avg_price_to: BigDecimal,
}

/// Carry-over-basis math for a share transfer. Pure — no DB, no I/O.
///
/// A transfer is not an economic disposal, so neither side realizes PnL and the
/// cost basis travels with the shares:
///
/// - **Sender** loses `amount` shares; average buy price is unchanged.
/// - **Receiver** gains `amount` shares carrying the sender's basis, weighted
///   into whatever position they already held.
///
/// This keeps protocol-wide PnL conserved: no gain or loss is created or
/// destroyed by moving shares between holders.
///
/// `self_transfer` (from == to) leaves both sides at the prior position — the
/// sender and receiver are the same holder, so the balance nets to zero change.
/// Without this case the two arms would disagree, since each is computed
/// against the same prior balance.
pub fn carry_over_transfer(
    prev_from: (BigDecimal, BigDecimal),
    prev_to: (BigDecimal, BigDecimal),
    amount: &BigDecimal,
    self_transfer: bool,
) -> TransferPosition {
    let zero = BigDecimal::from(0i64);
    let (prev_from_shares, prev_from_price) = prev_from;
    let (prev_to_shares, prev_to_price) = prev_to;

    if self_transfer {
        return TransferPosition {
            shares_from: prev_from_shares.clone(),
            avg_price_from: prev_from_price.clone(),
            shares_to: prev_from_shares,
            avg_price_to: prev_from_price,
        };
    }

    // Clamp rather than go negative. A negative balance means indexed history is
    // incomplete (a missed event, or a transfer predating the vault's indexed
    // start block) — the caller logs it.
    let shares_from = if prev_from_shares < *amount {
        zero.clone()
    } else {
        &prev_from_shares - amount
    };

    let shares_to = &prev_to_shares + amount;
    let avg_price_to = if shares_to > zero {
        (&prev_to_price * &prev_to_shares + &prev_from_price * amount) / &shares_to
    } else {
        zero
    };

    TransferPosition {
        shares_from,
        avg_price_from: prev_from_price,
        shares_to,
        avg_price_to,
    }
}

/// Compute both sides of a `ShareTransfer` and write them into `params`.
///
/// `contract_logs` permits one row per on-chain event, but a transfer moves two
/// holders' balances — so the row carries a `_from` / `_to` pair of fields
/// rather than the single `shares_balance` a staking row writes. The
/// `position_events` view fans these back out to one row per holder for readers.
///
/// `realized_pnl` is written as `0` (rather than omitted) so the field is
/// present on every position-bearing row and `PositionRepo`'s `SUM` over
/// `realized_pnl` stays well-defined.
async fn compute_transfer_position_fields(
    conn: &mut PgConnection,
    chain_id: i64,
    vault_address: &str,
    params: &mut Value,
) -> anyhow::Result<()> {
    let from = params
        .get("from")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_lowercase();
    let to = params
        .get("to")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_lowercase();

    let amount = params
        .get("amount")
        .and_then(|v| v.as_str())
        .and_then(|s| BigDecimal::from_str(s).ok())
        .unwrap_or_else(|| BigDecimal::from(0i64));

    // A zero-amount transfer moves nothing; skip it so it doesn't become a
    // no-op link in the running-balance chain.
    if amount == 0i64 || from.is_empty() || to.is_empty() {
        return Ok(());
    }

    let self_transfer = from == to;
    let prev_from = fetch_prev_position(&mut *conn, chain_id, vault_address, &from).await?;
    let prev_to = if self_transfer {
        prev_from.clone()
    } else {
        fetch_prev_position(&mut *conn, chain_id, vault_address, &to).await?
    };

    if !self_transfer && prev_from.0 < amount {
        tracing::warn!(
            vault = vault_address,
            from = %from,
            prev_shares = %prev_from.0,
            transferred = %amount,
            "share transfer exceeds sender balance — clamping to zero"
        );
    }

    let next = carry_over_transfer(prev_from, prev_to, &amount, self_transfer);

    if let Some(obj) = params.as_object_mut() {
        obj.insert(
            "shares_balance_from".to_owned(),
            Value::String(next.shares_from.to_string()),
        );
        obj.insert(
            "avg_buy_share_price_from".to_owned(),
            Value::String(next.avg_price_from.to_string()),
        );
        obj.insert(
            "shares_balance_to".to_owned(),
            Value::String(next.shares_to.to_string()),
        );
        obj.insert(
            "avg_buy_share_price_to".to_owned(),
            Value::String(next.avg_price_to.to_string()),
        );
        obj.insert("realized_pnl".to_owned(), Value::String("0".to_owned()));
    }

    Ok(())
}
