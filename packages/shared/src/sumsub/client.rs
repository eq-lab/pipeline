use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

use super::config::SumsubSettings;
use super::models::{
    AccessTokenRequest, AccessTokenResponse, ApplicantIdentifiers, CreateApplicantRequest,
    CreateApplicantResponse, GetApplicantResponse,
};

type HmacSha256 = Hmac<Sha256>;

pub struct SumsubClient {
    http: reqwest::Client,
    settings: SumsubSettings,
}

impl SumsubClient {
    pub fn new(settings: SumsubSettings) -> Self {
        Self {
            http: reqwest::Client::new(),
            settings,
        }
    }

    pub async fn create_applicant(&self, wallet_address: &str) -> Result<CreateApplicantResponse> {
        let url = format!(
            "{}/resources/applicants?levelName={}",
            self.settings.base_url, self.settings.verification_level
        );
        let body = CreateApplicantRequest {
            external_user_id: wallet_address.to_owned(),
        };
        let body_json = serde_json::to_string(&body)?;

        let response = self
            .signed_request(reqwest::Method::POST, &url, Some(&body_json))
            .await?
            .header("Content-Type", "application/json")
            .body(body_json)
            .send()
            .await
            .context("Sumsub create_applicant request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Sumsub create_applicant returned {status}: {text}");
        }

        response
            .json::<CreateApplicantResponse>()
            .await
            .context("Failed to parse create_applicant response")
    }

    pub async fn get_applicant_by_external_id(
        &self,
        wallet_address: &str,
    ) -> Result<GetApplicantResponse> {
        let url = format!(
            "{}/resources/applicants/-;externalUserId={}/one",
            self.settings.base_url, wallet_address
        );

        let response = self
            .signed_request(reqwest::Method::GET, &url, None)
            .await?
            .send()
            .await
            .context("Sumsub get_applicant request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Sumsub get_applicant returned {status}: {text}");
        }

        response
            .json::<GetApplicantResponse>()
            .await
            .context("Failed to parse get_applicant response")
    }

    pub async fn generate_access_token(&self, wallet_address: &str) -> Result<AccessTokenResponse> {
        let url = format!("{}/resources/accessTokens/sdk", self.settings.base_url);
        let body = AccessTokenRequest {
            applicant_identifiers: ApplicantIdentifiers {
                external_user_id: wallet_address.to_owned(),
            },
            user_id: wallet_address.to_owned(),
            level_name: self.settings.verification_level.clone(),
            ttl_in_secs: self.settings.token_ttl_secs,
        };
        let body_json = serde_json::to_string(&body)?;

        let response = self
            .signed_request(reqwest::Method::POST, &url, Some(&body_json))
            .await?
            .header("Content-Type", "application/json")
            .body(body_json)
            .send()
            .await
            .context("Sumsub generate_access_token request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Sumsub generate_access_token returned {status}: {text}");
        }

        response
            .json::<AccessTokenResponse>()
            .await
            .context("Failed to parse access_token response")
    }

    async fn signed_request(
        &self,
        method: reqwest::Method,
        url: &str,
        body: Option<&str>,
    ) -> Result<reqwest::RequestBuilder> {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock error")?
            .as_secs();

        let parsed_url = reqwest::Url::parse(url).context("invalid URL")?;
        let path = format!(
            "{}{}",
            parsed_url.path(),
            parsed_url
                .query()
                .map(|q| format!("?{q}"))
                .unwrap_or_default()
        );

        let data = format!("{}{}{}{}", ts, method.as_str(), path, body.unwrap_or(""));

        let mut mac = HmacSha256::new_from_slice(self.settings.secret_key.as_bytes())
            .context("invalid HMAC key")?;
        mac.update(data.as_bytes());
        let signature = hex::encode(mac.finalize().into_bytes());

        Ok(self
            .http
            .request(method, url)
            .header("X-App-Token", &self.settings.app_token)
            .header("X-App-Access-Ts", ts.to_string())
            .header("X-App-Access-Sig", signature))
    }
}
