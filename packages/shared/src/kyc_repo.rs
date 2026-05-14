use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::sumsub::models::{AmlStatus, KycReviewStatus, KycStatus};

pub struct KycRepo {
    pub pool: PgPool,
}

#[derive(sqlx::FromRow)]
pub struct LpProfile {
    pub wallet_address: String,
    pub sumsub_applicant_id: Option<String>,
    pub sumsub_kyc_status: i16,
    pub sumsub_review_status: i16,
    pub sumsub_aml_status: i16,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub struct WhitelistCandidate {
    pub wallet_address: String,
}

#[derive(sqlx::FromRow)]
pub struct KycOutboxRow {
    pub id: i64,
    pub wallet_address: String,
    pub review_status: i16,
    pub kyc_status: Option<i16>,
    pub created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub struct UnverifiedTransfer {
    pub id: i64,
    pub event_name: String,
    pub sender: Option<String>,
    pub receiver: Option<String>,
    pub amount: Option<bigdecimal::BigDecimal>,
    pub tx_hash: String,
    pub chain_id: i64,
}

#[derive(sqlx::FromRow)]
pub struct RequestInfo {
    pub request_id: Option<bigdecimal::BigDecimal>,
    pub sender: Option<String>,
    pub amount: Option<bigdecimal::BigDecimal>,
    pub crystal_kyt_status: Option<i16>,
    pub block_timestamp: i64,
}

#[derive(sqlx::FromRow)]
pub struct RequestEventRow {
    pub event_name: String,
    pub request_id: Option<bigdecimal::BigDecimal>,
    pub amount: Option<bigdecimal::BigDecimal>,
    pub crystal_kyt_status: Option<i16>,
    pub block_timestamp: i64,
    pub is_claimed: bool,
}

#[derive(serde::Serialize)]
pub struct GroupedRequest {
    #[serde(rename = "type")]
    pub request_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub amount: String,
    pub status: String,
    pub created_at: String,
}

impl From<RequestEventRow> for GroupedRequest {
    fn from(row: RequestEventRow) -> Self {
        let request_type = match row.event_name.as_str() {
            "DepositRequested" => "Deposit",
            "WithdrawalRequested" => "Withdraw",
            "StakingDeposit" => "Stake",
            "StakingWithdrawal" => "Unstake",
            other => other,
        };

        let status = match row.event_name.as_str() {
            "StakingDeposit" | "StakingWithdrawal" => "Completed",
            _ => {
                if row.is_claimed {
                    "Completed"
                } else {
                    match row.crystal_kyt_status {
                        Some(1) => "PendingClaim",
                        Some(_) => "VerificationFailed",
                        None => "PendingVerification",
                    }
                }
            }
        };

        let created_at = chrono::DateTime::from_timestamp(row.block_timestamp, 0)
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            .unwrap_or_default();

        Self {
            request_type: request_type.to_owned(),
            request_id: row.request_id.map(|r| r.to_string()),
            amount: row.amount.map(|a| a.to_string()).unwrap_or_default(),
            status: status.to_owned(),
            created_at,
        }
    }
}

pub struct CrystalTransferResult<'a> {
    pub crystal_kyt_status: i16,
    pub tx_risk: Option<f32>,
    pub tx_signals: Option<&'a serde_json::Value>,
    pub sender_risk: Option<f32>,
    pub sender_signals: Option<&'a serde_json::Value>,
    pub screened_at: DateTime<Utc>,
}

impl KycRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn get_lp_profile(&self, wallet_address: &str) -> anyhow::Result<Option<LpProfile>> {
        let row = sqlx::query_as::<_, LpProfile>(
            "SELECT wallet_address, sumsub_applicant_id, sumsub_kyc_status, sumsub_review_status, sumsub_aml_status, created_at, updated_at
             FROM lp_profiles WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    pub async fn create_lp_profile(&self, wallet_address: &str) -> anyhow::Result<LpProfile> {
        let row = sqlx::query_as::<_, LpProfile>(
            "INSERT INTO lp_profiles (wallet_address)
             VALUES ($1)
             ON CONFLICT (wallet_address) DO NOTHING
             RETURNING wallet_address, sumsub_applicant_id, sumsub_kyc_status, sumsub_review_status, sumsub_aml_status, created_at, updated_at",
        )
        .bind(wallet_address)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    pub async fn set_applicant_id(
        &self,
        wallet_address: &str,
        applicant_id: &str,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles SET sumsub_applicant_id = $2, updated_at = NOW() WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .bind(applicant_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_sumsub_status(
        &self,
        wallet_address: &str,
        kyc_status: Option<KycStatus>,
        review_status: KycReviewStatus,
        aml_status: Option<AmlStatus>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles SET
                sumsub_kyc_status = COALESCE($2, sumsub_kyc_status),
                sumsub_review_status = $3,
                sumsub_aml_status = COALESCE($4, sumsub_aml_status),
                updated_at = NOW()
             WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .bind(kyc_status.map(|s| s as i16))
        .bind(review_status as i16)
        .bind(aml_status.map(|s| s as i16))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert_outbox(
        &self,
        wallet_address: &str,
        review_status: KycReviewStatus,
        kyc_status: Option<KycStatus>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO kyc_outbox (wallet_address, review_status, kyc_status) VALUES ($1, $2, $3)",
        )
        .bind(wallet_address)
        .bind(review_status as i16)
        .bind(kyc_status.map(|s| s as i16))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn fetch_unprocessed_outbox(
        &self,
        batch_size: i64,
    ) -> anyhow::Result<Vec<KycOutboxRow>> {
        let rows = sqlx::query_as::<_, KycOutboxRow>(
            "SELECT id, wallet_address, review_status, kyc_status, created_at
             FROM kyc_outbox WHERE processed_at IS NULL ORDER BY created_at LIMIT $1",
        )
        .bind(batch_size)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn mark_outbox_processed(&self, id: i64) -> anyhow::Result<()> {
        sqlx::query("UPDATE kyc_outbox SET processed_at = NOW() WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn mark_outbox_error(&self, id: i64, error: &str) -> anyhow::Result<()> {
        sqlx::query("UPDATE kyc_outbox SET error = $2 WHERE id = $1")
            .bind(id)
            .bind(error)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn fetch_profiles_to_allow(
        &self,
        sumsub_enabled: bool,
        crystal_enabled: bool,
    ) -> anyhow::Result<Vec<WhitelistCandidate>> {
        // Only allow profiles that:
        // 1. Have not been allowed on-chain yet
        // 2. Have at least one DepositRequested with crystal_kyt_status = 1 (clear)
        // 3. Pass sumsub/crystal checks if enabled
        let rows = match (sumsub_enabled, crystal_enabled) {
            (true, true) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT p.wallet_address FROM lp_profiles p
                     WHERE p.on_chain_allowed = FALSE
                       AND p.sumsub_kyc_status = 2
                       AND p.sumsub_review_status = 2
                       AND p.sumsub_aml_status = 2
                       AND p.crystal_kyt_status = 1
                       AND EXISTS (
                           SELECT 1 FROM contract_logs c
                           WHERE c.event_name = 'DepositRequested'
                             AND LOWER(c.sender) = p.wallet_address
                             AND c.crystal_kyt_status = 1
                       )",
                )
                .fetch_all(&self.pool)
                .await?
            }
            (true, false) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT p.wallet_address FROM lp_profiles p
                     WHERE p.on_chain_allowed = FALSE
                       AND p.sumsub_kyc_status = 2
                       AND p.sumsub_review_status = 2
                       AND p.sumsub_aml_status = 2
                       AND EXISTS (
                           SELECT 1 FROM contract_logs c
                           WHERE c.event_name = 'DepositRequested'
                             AND LOWER(c.sender) = p.wallet_address
                             AND c.crystal_kyt_status = 1
                       )",
                )
                .fetch_all(&self.pool)
                .await?
            }
            (false, true) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT p.wallet_address FROM lp_profiles p
                     WHERE p.on_chain_allowed = FALSE
                       AND p.crystal_kyt_status = 1
                       AND EXISTS (
                           SELECT 1 FROM contract_logs c
                           WHERE c.event_name = 'DepositRequested'
                             AND LOWER(c.sender) = p.wallet_address
                             AND c.crystal_kyt_status = 1
                       )",
                )
                .fetch_all(&self.pool)
                .await?
            }
            (false, false) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT p.wallet_address FROM lp_profiles p
                     WHERE p.on_chain_allowed = FALSE
                       AND EXISTS (
                           SELECT 1 FROM contract_logs c
                           WHERE c.event_name = 'DepositRequested'
                             AND LOWER(c.sender) = p.wallet_address
                             AND c.crystal_kyt_status = 1
                       )",
                )
                .fetch_all(&self.pool)
                .await?
            }
        };
        Ok(rows)
    }

