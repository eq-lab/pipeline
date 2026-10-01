// spec: docs/product-specs/api-authorization-email.md#email-delivery, docs/product-specs/kyb-lp-verification.md#review-notifications

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RejectedDocument<'a> {
    pub filename: &'a str,
    pub reason: Option<&'a str>,
}

fn stated(text: Option<&str>) -> Option<&str> {
    text.map(str::trim).filter(|t| !t.is_empty())
}

pub fn render_kyb_passed_email(to: &str, legal_name: &str, reason: Option<&str>) -> OutboundEmail {
    let mut paragraphs = vec![format!(
        "The KYB review for {legal_name} is complete and the entity has been approved."
    )];
    if let Some(reason) = stated(reason) {
        paragraphs.push(reason.to_owned());
    }
    paragraphs.push("Nothing further is needed from you.".to_owned());

    OutboundEmail {
        to: to.to_owned(),
        subject: "Your Pipeline KYB review is complete".to_owned(),
        body: paragraphs.join("\n\n"),
    }
}

pub fn render_kyb_changes_requested_email(
    to: &str,
    legal_name: &str,
    reason: Option<&str>,
    rejected: &[RejectedDocument<'_>],
) -> OutboundEmail {
    let reason = stated(reason);
    let subject = "Your Pipeline KYB submission needs changes".to_owned();
    let opening = format!("The KYB review for {legal_name} was returned for correction.");

    if reason.is_none() && rejected.is_empty() {
        return OutboundEmail {
            to: to.to_owned(),
            subject,
            body: format!(
                "{opening} Sign in to review your submission and send it back for review."
            ),
        };
    }

    let mut paragraphs = vec![opening];
    if let Some(reason) = reason {
        paragraphs.push(reason.to_owned());
    }
    if rejected.is_empty() {
        paragraphs
            .push("Sign in to review your submission and send it back for review.".to_owned());
    } else {
        paragraphs.push("These documents need to be replaced:".to_owned());
        paragraphs.push(
            rejected
                .iter()
                .map(|doc| {
                    let reason = stated(doc.reason).unwrap_or("no reason was recorded");
                    format!("- {} — {}", doc.filename, reason)
                })
                .collect::<Vec<_>>()
                .join("\n"),
        );
        paragraphs.push(
            "Delete each of them, upload a corrected file, and submit for review again.".to_owned(),
        );
    }

    OutboundEmail {
        to: to.to_owned(),
        subject,
        body: paragraphs.join("\n\n"),
    }
}

pub fn render_kyb_failed_email(to: &str, legal_name: &str, reason: Option<&str>) -> OutboundEmail {
    let mut paragraphs = vec![format!(
        "The KYB review for {legal_name} is complete and the entity was not approved."
    )];
    if let Some(reason) = stated(reason) {
        paragraphs.push(reason.to_owned());
    }
    paragraphs.push(
        "This decision is final. If you believe it is a mistake, reply to this message \
         or contact Pipeline."
            .to_owned(),
    );

    OutboundEmail {
        to: to.to_owned(),
        subject: "Your Pipeline KYB application was not approved".to_owned(),
        body: paragraphs.join("\n\n"),
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
