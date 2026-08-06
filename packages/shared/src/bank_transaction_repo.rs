//! Manually-entered bank-account ledger (`bank_transactions`).
//!
//! Originally backed `trust_account` on `GET /v1/capital-allocation` (#924):
//! `trust_account = sum(deposits) - sum(withdrawals) - sum(fees)`. **Decoupled by
//! #1027** — capital-allocation now sources `trust_account` from the per-loan
//! `loan_capital_transfers` table instead, so `trust_account_balance()` has no
//! remaining callers. This ledger (endpoint, repo, and table) is kept only until
//! its removal, tracked in #1029. The trust account is a single real-world bank
//! account for the whole protocol, not a per-chain concept, so this table (and
//! this repo) is deliberately **not** chain-scoped — mirrors `loan_asset_prices`,
//! which is global for the same reason.
//!
//! Append-only: `insert` is the only write. A bookkeeping correction is posted as a
//! new offsetting entry, never an edit — same audit rationale as `loan_assays`/
//! `loan_offtake_terms` (#914).
//!
//! `amount` is a **plain dollar figure**, not base-6/on-chain-scaled — a bank
//! transaction has no on-chain native scale to normalize against.

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;

/// Which ledger bucket a `bank_transactions` row belongs to. Stored as TEXT
/// (CHECK-constrained to these three values); serializes to the same strings on the
/// wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum BankTransactionType {
    Deposit,
    Withdrawal,
    Fee,
}

impl BankTransactionType {
    /// The exact string stored in the DB and emitted on the wire.
    pub fn as_str(self) -> &'static str {
        match self {
            BankTransactionType::Deposit => "Deposit",
            BankTransactionType::Withdrawal => "Withdrawal",
            BankTransactionType::Fee => "Fee",
        }
    }
}

/// Error decoding an unrecognised `transaction_type` string.
#[derive(Debug, thiserror::Error)]
#[error("unknown transaction_type `{0}` (expected Deposit, Withdrawal, or Fee)")]
pub struct UnknownBankTransactionType(pub String);

impl TryFrom<String> for BankTransactionType {
    type Error = UnknownBankTransactionType;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        match s.as_str() {
            "Deposit" => Ok(BankTransactionType::Deposit),
            "Withdrawal" => Ok(BankTransactionType::Withdrawal),
            "Fee" => Ok(BankTransactionType::Fee),
            _ => Err(UnknownBankTransactionType(s)),
        }
    }
}

pub struct BankTransactionRepo {
    pool: PgPool,
}

impl BankTransactionRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Append a new bank-transaction entry. `recorded_by` is the audit trail;
    /// callers must pass the authenticated operator identity, never a
    /// client-supplied value.
    pub async fn insert(
        &self,
        transaction_type: BankTransactionType,
        amount: &BigDecimal,
        payment_reference: Option<&str>,
        occurred_at: DateTime<Utc>,
        recorded_by: &str,
    ) -> Result<i64, sqlx::Error> {
        let (id,) = sqlx::query_as::<_, (i64,)>(
            "INSERT INTO bank_transactions \
                (transaction_type, amount, payment_reference, occurred_at, recorded_by) \
             VALUES ($1, $2, $3, $4, $5) \
             RETURNING id",
        )
        .bind(transaction_type.as_str())
        .bind(amount)
        .bind(payment_reference)
        .bind(occurred_at)
        .bind(recorded_by)
        .fetch_one(&self.pool)
        .await?;
        Ok(id)
    }

    /// `sum(deposits) - sum(withdrawals) - sum(fees)` across the whole ledger.
    /// `0` when the ledger is empty (`COALESCE`, not `NULL`) — not clamped otherwise:
    /// a negative result means withdrawals/fees exceed recorded deposits, a real
    /// bookkeeping error that should surface, not be hidden.
    pub async fn trust_account_balance(&self) -> Result<BigDecimal, sqlx::Error> {
        let (balance,): (BigDecimal,) = sqlx::query_as(
            "SELECT \
                COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'Deposit'), 0) \
              - COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'Withdrawal'), 0) \
              - COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'Fee'), 0) \
             FROM bank_transactions",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(balance)
    }
}
