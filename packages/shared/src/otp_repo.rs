//! Outstanding email-verification passcodes and password-reset tokens
//! (`packages/shared/migrations/20260922000001_accounts_email_password_auth.sql`).
//!
//! Codes are stored hashed and are single-use. Issuing a new code supersedes any
//! outstanding one for the account, so a resend invalidates whatever was mailed
//! before it — a user who requests a second code cannot verify with the first.
//!
//! Both controls on this table — the resend cooldown and the attempt cap — are
//! enforced **in SQL under a row lock**, not by reading a row and deciding in
//! Rust. Read-then-write loses the race the controls exist to stop: concurrent
//! requests all observe the same pre-write state and all proceed, which turns
//! "one guess per code" and "one code per 60s" into "as many as you can send
//! at once".
//!
//! Burning a code on successful verification lives on
//! `AccountRepo::verify_email_consuming_code`, not here: it has to happen in the
//! same transaction as installing the password and marking the email verified.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

pub const PURPOSE_EMAIL_VERIFICATION: &str = "EmailVerification";
pub const PURPOSE_PASSWORD_RESET: &str = "PasswordReset";

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OtpCode {
    pub id: i64,
    pub account_id: Uuid,
    pub code_hash: String,
    /// The password to install when this code is verified — see the migration.
    pub pending_password_hash: Option<String>,
    pub purpose: String,
    pub expires_at: DateTime<Utc>,
    pub consumed_at: Option<DateTime<Utc>>,
    pub attempts: i32,
    pub created_at: DateTime<Utc>,
}

pub struct OtpRepo {
    pub pool: PgPool,
}

const COLUMNS: &str = "id, account_id, code_hash, pending_password_hash, purpose, \
                       expires_at, consumed_at, attempts, created_at";

impl OtpRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Supersede any outstanding code and store a new one, unless another was
    /// issued inside `cooldown_secs`. Returns whether a code was actually
    /// issued.
    ///
    /// The account row is locked first so that concurrent signup/resend requests
    /// for one address serialize: without it every caller reads "no recent code"
    /// together and every caller sends.
    pub async fn issue(
        &self,
        account_id: Uuid,
        code_hash: &str,
        pending_password_hash: &str,
        ttl_secs: i32,
        cooldown_secs: i32,
    ) -> Result<bool, sqlx::Error> {
        self.issue_for(
            PURPOSE_EMAIL_VERIFICATION,
            account_id,
            code_hash,
            Some(pending_password_hash),
            ttl_secs,
            cooldown_secs,
        )
        .await
    }

    pub async fn issue_password_reset(
        &self,
        account_id: Uuid,
        token_hash: &str,
        ttl_secs: i32,
        cooldown_secs: i32,
    ) -> Result<bool, sqlx::Error> {
        self.issue_for(
            PURPOSE_PASSWORD_RESET,
            account_id,
            token_hash,
            None,
            ttl_secs,
            cooldown_secs,
        )
        .await
    }

    async fn issue_for(
        &self,
        purpose: &str,
        account_id: Uuid,
        code_hash: &str,
        pending_password_hash: Option<&str>,
        ttl_secs: i32,
        cooldown_secs: i32,
    ) -> Result<bool, sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        sqlx::query("SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE")
            .bind(account_id)
            .fetch_optional(&mut *tx)
            .await?;

        // `SELECT 1` is INT4; decoding it as i64 fails at runtime, and only on the
        // path where a recent row actually exists — i.e. only when the cooldown
        // fires.
        let recent: Option<(i32,)> = sqlx::query_as(
            "SELECT 1 FROM otp_codes \
             WHERE account_id = $1 AND purpose = $2 \
               AND created_at > now() - make_interval(secs => $3::double precision) \
             LIMIT 1",
        )
        .bind(account_id)
        .bind(purpose)
        .bind(cooldown_secs)
        .fetch_optional(&mut *tx)
        .await?;
        if recent.is_some() {
            tx.rollback().await?;
            return Ok(false);
        }

        sqlx::query(
            "UPDATE otp_codes SET consumed_at = now() \
             WHERE account_id = $1 AND purpose = $2 AND consumed_at IS NULL",
        )
        .bind(account_id)
        .bind(purpose)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO otp_codes \
               (account_id, code_hash, pending_password_hash, purpose, expires_at) \
             VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5::double precision))",
        )
        .bind(account_id)
        .bind(code_hash)
        .bind(pending_password_hash)
        .bind(purpose)
        .bind(ttl_secs)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(true)
    }

    pub async fn is_live_password_reset(&self, token_hash: &str) -> Result<bool, sqlx::Error> {
        let live: Option<(i32,)> = sqlx::query_as(
            "SELECT 1 FROM otp_codes \
             WHERE code_hash = $1 AND purpose = $2 \
               AND consumed_at IS NULL AND expires_at > now()",
        )
        .bind(token_hash)
        .bind(PURPOSE_PASSWORD_RESET)
        .fetch_optional(&self.pool)
        .await?;
        Ok(live.is_some())
    }

    /// Burn a passcode outright. Called when a supplied code does not match: the
    /// attempt budget already makes the row unusable, but leaving `consumed_at`
    /// NULL means the table says "still outstanding" about something that is
    /// dead, which anyone reading it — a query, a support tool — would believe.
    pub async fn invalidate(&self, id: i64) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// The password riding on the account's newest code, so a resend can carry it
    /// forward unchanged. `None` when there is no code to carry one.
    pub async fn latest_pending_password_hash(
        &self,
        account_id: Uuid,
    ) -> Result<Option<String>, sqlx::Error> {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT pending_password_hash FROM otp_codes \
             WHERE account_id = $1 AND purpose = $2 \
             ORDER BY created_at DESC, id DESC LIMIT 1",
        )
        .bind(account_id)
        .bind(PURPOSE_EMAIL_VERIFICATION)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.and_then(|r| r.0))
    }

    /// Spend one verification attempt against the account's newest code and
    /// return that code, or `None` when there is nothing live to spend against —
    /// no code, already consumed, expired, or the attempt cap reached.
    ///
    /// One statement, so the check and the increment cannot be separated: the cap
    /// is the stated defence over a 10⁶ code space, and a read-then-increment
    /// version lets N parallel guesses all pass a cap of 5.
    pub async fn claim_attempt(
        &self,
        account_id: Uuid,
        max_attempts: i32,
    ) -> Result<Option<OtpCode>, sqlx::Error> {
        sqlx::query_as::<_, OtpCode>(&format!(
            "UPDATE otp_codes SET attempts = attempts + 1 \
             WHERE id = ( \
                 SELECT id FROM otp_codes \
                 WHERE account_id = $1 AND purpose = $2 \
                 ORDER BY created_at DESC, id DESC LIMIT 1 \
             ) \
               AND consumed_at IS NULL \
               AND expires_at > now() \
               AND attempts < $3 \
             RETURNING {COLUMNS}"
        ))
        .bind(account_id)
        .bind(PURPOSE_EMAIL_VERIFICATION)
        .bind(max_attempts)
        .fetch_optional(&self.pool)
        .await
    }
}
