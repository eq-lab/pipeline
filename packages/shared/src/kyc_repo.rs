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
    pub kyc_status: i16,
    pub kyc_review_status: i16,
    pub aml_status: i16,
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
    pub sender: Option<String>,
    pub receiver: Option<String>,
    pub amount: Option<bigdecimal::BigDecimal>,
    pub tx_hash: String,
    pub chain_id: i64,
}

impl KycRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn get_lp_profile(&self, wallet_address: &str) -> anyhow::Result<Option<LpProfile>> {
        let row = sqlx::query_as::<_, LpProfile>(
            "SELECT wallet_address, sumsub_applicant_id, kyc_status, kyc_review_status, aml_status, created_at, updated_at
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
             RETURNING wallet_address, sumsub_applicant_id, kyc_status, kyc_review_status, aml_status, created_at, updated_at",
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

    pub async fn update_kyc_status(
        &self,
        wallet_address: &str,
        kyc_status: Option<KycStatus>,
        review_status: KycReviewStatus,
        aml_status: Option<AmlStatus>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles SET
                kyc_status = COALESCE($2, kyc_status),
                kyc_review_status = $3,
                aml_status = COALESCE($4, aml_status),
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
        let rows = match (sumsub_enabled, crystal_enabled) {
            (true, true) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT wallet_address FROM lp_profiles
                     WHERE kyc_status = 2
                       AND kyc_review_status = 2
                       AND aml_status = 2
                       AND (kyt_status IS NULL OR kyt_status != 2)
                       AND (is_whitelisted IS NULL OR whitelist_reset_at <= NOW())",
                )
                .fetch_all(&self.pool)
                .await?
            }
            (true, false) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT wallet_address FROM lp_profiles
                     WHERE kyc_status = 2
                       AND kyc_review_status = 2
                       AND aml_status = 2
                       AND (is_whitelisted IS NULL OR whitelist_reset_at <= NOW())",
                )
                .fetch_all(&self.pool)
                .await?
            }
            (false, true) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT wallet_address FROM lp_profiles
                     WHERE (kyt_status IS NULL OR kyt_status != 2)
                       AND (is_whitelisted IS NULL OR whitelist_reset_at <= NOW())",
                )
                .fetch_all(&self.pool)
                .await?
            }
            (false, false) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT wallet_address FROM lp_profiles
                     WHERE is_whitelisted IS NULL OR whitelist_reset_at <= NOW()",
                )
                .fetch_all(&self.pool)
                .await?
            }
        };
        Ok(rows)
    }

    pub async fn fetch_profiles_to_disallow(
        &self,
        sumsub_enabled: bool,
        crystal_enabled: bool,
    ) -> anyhow::Result<Vec<WhitelistCandidate>> {
        let rows = match (sumsub_enabled, crystal_enabled) {
            (true, true) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT wallet_address FROM lp_profiles
                     WHERE is_whitelisted = true
                       AND (whitelist_reset_at <= NOW()
                            OR kyt_status = 2
                            OR kyc_status != 2
                            OR aml_status = 3)",
                )
                .fetch_all(&self.pool)
                .await?
            }
            (true, false) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT wallet_address FROM lp_profiles
                     WHERE is_whitelisted = true
                       AND (whitelist_reset_at <= NOW()
                            OR kyc_status != 2
                            OR aml_status = 3)",
                )
                .fetch_all(&self.pool)
                .await?
            }
            (false, true) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT wallet_address FROM lp_profiles
                     WHERE is_whitelisted = true
                       AND (whitelist_reset_at <= NOW()
                            OR kyt_status = 2)",
                )
                .fetch_all(&self.pool)
                .await?
            }
            (false, false) => {
                sqlx::query_as::<_, WhitelistCandidate>(
                    "SELECT wallet_address FROM lp_profiles
                     WHERE is_whitelisted = true
                       AND whitelist_reset_at <= NOW()",
                )
                .fetch_all(&self.pool)
                .await?
            }
        };
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

    pub async fn set_disallowed(&self, wallet_address: &str) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles
             SET is_whitelisted = false, whitelist_reset_at = NULL, updated_at = NOW()
             WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn fetch_unverified_transfers(
        &self,
        batch_size: i64,
    ) -> anyhow::Result<Vec<UnverifiedTransfer>> {
        let rows = sqlx::query_as::<_, UnverifiedTransfer>(
            "SELECT id, sender, receiver, amount, tx_hash, chain_id
             FROM contract_logs
             WHERE event_name = 'Transfer' AND kyt_status IS NULL
             ORDER BY id
             LIMIT $1",
        )
        .bind(batch_size)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn set_transfer_kyt_status(
        &self,
        log_id: i64,
        kyt_status: i16,
    ) -> anyhow::Result<()> {
        sqlx::query("UPDATE contract_logs SET kyt_status = $2 WHERE id = $1")
            .bind(log_id)
            .bind(kyt_status)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_profile_kyt_failed(&self, wallet_address: &str) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles SET kyt_status = 2, updated_at = NOW() WHERE wallet_address = $1",
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
        tx_risk: Option<f32>,
        tx_signals: Option<&serde_json::Value>,
        sender_risk: Option<f32>,
        sender_signals: Option<&serde_json::Value>,
        screened_at: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE contract_logs
             SET crystal_tx_risk = $2,
                 crystal_tx_signals = $3,
                 crystal_sender_risk = $4,
                 crystal_sender_signals = $5,
                 crystal_screened_at = $6
             WHERE id = $1",
        )
        .bind(log_id)
        .bind(tx_risk)
        .bind(tx_signals)
        .bind(sender_risk)
        .bind(sender_signals)
        .bind(screened_at)
        .execute(&self.pool)
        .await?;
        Ok(())
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
