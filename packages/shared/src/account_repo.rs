//! The API's principal: an account, which holds credentials rather than being one.
//!
//! Backs LP self-serve email signup (see `docs/product-specs/api-authorization.md`
//! and `packages/shared/migrations/20260922000001_accounts_email_password_auth.sql`).
//! A wallet identity in `auth_users` points at an account; an email identity is
//! the `email`/`password_hash` pair on the account row itself.
//!
//! Email normalization (trim + lowercase) is the caller's responsibility — the
//! SQL here matches on `email` exactly, and the table rejects a mixed-case value.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Account {
    pub id: Uuid,
    /// `None` for a wallet-only account that never registered an email.
    pub email: Option<String>,
    /// Argon2id PHC string. `None` until a password is set.
    pub password_hash: Option<String>,
    /// `None` until the signup passcode is verified. An account in that state
    /// may not log in.
    pub email_verified_at: Option<DateTime<Utc>>,
    /// When this address was last told that somebody tried to re-register it.
    /// Throttles that notice so signup cannot be used to mail-bomb an LP.
    pub last_duplicate_notice_at: Option<DateTime<Utc>>,
    /// `Active` | `Suspended`.
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Account {
    pub fn is_email_verified(&self) -> bool {
        self.email_verified_at.is_some()
    }

    pub fn is_active(&self) -> bool {
        self.status == "Active"
    }
}

pub struct AccountRepo {
    pub pool: PgPool,
}

const COLUMNS: &str = "id, email, password_hash, email_verified_at, \
                       last_duplicate_notice_at, status, created_at, updated_at";

impl AccountRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn find_by_email(&self, email: &str) -> Result<Option<Account>, sqlx::Error> {
        sqlx::query_as::<_, Account>(&format!("SELECT {COLUMNS} FROM accounts WHERE email = $1"))
            .bind(email)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn find(&self, id: Uuid) -> Result<Option<Account>, sqlx::Error> {
        sqlx::query_as::<_, Account>(&format!("SELECT {COLUMNS} FROM accounts WHERE id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Create an unverified email account with **no password**. The submitted
    /// password rides on the passcode instead and is installed when that passcode
    /// is verified (see `OtpRepo` and the migration) — an account nobody has
    /// proved they own must not carry a credential a stranger chose.
    ///
    /// Returns `None` when the address was taken in the window between the
    /// caller's lookup and this insert — the caller answers `202` either way, so
    /// a race is not an error.
    pub async fn insert_unverified_account(
        &self,
        email: &str,
    ) -> Result<Option<Uuid>, sqlx::Error> {
        let row: Option<(Uuid,)> = sqlx::query_as(
            "INSERT INTO accounts (id, email) VALUES ($1, $2) \
             ON CONFLICT (email) DO NOTHING RETURNING id",
        )
        .bind(Uuid::new_v4())
        .bind(email)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| r.0))
    }

    /// Claim the right to send this account a "someone tried to sign up" notice,
    /// at most once per `cooldown_secs`. One conditional UPDATE, so concurrent
    /// callers cannot all claim it: without the throttle, signup is an unlimited
    /// way to mail an address Pipeline already has on file.
    pub async fn claim_duplicate_notice(
        &self,
        id: Uuid,
        cooldown_secs: i32,
    ) -> Result<bool, sqlx::Error> {
        let claimed: Option<(Uuid,)> = sqlx::query_as(
            "UPDATE accounts SET last_duplicate_notice_at = now(), updated_at = now() \
             WHERE id = $1 \
               AND (last_duplicate_notice_at IS NULL \
                    OR last_duplicate_notice_at < now() - make_interval(secs => $2::double precision)) \
             RETURNING id",
        )
        .bind(id)
        .bind(cooldown_secs)
        .fetch_optional(&self.pool)
        .await?;
        Ok(claimed.is_some())
    }

    /// Burn the passcode, install the password it carried, and mark the email
    /// verified — one transaction, because the three are worthless apart. A
    /// burn-then-fail would leave the caller unverified holding a spent code,
    /// with nothing to do but wait out the cooldown for another; installing the
    /// password separately would reopen the window this design closes.
    ///
    /// `password_hash` is whatever the *verified* code carried, so the password
    /// that lands is always the one submitted alongside that code. Marking is
    /// idempotent — re-verifying keeps the original timestamp.
    pub async fn verify_email_consuming_code(
        &self,
        id: Uuid,
        otp_id: i64,
        password_hash: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE otp_codes SET consumed_at = now() WHERE id = $1")
            .bind(otp_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "UPDATE accounts \
             SET email_verified_at = COALESCE(email_verified_at, now()), \
                 password_hash = COALESCE($2, password_hash), \
                 updated_at = now() \
             WHERE id = $1",
        )
        .bind(id)
        .bind(password_hash)
        .execute(&mut *tx)
        .await?;
        tx.commit().await
    }
}
