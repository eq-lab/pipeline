// spec: docs/product-specs/api-authorization-email.md#email-delivery, Issue #1368

use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use reqwest::Client;
use serde_json::{json, Value};

use super::{EmailSender, OutboundEmail};

pub struct SendGridEmailSender {
    http: Client,
    base_url: String,
    api_key: String,
    from: String,
}

impl SendGridEmailSender {
    pub fn new(base_url: &str, api_key: String, from: String) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client builds with a fixed timeout and no other config");
        Self {
            http,
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key,
            from,
        }
    }

    pub fn payload(&self, email: &OutboundEmail) -> Value {
        json!({
            "personalizations": [{ "to": [{ "email": email.to }] }],
            "from": { "email": self.from },
            "subject": email.subject,
            "content": [{ "type": "text/plain", "value": email.body }],
        })
    }
}

#[async_trait]
impl EmailSender for SendGridEmailSender {
    async fn send(&self, email: &OutboundEmail) -> anyhow::Result<()> {
        let url = format!("{}/v3/mail/send", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&self.payload(email))
            .send()
            .await
            .context("sendgrid /v3/mail/send request failed")?;

        let status = resp.status();
        if status.is_success() {
            return Ok(());
        }
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("sendgrid /v3/mail/send failed with status {status}: {text}");
    }
}
