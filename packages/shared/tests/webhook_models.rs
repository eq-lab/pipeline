use shared::sumsub::models::{KycReviewStatus, KycStatus, WebhookPayload};

#[test]
fn parse_green_completed_webhook() {
    let json = r#"{
        "applicantId": "abc123",
        "inspectionId": "insp456",
        "applicantType": "individual",
        "correlationId": "corr789",
        "levelName": "id-and-liveness",
        "externalUserId": "0x1234567890abcdef1234567890abcdef12345678",
        "type": "applicantReviewed",
        "sandboxMode": true,
        "reviewStatus": "completed",
        "reviewResult": {
            "reviewAnswer": "GREEN"
        },
        "createdAtMs": "1714000000000"
    }"#;

    let payload: WebhookPayload = serde_json::from_str(json).unwrap();
    assert_eq!(payload.applicant_id, "abc123");
    assert_eq!(
        payload.external_user_id.as_deref(),
        Some("0x1234567890abcdef1234567890abcdef12345678")
    );
    assert_eq!(
        payload.parsed_review_status(),
        Some(KycReviewStatus::Completed)
    );
    assert_eq!(payload.parsed_kyc_status(), Some(KycStatus::Green));
}

#[test]
fn parse_red_rejected_webhook() {
    let json = r#"{
        "applicantId": "abc123",
        "type": "applicantReviewed",
        "reviewStatus": "completed",
        "reviewResult": {
            "reviewAnswer": "RED",
            "rejectLabels": ["FORGERY"],
            "reviewRejectType": "FINAL"
        }
    }"#;

    let payload: WebhookPayload = serde_json::from_str(json).unwrap();
    assert_eq!(payload.parsed_kyc_status(), Some(KycStatus::Red));
    assert_eq!(
        payload.parsed_review_status(),
        Some(KycReviewStatus::Completed)
    );
    assert_eq!(
        payload.review_result.as_ref().unwrap().reject_labels,
        Some(vec!["FORGERY".to_owned()])
    );
}

#[test]
fn parse_pending_webhook_no_review_result() {
    let json = r#"{
        "applicantId": "abc123",
        "type": "applicantPending",
        "reviewStatus": "pending"
    }"#;

    let payload: WebhookPayload = serde_json::from_str(json).unwrap();
    assert_eq!(
        payload.parsed_review_status(),
        Some(KycReviewStatus::Pending)
    );
    assert_eq!(payload.parsed_kyc_status(), None);
}

#[test]
fn parse_unknown_review_status_defaults_to_pending() {
    let json = r#"{
        "applicantId": "abc123",
        "type": "applicantReviewed",
        "reviewStatus": "unknownValue"
    }"#;

    let payload: WebhookPayload = serde_json::from_str(json).unwrap();
    assert_eq!(
        payload.parsed_review_status(),
        Some(KycReviewStatus::Pending)
    );
}
