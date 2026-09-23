//! Transactional email seam.
//!
//! No delivery provider is wired up yet — that is tracked as its own blocking
//! issue. Everything downstream of this trait (signup, resend, the OTP lifecycle)
//! is complete and tested against the seam; swapping [`LoggingEmailSender`] for a
//! real provider is a one-impl change with no caller edits.
//!
//! Until then `POST /v1/auth/signup` writes the passcode to the log at INFO.
//! That is a development affordance and a production data leak — the provider
//! must land before this reaches real users.

use async_trait::async_trait;

/// A rendered message ready for delivery.
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

/// Render the signup passcode message. Pure, so the copy is unit-testable.
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

/// Render the notice sent when somebody attempts to sign up with an address that
/// already has a verified account. The signup response is identical either way,
/// so this message is what distinguishes the two cases — for the address owner
/// only, never for the caller.
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

/// Development sender: logs instead of delivering.
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
