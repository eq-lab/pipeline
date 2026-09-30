// spec: docs/product-specs/api-authorization.md#security

use chrono::{TimeZone, Utc};
use uuid::Uuid;

use shared::account_repo::{is_active_status, Account};

#[test]
fn only_active_may_act() {
    assert!(is_active_status("Active"));
    for status in ["Suspended", "active", "ACTIVE", "", "Deleted"] {
        assert!(
            !is_active_status(status),
            "status {status:?} must not be active"
        );
    }
}

#[test]
fn the_account_helper_agrees_with_the_free_function() {
    let now = Utc.with_ymd_and_hms(2026, 9, 22, 12, 0, 0).unwrap();
    for status in ["Active", "Suspended", "active", ""] {
        let account = Account {
            id: Uuid::parse_str("11111111-2222-3333-4444-555555555555").unwrap(),
            email: None,
            password_hash: None,
            email_verified_at: None,
            last_duplicate_notice_at: None,
            status: status.to_owned(),
            created_at: now,
            updated_at: now,
        };
        assert_eq!(account.is_active(), is_active_status(status));
    }
}