    pub async fn fetch_profiles_to_disallow(
        &self,
        _sumsub_enabled: bool,
        _crystal_enabled: bool,
    ) -> anyhow::Result<Vec<WhitelistCandidate>> {
        // Sanctions-only: disallow profiles that were allowed but now have crystal_kyt_status = 2 (failed)
        let rows = sqlx::query_as::<_, WhitelistCandidate>(
            "SELECT wallet_address FROM lp_profiles
             WHERE on_chain_allowed = TRUE AND crystal_kyt_status = 2",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn set_whitelisted(
        &self,
        wallet_address: &str,
        whitelist_reset_at: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles
             SET is_whitelisted = true, whitelist_reset_at = $2, updated_at = NOW()
             WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .bind(whitelist_reset_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn set_on_chain_allowed(&self, wallet_address: &str) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles SET on_chain_allowed = TRUE, updated_at = NOW() WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn set_disallowed(&self, wallet_address: &str) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles SET on_chain_allowed = FALSE, updated_at = NOW() WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Auto-create lp_profiles from DepositRequested events for addresses not yet tracked.
    pub async fn populate_profiles_from_deposits(&self) -> anyhow::Result<u64> {
        let result = sqlx::query(
            "INSERT INTO lp_profiles (wallet_address)
             SELECT DISTINCT LOWER(sender) FROM contract_logs
             WHERE event_name = 'DepositRequested' AND sender IS NOT NULL
             ON CONFLICT (wallet_address) DO NOTHING",
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn fetch_unverified_transfers(
        &self,
        batch_size: i64,
    ) -> anyhow::Result<Vec<UnverifiedTransfer>> {
        let rows = sqlx::query_as::<_, UnverifiedTransfer>(
            "SELECT id, event_name, sender, receiver, amount, tx_hash, chain_id
             FROM contract_logs
             WHERE event_name IN ('DepositRequested', 'WithdrawalRequested') AND crystal_kyt_status IS NULL
             ORDER BY id
             LIMIT $1",
        )
        .bind(batch_size)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn set_profile_kyt_clear(&self, wallet_address: &str) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles SET crystal_kyt_status = 1, updated_at = NOW() WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn set_profile_kyt_failed(&self, wallet_address: &str) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles SET crystal_kyt_status = 2, updated_at = NOW() WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn fetch_unscreened_profiles(
        &self,
        batch_size: i64,
    ) -> anyhow::Result<Vec<WhitelistCandidate>> {
        let rows = sqlx::query_as::<_, WhitelistCandidate>(
            "SELECT wallet_address FROM lp_profiles
             WHERE crystal_screened_at IS NULL
             ORDER BY created_at
             LIMIT $1",
        )
        .bind(batch_size)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn set_crystal_address_risk(
        &self,
        wallet_address: &str,
        risk: f32,
        signals: &serde_json::Value,
        screened_at: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles
             SET crystal_address_risk = $2,
                 crystal_address_risk_signals = $3,
                 crystal_screened_at = $4,
                 updated_at = NOW()
             WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .bind(risk)
        .bind(signals)
        .bind(screened_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn set_transfer_crystal_result(
        &self,
        log_id: i64,
        result: &CrystalTransferResult<'_>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE contract_logs
             SET crystal_kyt_status = $2,
                 crystal_tx_risk = $3,
                 crystal_tx_signals = $4,
                 crystal_sender_risk = $5,
                 crystal_sender_signals = $6,
                 crystal_screened_at = $7
             WHERE id = $1",
        )
        .bind(log_id)
        .bind(result.crystal_kyt_status)
        .bind(result.tx_risk)
        .bind(result.tx_signals)
        .bind(result.sender_risk)
        .bind(result.sender_signals)
        .bind(result.screened_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Check if a profile is on-chain allowed.
    pub async fn is_on_chain_allowed(&self, wallet_address: &str) -> anyhow::Result<bool> {
        let row: Option<(bool,)> =
            sqlx::query_as("SELECT on_chain_allowed FROM lp_profiles WHERE wallet_address = $1")
                .bind(wallet_address)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(v,)| v).unwrap_or(false))
    }

    /// Get a deposit request by request_id and wallet.
    pub async fn get_deposit_request(
        &self,
        request_id: &str,
        wallet: &str,
    ) -> anyhow::Result<Option<RequestInfo>> {
        let row = sqlx::query_as::<_, RequestInfo>(
            "SELECT request_id, sender, amount, crystal_kyt_status, block_timestamp
             FROM contract_logs
             WHERE event_name = 'DepositRequested'
               AND request_id::text = $1
               AND LOWER(sender) = $2
             LIMIT 1",
        )
        .bind(request_id)
        .bind(wallet)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    /// Get a withdrawal request by request_id and wallet.
    pub async fn get_withdrawal_request(
        &self,
        request_id: &str,
        wallet: &str,
    ) -> anyhow::Result<Option<RequestInfo>> {
        let row = sqlx::query_as::<_, RequestInfo>(
            "SELECT request_id, sender, amount, crystal_kyt_status, block_timestamp
             FROM contract_logs
             WHERE event_name = 'WithdrawalRequested'
               AND request_id::text = $1
               AND LOWER(sender) = $2
             LIMIT 1",
        )
        .bind(request_id)
        .bind(wallet)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    /// Check if a request has been claimed.
    pub async fn is_request_claimed(
        &self,
        claimed_event: &str,
        request_id: &str,
    ) -> anyhow::Result<bool> {
        let row: Option<(i64,)> = sqlx::query_as(
            "SELECT 1 FROM contract_logs
             WHERE event_name = $1 AND request_id::text = $2
             LIMIT 1",
        )
        .bind(claimed_event)
        .bind(request_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.is_some())
    }

    /// Get deposit/withdrawal/staking requests for a wallet.
    /// When `pending_only` is true, only returns requests that have not been claimed
    /// (staking events are always excluded from pending-only results as they are always Completed).
    pub async fn get_all_requests(
        &self,
        wallet: &str,
        pending_only: bool,
    ) -> anyhow::Result<Vec<GroupedRequest>> {
        let base = "SELECT r.event_name, r.request_id, r.amount, r.crystal_kyt_status,
                           r.block_timestamp,
                           EXISTS (
                               SELECT 1 FROM contract_logs c2
                               WHERE c2.event_name = 'RequestClaimed'
                                 AND c2.request_id = r.request_id
                                 AND c2.contract_address = r.contract_address
                           ) AS is_claimed
                    FROM contract_logs r
                    WHERE LOWER(r.sender) = $1
                      AND r.event_name IN ('DepositRequested', 'WithdrawalRequested', 'StakingDeposit', 'StakingWithdrawal')";

        let query = if pending_only {
            format!(
                "{base}
                      AND NOT EXISTS (
                          SELECT 1 FROM contract_logs c2
                          WHERE c2.event_name = 'RequestClaimed'
                            AND c2.request_id = r.request_id
                            AND c2.contract_address = r.contract_address
                      )
                      AND r.event_name NOT IN ('StakingDeposit', 'StakingWithdrawal')
                    ORDER BY r.block_timestamp DESC, r.id DESC"
            )
        } else {
            format!("{base} ORDER BY r.block_timestamp DESC, r.id DESC")
        };

        let rows = sqlx::query_as::<_, RequestEventRow>(&query)
            .bind(wallet)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(GroupedRequest::from).collect())
    }

    pub async fn update_lp_info(
        &self,
        wallet_address: &str,
        first_name: Option<&str>,
        last_name: Option<&str>,
        country: Option<&str>,
    ) -> anyhow::Result<()> {
        tracing::info!(
            wallet = wallet_address,
            first_name = first_name,
            last_name = last_name,
            country = country,
            "applicant info received from Sumsub (not stored — columns not yet added)"
        );
        Ok(())
    }
}
