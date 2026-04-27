use anyhow::{Context, Result};
use std::env;

#[derive(Clone)]
pub struct SumsubSettings {
    pub app_token: String,
    pub secret_key: String,
    pub base_url: String,
    pub verification_level: String,
    pub webhook_secret_key: String,
    pub sandbox: bool,
    pub token_ttl_secs: i32,
}

impl SumsubSettings {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            app_token: env_require("SUMSUB_APP_TOKEN")?,
            secret_key: env_require("SUMSUB_SECRET_KEY")?,
            base_url: env_require("SUMSUB_BASE_URL")?,
            verification_level: env_require("SUMSUB_VERIFICATION_LEVEL")?,
            webhook_secret_key: env_require("SUMSUB_WEBHOOK_SECRET_KEY")?,
            sandbox: env::var("SUMSUB_SANDBOX")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
                .unwrap_or(false),
            token_ttl_secs: env::var("SUMSUB_TOKEN_TTL_SECS")
                .unwrap_or_else(|_| "600".to_owned())
                .parse()
                .context("SUMSUB_TOKEN_TTL_SECS must be an integer")?,
        })
    }
}

fn env_require(key: &str) -> Result<String> {
    env::var(key).with_context(|| format!("required env var {key} is not set"))
}
