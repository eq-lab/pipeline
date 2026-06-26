//! Allow-list of addresses authorized to authenticate against the API.
//!
//! Backs the signature-based JWT login flow (see
//! `docs/product-specs/api-authorization.md`). Rows are populated manually; this
//! repo only reads them and rotates/clears the per-user challenge `nonce`.
//!
//! Address normalization is the caller's responsibility (the API lowercases EVM
//! addresses and leaves Stellar `G…` Strkeys verbatim before calling these
//! methods) — the SQL here matches on `address` exactly.

use chrono::{DateTime, Utc};
use sqlx::PgPool;

/// One row of the `auth_users` allow-list.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AuthUser {
    pub chain_id: i64,
    pub address: String,
    /// Roles copied into the issued JWT's `roles` claim.
    pub roles: Vec<String>,
    /// GUID of the current outstanding challenge; `None` until the first
    /// challenge is requested and again after a successful verify (single-use).
    pub nonce: Option<String>,
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
            "SELECT chain_id, address, roles, nonce, created_at, updated_at \
             FROM auth_users WHERE chain_id = $1 AND address = $2",
        )
        .bind(chain_id)
        .bind(address)
        .fetch_optional(&self.pool)
        .await
    }

    /// Store a freshly-generated challenge `nonce` for the user, overwriting any
    /// previous one.
    pub async fn set_nonce(
        &self,
        chain_id: i64,
        address: &str,
        nonce: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE auth_users SET nonce = $3, updated_at = now() \
             WHERE chain_id = $1 AND address = $2",
        )
        .bind(chain_id)
        .bind(address)
        .bind(nonce)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Clear the challenge `nonce` after a successful login (single-use).
    pub async fn clear_nonce(&self, chain_id: i64, address: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE auth_users SET nonce = NULL, updated_at = now() \
             WHERE chain_id = $1 AND address = $2",
        )
        .bind(chain_id)
        .bind(address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
