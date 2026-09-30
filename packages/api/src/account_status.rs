// spec: docs/product-specs/api-authorization.md#security

use shared::account_repo::{is_active_status, Account};

use crate::error::ApiError;

pub const ACCOUNT_SUSPENDED: &str = "account_suspended";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenRefusal {
    Suspended,
    EmailNotVerified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestRefusal {
    Suspended,
    UnknownAccount,
}

pub fn gate_token_issue(account: &Account, require_verified_email: bool) -> Option<TokenRefusal> {
    if !account.is_active() {
        return Some(TokenRefusal::Suspended);
    }
    if require_verified_email && !account.is_email_verified() {
        return Some(TokenRefusal::EmailNotVerified);
    }
    None
}

pub fn gate_request(status: Option<&str>) -> Option<RequestRefusal> {
    match status {
        Some(s) if is_active_status(s) => None,
        Some(_) => Some(RequestRefusal::Suspended),
        None => Some(RequestRefusal::UnknownAccount),
    }
}

impl From<TokenRefusal> for ApiError {
    fn from(refusal: TokenRefusal) -> Self {
        match refusal {
            TokenRefusal::Suspended => ApiError::Forbidden(ACCOUNT_SUSPENDED.to_owned()),
            TokenRefusal::EmailNotVerified => ApiError::Forbidden("email_not_verified".to_owned()),
        }
    }
}

impl From<RequestRefusal> for ApiError {
    fn from(refusal: RequestRefusal) -> Self {
        match refusal {
            RequestRefusal::Suspended => ApiError::Forbidden(ACCOUNT_SUSPENDED.to_owned()),
            RequestRefusal::UnknownAccount => {
                ApiError::Unauthorized("invalid or expired token".to_owned())
            }
        }
    }
}
