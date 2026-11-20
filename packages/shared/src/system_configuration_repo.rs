// spec: docs/product-specs/deposits.md#lp-funding-details

use anyhow::Context;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemConfigurationType {
    SystemBankDetails,
}

impl SystemConfigurationType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SystemBankDetails => "system_bank_details",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemBankDetails {
    pub company_name: String,
    pub bank_name: String,
    pub bank_address: String,
    pub account_number: String,
    pub iban: String,
    pub swift_bic_code: String,
}

impl SystemBankDetails {
    pub fn missing_required_fields(&self) -> Vec<&'static str> {
        let mut missing: Vec<&'static str> = [
            ("company_name", &self.company_name),
            ("bank_name", &self.bank_name),
            ("swift_bic_code", &self.swift_bic_code),
        ]
        .into_iter()
        .filter(|(_, v)| v.trim().is_empty())
        .map(|(name, _)| name)
        .collect();
        if self.account_number.trim().is_empty() && self.iban.trim().is_empty() {
            missing.push("account_number or iban");
        }
        missing
    }

    pub fn is_configured(&self) -> bool {
        self.missing_required_fields().is_empty()
    }
}

#[async_trait]
pub trait BankDetailsSource: Send + Sync {
    async fn bank_details(&self) -> anyhow::Result<Option<SystemBankDetails>>;
}

pub struct SystemConfigurationRepo {
    pool: PgPool,
}

impl SystemConfigurationRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn value(
        &self,
        ty: SystemConfigurationType,
    ) -> Result<Option<serde_json::Value>, sqlx::Error> {
        sqlx::query_scalar::<_, serde_json::Value>(
            "SELECT value FROM system_configuration WHERE type = $1",
        )
        .bind(ty.as_str())
        .fetch_optional(&self.pool)
        .await
    }
}

#[async_trait]
impl BankDetailsSource for SystemConfigurationRepo {
    async fn bank_details(&self) -> anyhow::Result<Option<SystemBankDetails>> {
        let ty = SystemConfigurationType::SystemBankDetails;
        match self.value(ty).await? {
            None => Ok(None),
            Some(value) => serde_json::from_value(value).map(Some).with_context(|| {
                format!("system_configuration row `{}` is malformed", ty.as_str())
            }),
        }
    }
}
