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
    withdrawal_queue_wallet: Option<String>,
}

impl ContractLogMapper {
    pub fn new(event: ContractLog, chain_id: i64, repo: Arc<EventRepo>) -> Self {
        Self {
            event,
            chain_id,
            repo,
            track_position: false,
            withdrawal_queue_wallet: None,
        }
    }

    pub fn with_position_tracking(mut self) -> Self {
        self.track_position = true;
        self
    }

    pub fn with_withdrawal_queue_wallet(mut self, wallet: Option<String>) -> Self {
        self.withdrawal_queue_wallet = wallet;
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
        let track_position = self.track_position && is_position_event_name(&self.event.event_name);
        let wallet = self
            .withdrawal_queue_wallet
            .as_deref()
            .filter(|_| self.event.event_name == "AssetTransfer");
        if !track_position && wallet.is_none() {
            return self.repo.insert_log(conn, &self.event, self.chain_id).await;
        }

        let mut event = clone_contract_log(&self.event);
        let contract_address = event.contract_address.to_checksum(None);
        if track_position {
            compute_position_fields(
                conn,
                self.chain_id,
                &contract_address,
                &event.event_name,
                &mut event.params,
            )
            .await?;
        }
        if let Some(wallet) = wallet {
            compute_wallet_balance_field(
                conn,
                self.chain_id,
                &contract_address,
                wallet,
                &mut event.params,
            )
            .await?;
        }

        self.repo.insert_log(conn, &event, self.chain_id).await
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

    let (new_shares, new_avg_price, realized_pnl) = apply_position_delta(
        event_name == "StakingDeposit",
        &prev_shares,
        &prev_avg_price,
        &shares_raw,
        &assets_raw,
    );
    if event_name != "StakingDeposit" && shares_raw > prev_shares {
        tracing::warn!(
            vault = vault_address,
            owner = %owner_address,
            prev_shares = %prev_shares,
            withdrawn = %shares_raw,
            "withdrawal exceeds balance — clamping to zero"
        );
    }

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

/// Running position after a stake (`is_stake`) or a withdrawal of `shares` worth `assets`:
/// `(shares_balance, avg_buy_share_price, realized_pnl)`.
pub fn apply_position_delta(
    is_stake: bool,
    prev_shares: &BigDecimal,
    prev_avg_price: &BigDecimal,
    shares: &BigDecimal,
    assets: &BigDecimal,
) -> (BigDecimal, BigDecimal, BigDecimal) {
    let zero = BigDecimal::from(0i64);
    if is_stake {
        let new_shares = prev_shares + shares;
        let avg = if new_shares > zero {
            (prev_avg_price * prev_shares + assets) / &new_shares
        } else {
            zero.clone()
        };
        return (new_shares, avg, zero);
    }
    let new_shares = prev_shares - shares;
    if new_shares < zero {
        let realized = assets - prev_shares * prev_avg_price;
        (zero.clone(), zero, realized)
    } else {
        let realized = assets - shares * prev_avg_price;
        (new_shares, prev_avg_price.clone(), realized)
    }
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

/// Compute a running USDC balance for `wallet` (the Withdrawal Queue Wallet)
/// and write it into `params.wallet_balance_after` (Issue #933) — same
/// pre-insert pattern as `compute_position_fields` for staking, so the current
/// (or as-of-any-block) balance is queryable straight from `contract_logs`
/// without re-summing every transfer at read time.
///
/// No-op (leaves `params` untouched) when neither `from` nor `to` is `wallet`
/// — this also covers custody/ramp-only rows persisted by the `#[789]`
/// internal-movement filter, which don't touch the wallet at all.
pub async fn compute_wallet_balance_field(
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
