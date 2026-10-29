//! Allow-list of addresses authorized to authenticate against the API.
//!
//! Backs the signature-based JWT login flow (see
//! `docs/product-specs/api-authorization.md`). Rows are populated manually; this
//! repo only reads them and issues/consumes the per-user challenge `nonce`.
//!
//! Address normalization is the caller's responsibility (the API lowercases EVM
//! addresses and leaves Stellar `G…` Strkeys verbatim before calling these
//! methods) — the SQL here matches on `address` exactly.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

pub const NONCE_REUSE_MIN_REMAINING_SECS: i32 = 60;

pub const ISSUE_OR_REUSE_NONCE_SQL: &str = "UPDATE auth_users \
     SET nonce = CASE WHEN nonce IS NOT NULL AND nonce_expires_at > now() + make_interval(secs => $5::double precision) \
                      THEN nonce ELSE $3 END, \
         nonce_expires_at = CASE WHEN nonce IS NOT NULL AND nonce_expires_at > now() + make_interval(secs => $5::double precision) \
                      THEN nonce_expires_at ELSE now() + make_interval(secs => $4::double precision) END, \
         updated_at = now() \
     WHERE chain_id = $1 AND address = $2 \
     RETURNING nonce, nonce_expires_at";

pub const CONSUME_NONCE_SQL: &str = "UPDATE auth_users \
     SET nonce = NULL, nonce_expires_at = NULL, updated_at = now() \
     WHERE chain_id = $1 AND address = $2 AND nonce = $3 AND nonce_expires_at > now() \
     RETURNING chain_id, address, account_id, roles, nonce, nonce_expires_at, created_at, updated_at";

/// One row of the `auth_users` allow-list.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AuthUser {
    pub chain_id: i64,
    pub address: String,
    /// The account this wallet credential belongs to. Every row has one — the
    /// accounts migration backfilled pre-existing rows.
    pub account_id: Uuid,
    /// Roles copied into the issued JWT's `roles` claim.
    pub roles: Vec<String>,
    /// GUID of the current outstanding challenge; `None` until the first
    /// challenge is requested and again after a successful verify (single-use).
    pub nonce: Option<String>,
    pub nonce_expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct AuthUserRepo {
    pub pool: PgPool,
}

impl AuthUserRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Look up an authorized user by `(chain_id, address)`. Returns `None` when
    /// the address is not on the allow-list for that chain.
    pub async fn find(
        &self,
        chain_id: i64,
        address: &str,
    ) -> Result<Option<AuthUser>, sqlx::Error> {
        sqlx::query_as::<_, AuthUser>(
            "SELECT chain_id, address, account_id, roles, nonce, nonce_expires_at, created_at, updated_at \
             FROM auth_users WHERE chain_id = $1 AND address = $2",
        )
        .bind(chain_id)
        .bind(address)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn issue_or_reuse_nonce(
        &self,
        chain_id: i64,
        address: &str,
        fresh_nonce: &str,
        ttl_secs: i32,
    ) -> Result<Option<(String, DateTime<Utc>)>, sqlx::Error> {
        sqlx::query_as(ISSUE_OR_REUSE_NONCE_SQL)
            .bind(chain_id)
            .bind(address)
            .bind(fresh_nonce)
            .bind(ttl_secs)
            .bind(NONCE_REUSE_MIN_REMAINING_SECS)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn consume_nonce(
        &self,
        chain_id: i64,
        address: &str,
        nonce: &str,
    ) -> Result<Option<AuthUser>, sqlx::Error> {
        sqlx::query_as::<_, AuthUser>(CONSUME_NONCE_SQL)
            .bind(chain_id)
            .bind(address)
            .bind(nonce)
            .fetch_optional(&self.pool)
            .await
    }
}
