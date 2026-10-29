// spec: docs/design-docs/multi-chain-kyc-sharding.md#kyt-no-downgrade-rule
use shared::kyc_repo::{next_kyt_status, KYT_CLEAR, KYT_FAILED, PROFILE_KYT_CLEAR_SQL};

#[test]
fn failed_profile_is_never_downgraded() {
    assert_eq!(next_kyt_status(Some(KYT_FAILED), KYT_CLEAR), KYT_FAILED);
    assert_eq!(next_kyt_status(Some(KYT_FAILED), KYT_FAILED), KYT_FAILED);
}

#[test]
fn unscreened_or_clear_profile_takes_the_verdict() {
    for current in [None, Some(KYT_CLEAR)] {
        assert_eq!(next_kyt_status(current, KYT_CLEAR), KYT_CLEAR);
        assert_eq!(next_kyt_status(current, KYT_FAILED), KYT_FAILED);
    }
}

#[test]
fn clear_sql_guards_failed_rows() {
    assert!(PROFILE_KYT_CLEAR_SQL.contains("SET kyt_status = 1"));
    assert!(PROFILE_KYT_CLEAR_SQL.contains("AND kyt_status IS DISTINCT FROM 2"));
}
