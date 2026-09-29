// spec: docs/product-specs/api-authorization-email.md#email-delivery, Issue #1368

use std::sync::Arc;

use anyhow::{Context, Result};

use super::sendgrid::SendGridEmailSender;
use super::{EmailSender, LoggingEmailSender};

const DEFAULT_SENDGRID_BASE_URL: &str = "https://api.sendgrid.com";

pub enum EmailConfig {
    DevLog,
    SendGrid {
        api_key: String,
        from: String,
        base_url: String,
    },
}

impl std::fmt::Debug for EmailConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DevLog => f.write_str("EmailConfig::DevLog"),
            Self::SendGrid { from, base_url, .. } => f
                .debug_struct("EmailConfig::SendGrid")
                .field("api_key", &"<redacted>")
                .field("from", from)
                .field("base_url", base_url)
                .finish(),
        }
    }
}

impl EmailConfig {
    pub fn from_env() -> Result<Self> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self> {
        if get("EMAIL_DEV_LOG")
            .is_some_and(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
        {
            return Ok(Self::DevLog);
        }

        let required = |key: &str| -> Result<String> {
            let value = get(key).with_context(|| {
                format!("{key} is required (or set EMAIL_DEV_LOG=true for local development)")
            })?;
            if value.trim().is_empty() {
                anyhow::bail!(
                    "{key} is required (or set EMAIL_DEV_LOG=true for local development) but is empty"
                );
            }
            Ok(value.trim().to_owned())
        };

        let api_key = required("SENDGRID_API_KEY")?;
        let from = required("SENDGRID_FROM")?;
        let base_url = get("SENDGRID_BASE_URL")
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_SENDGRID_BASE_URL.to_owned())
            .trim()
            .trim_end_matches('/')
            .to_owned();

        Ok(Self::SendGrid {
            api_key,
            from,
            base_url,
        })
    }

    pub fn sender(self) -> Arc<dyn EmailSender> {
        match self {
            Self::DevLog => {
                tracing::info!(mode = "dev-log", "email delivery configured");
                Arc::new(LoggingEmailSender)
            }
            Self::SendGrid {
                api_key,
                from,
                base_url,
            } => {
                tracing::info!(mode = "sendgrid", base_url = %base_url, "email delivery configured");
                Arc::new(SendGridEmailSender::new(&base_url, api_key, from))
            }
        }
    }
}
