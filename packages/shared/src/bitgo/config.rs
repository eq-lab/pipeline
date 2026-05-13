use anyhow::{Context, Result};
use std::env;

#[derive(Clone)]
pub struct BitgoSettings {
    pub base_url: String,
    pub access_token: String,
    pub wallet_id: String,
}

impl BitgoSettings {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            base_url: env_require("BITGO_BASE_URL")?,
            access_token: env_require("BITGO_ACCESS_TOKEN")?,
            wallet_id: env_require("BITGO_WALLET_ID")?,
        })
    }
}

fn env_require(key: &str) -> Result<String> {
    env::var(key).with_context(|| format!("required env var {key} is not set"))
}
