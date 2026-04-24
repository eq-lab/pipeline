use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[repr(i16)]
pub enum KycStatus {
    Red = 1,
    Green = 2,
    Yellow = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[repr(i16)]
pub enum KycReviewStatus {
    Pending = 1,
    Completed = 2,
    Init = 3,
    OnHold = 4,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateApplicantRequest {
    pub external_user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateApplicantResponse {
    pub id: String,
    pub created_at: Option<String>,
    pub client_id: Option<String>,
    pub external_user_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessTokenRequest {
    pub applicant_identifiers: ApplicantIdentifiers,
    pub user_id: String,
    pub level_name: String,
    pub ttl_in_secs: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicantIdentifiers {
    pub external_user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessTokenResponse {
    pub token: Option<String>,
    pub user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetApplicantResponse {
    pub id: String,
    pub info: Option<ApplicantInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicantInfo {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookPayload {
    pub applicant_id: String,
    pub inspection_id: Option<String>,
    pub applicant_type: Option<String>,
    pub correlation_id: Option<String>,
    pub level_name: Option<String>,
    pub external_user_id: Option<String>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub sandbox_mode: Option<bool>,
    pub review_status: Option<String>,
    pub review_result: Option<ReviewResult>,
    pub created_at_ms: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewResult {
    pub review_answer: Option<String>,
    pub moderation_comment: Option<String>,
    pub client_comment: Option<String>,
    pub reject_labels: Option<Vec<String>>,
    pub review_reject_type: Option<String>,
}

impl WebhookPayload {
    pub fn parsed_review_status(&self) -> Option<KycReviewStatus> {
        self.review_status.as_deref().map(|s| match s {
            "pending" => KycReviewStatus::Pending,
            "completed" => KycReviewStatus::Completed,
            "init" => KycReviewStatus::Init,
            "onHold" => KycReviewStatus::OnHold,
            _ => KycReviewStatus::Pending,
        })
    }

    pub fn parsed_kyc_status(&self) -> Option<KycStatus> {
        self.review_result
            .as_ref()?
            .review_answer
            .as_deref()
            .map(|s| match s {
                "GREEN" => KycStatus::Green,
                "RED" => KycStatus::Red,
                _ => KycStatus::Yellow,
            })
    }
}
