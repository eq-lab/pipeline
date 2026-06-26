//! JWT issuance and verification for signature-based API authorization.
//!
//! Login flow (see `docs/product-specs/api-authorization.md` and
//! `routes::auth`): a known address signs a server-issued challenge, the server
//! verifies the signature and issues a short-lived JWT carrying the address'
//! roles. Protected handlers then take the [`AuthClaims`] extractor, which
//! validates the `Authorization: Bearer <token>` header.
//!
//! Tokens are signed with **ES256** (P-256 ECDSA). Keys are PEM-encoded and read
//! from the environment; when they are absent the API still boots (auth is
//! simply unavailable), mirroring how Sumsub and per-chain signers degrade.

use std::sync::Arc;

use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use chrono::Utc;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, ToSchema};

use crate::error::ApiError;
use crate::AppState;

/// JWT lifetime: 24 hours.
pub const TOKEN_TTL_SECS: i64 = 24 * 60 * 60;

/// Algorithm used to sign and verify tokens.
const ALG: Algorithm = Algorithm::ES256;

/// Claims embedded in an issued JWT.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Claims {
    /// Subject — the authenticated wallet address (normalized form).
    pub sub: String,
    /// Chain the address authenticated on.
    pub chain_id: i64,
    /// Roles granted to the address, copied from the `auth_users` allow-list.
    pub roles: Vec<String>,
    /// Expiry (Unix seconds).
    pub exp: usize,
    /// Issued-at (Unix seconds).
    pub iat: usize,
}

impl Claims {
    /// Whether the authenticated address holds `role`.
    pub fn has_role(&self, role: &str) -> bool {
        self.roles.iter().any(|r| r == role)
    }
}

/// utoipa modifier that registers the `bearer_auth` HTTP bearer (JWT) security
/// scheme so Swagger UI shows an **Authorize** button. Apply via
/// `#[openapi(modifiers(&SecurityAddon))]` on any doc whose paths declare
/// `security(("bearer_auth" = []))`.
pub struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi
            .components
            .get_or_insert_with(utoipa::openapi::Components::new);
        components.add_security_scheme(
            "bearer_auth",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .build(),
            ),
        );
    }
}

/// Loaded ES256 signing/verification keys.
pub struct JwtKeys {
    encoding: EncodingKey,
    decoding: DecodingKey,
}

impl JwtKeys {
    /// Load ES256 keys from the environment.
    ///
    /// Reads PEM from `JWT_ES256_PRIVATE_KEY_PEM` and `JWT_ES256_PUBLIC_KEY_PEM`.
    /// Returns `Ok(None)` (with a warning) when neither is set, so the API can
    /// boot without auth configured. Returns `Err` when the vars are present but
    /// malformed, or only one of the pair is set.
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let priv_pem = std::env::var("JWT_ES256_PRIVATE_KEY_PEM").ok();
        let pub_pem = std::env::var("JWT_ES256_PUBLIC_KEY_PEM").ok();

        match (priv_pem, pub_pem) {
            (None, None) => {
                tracing::warn!(
                    "JWT_ES256_PRIVATE_KEY_PEM / JWT_ES256_PUBLIC_KEY_PEM not set — \
                     authorization endpoints disabled"
                );
                Ok(None)
            }
            (Some(priv_pem), Some(pub_pem)) => {
                let keys = Self::from_pem(&priv_pem, &pub_pem)?;
                tracing::info!("JWT ES256 keys loaded — authorization endpoints enabled");
                Ok(Some(keys))
            }
            _ => anyhow::bail!(
                "JWT_ES256_PRIVATE_KEY_PEM and JWT_ES256_PUBLIC_KEY_PEM must both be set or both unset"
            ),
        }
    }

    /// Build keys from ES256 PEM strings (private = PKCS#8, public = SPKI).
    pub fn from_pem(private_pem: &str, public_pem: &str) -> anyhow::Result<Self> {
        let encoding = EncodingKey::from_ec_pem(private_pem.as_bytes())
            .map_err(|e| anyhow::anyhow!("JWT ES256 private key is not a valid EC PEM: {e}"))?;
        let decoding = DecodingKey::from_ec_pem(public_pem.as_bytes())
            .map_err(|e| anyhow::anyhow!("JWT ES256 public key is not a valid EC PEM: {e}"))?;
        Ok(Self { encoding, decoding })
    }

    /// Issue a signed token for `address` on `chain_id` carrying `roles`,
    /// expiring [`TOKEN_TTL_SECS`] from now.
    pub fn issue_token(
        &self,
        address: &str,
        chain_id: i64,
        roles: Vec<String>,
    ) -> anyhow::Result<String> {
        let now = Utc::now().timestamp();
        let claims = Claims {
            sub: address.to_owned(),
            chain_id,
            roles,
            iat: now as usize,
            exp: (now + TOKEN_TTL_SECS) as usize,
        };
        jsonwebtoken::encode(&Header::new(ALG), &claims, &self.encoding)
            .map_err(|e| anyhow::anyhow!("failed to encode JWT: {e}"))
    }

    /// Decode and validate a token, returning its claims. Validates the
    /// signature and `exp` (expiry).
    pub fn decode_token(&self, token: &str) -> anyhow::Result<Claims> {
        let data = jsonwebtoken::decode::<Claims>(token, &self.decoding, &Validation::new(ALG))
            .map_err(|e| anyhow::anyhow!("invalid token: {e}"))?;
        Ok(data.claims)
    }
}

/// Extractor that authenticates a request via its `Authorization: Bearer <jwt>`
/// header. Yields the decoded [`Claims`]; rejects with `401` when the header is
/// missing/malformed, the token is invalid/expired, or auth is not configured.
///
/// Reference usage — protect a handler by taking this as an argument:
/// ```ignore
/// async fn handler(AuthClaims(claims): AuthClaims) -> Json<Claims> { Json(claims) }
/// ```
pub struct AuthClaims(pub Claims);

impl FromRequestParts<Arc<AppState>> for AuthClaims {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let keys = state
            .jwt_keys
            .as_ref()
            .ok_or_else(|| ApiError::Unauthorized("authorization is not configured".to_owned()))?;

        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| {
                ApiError::Unauthorized("missing or malformed Authorization header".to_owned())
            })?;

        let claims = keys
            .decode_token(token)
            .map_err(|_| ApiError::Unauthorized("invalid or expired token".to_owned()))?;

        Ok(AuthClaims(claims))
    }
}
