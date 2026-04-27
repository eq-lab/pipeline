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
pub struct KycOutboxRow {
    pub id: i64,
    pub wallet_address: String,
    pub review_status: i16,
    pub kyc_status: Option<i16>,
    pub created_at: DateTime<Utc>,
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
