// spec: docs/product-specs/api-authorization-email.md#email-delivery, Issue #1368

mod config;
mod sendgrid;

pub use config::EmailConfig;
pub use sendgrid::SendGridEmailSender;

use async_trait::async_trait;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundEmail {
    pub to: String,
    pub subject: String,
    pub body: String,
}

#[async_trait]
pub trait EmailSender: Send + Sync {
    async fn send(&self, email: &OutboundEmail) -> anyhow::Result<()>;
}

pub fn render_verification_email(to: &str, code: &str) -> OutboundEmail {
    OutboundEmail {
        to: to.to_owned(),
        subject: "Your Pipeline verification code".to_owned(),
        body: format!(
            "Your Pipeline verification code is {code}.\n\n\
             It expires in 1 minute. If you did not request it, ignore this email."
        ),
    }
}

pub fn render_duplicate_signup_email(to: &str) -> OutboundEmail {
    OutboundEmail {
        to: to.to_owned(),
        subject: "Someone tried to create a Pipeline account with your email".to_owned(),
        body: "An account already exists for this address, so no new account was created \
               and nothing has changed.\n\n\
               If this was you, sign in instead. If it was not, you can ignore this email."
            .to_owned(),
    }
}

pub struct LoggingEmailSender;

#[async_trait]
impl EmailSender for LoggingEmailSender {
    async fn send(&self, email: &OutboundEmail) -> anyhow::Result<()> {
        tracing::info!(
            to = %email.to,
            subject = %email.subject,
            body = %email.body,
            "email delivery is not configured — message logged, not sent"
        );
        Ok(())
    }
}
