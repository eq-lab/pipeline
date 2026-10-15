// spec: docs/product-specs/api-authorization-password-reset.md

use anyhow::{bail, Context, Result};
use argon2::password_hash::rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};

use shared::account_repo::Account;

pub const RESET_TOKEN_BYTES: usize = 32;

pub const PASSWORD_RESET_COOLDOWN_SECS: i32 = 60;

pub const MAX_RESET_REQUESTS_PER_IP: i32 = 10;

pub const RESET_REQUEST_WINDOW_SECS: i32 = 60 * 60;

pub const DEFAULT_PASSWORD_RESET_TTL_MINUTES: u32 = 30;

pub const MIN_PASSWORD_RESET_TTL_MINUTES: u32 = 1;

pub const MAX_PASSWORD_RESET_TTL_MINUTES: u32 = 24 * 60;

pub const DEV_APP_BASE_URL: &str = "http://localhost:5173";

pub const RESET_PATH: &str = "/reset-password";

const _: () = assert!(MIN_PASSWORD_RESET_TTL_MINUTES as i32 * 60 >= PASSWORD_RESET_COOLDOWN_SECS);

pub fn generate_reset_token() -> String {
    let mut bytes = [0u8; RESET_TOKEN_BYTES];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn hash_reset_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

pub fn within_reset_request_limit(requests_including_this: i32) -> bool {
    requests_including_this <= MAX_RESET_REQUESTS_PER_IP
}

pub fn may_reset_password(account: &Account) -> bool {
    account.email.is_some() && account.is_email_verified() && account.is_active()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasswordResetConfig {
    pub app_base_url: String,
    pub ttl_minutes: u32,
}

impl PasswordResetConfig {
    pub fn from_env(email_dev_log: bool) -> Result<Self> {
        Self::from_lookup(|key| std::env::var(key).ok(), email_dev_log)
    }

    pub fn from_lookup(get: impl Fn(&str) -> Option<String>, email_dev_log: bool) -> Result<Self> {
        let app_base_url = match get("APP_BASE_URL").filter(|v| !v.trim().is_empty()) {
            Some(raw) => parse_base_url(&raw)?,
            None if email_dev_log => DEV_APP_BASE_URL.to_owned(),
            None => bail!(
                "APP_BASE_URL is required for password-reset links \
                 (or set EMAIL_DEV_LOG=true for local development)"
            ),
        };

        let ttl_minutes = match get("PASSWORD_RESET_TTL_MINUTES").filter(|v| !v.trim().is_empty()) {
            None => DEFAULT_PASSWORD_RESET_TTL_MINUTES,
            Some(raw) => raw.trim().parse::<u32>().with_context(|| {
                format!("PASSWORD_RESET_TTL_MINUTES is not a whole number: {raw}")
            })?,
        };
        if !(MIN_PASSWORD_RESET_TTL_MINUTES..=MAX_PASSWORD_RESET_TTL_MINUTES).contains(&ttl_minutes)
        {
            bail!(
                "PASSWORD_RESET_TTL_MINUTES must be between {MIN_PASSWORD_RESET_TTL_MINUTES} \
                 and {MAX_PASSWORD_RESET_TTL_MINUTES}, got {ttl_minutes}"
            );
        }

        Ok(Self {
            app_base_url,
            ttl_minutes,
        })
    }

    pub fn ttl_secs(&self) -> i32 {
        self.ttl_minutes as i32 * 60
    }

    pub fn link(&self, token: &str) -> String {
        format!("{}{RESET_PATH}#token={token}", self.app_base_url)
    }
}

fn parse_base_url(raw: &str) -> Result<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(trimmed)
        .with_context(|| format!("APP_BASE_URL is not a valid URL: {raw}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!("APP_BASE_URL must be an http(s) URL with a host, got {raw}");
    }
    if url.query().is_some() || url.fragment().is_some() {
        bail!("APP_BASE_URL must not carry a query or fragment, got {raw}");
    }
    Ok(trimmed.to_owned())
}

pub fn is_well_formed_reset_token(token: &str) -> bool {
    token.len() == RESET_TOKEN_BYTES * 2 && token.bytes().all(|b| b.is_ascii_hexdigit())
}
