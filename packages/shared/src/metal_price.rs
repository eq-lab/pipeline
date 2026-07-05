//! Live USD price provider backed by [MetalpriceAPI](https://metalpriceapi.com/documentation).
//!
//! Implements the [`PriceProvider`](crate::price_provider::PriceProvider) trait for
//! precious-metal collateral (gold `XAU`, silver `XAG`, …) sourced from real market
//! rates. Registered under [`METALPRICE_PROVIDER_KEY`](crate::price_provider::METALPRICE_PROVIDER_KEY)
//! and resolved by `price_provider_for`.
//!
//! - `current_price` → `GET /latest?base=USD&currencies=<asset>`.
//! - `historical_price` → `GET /{YYYY-MM-DD}?base=USD&currencies=<asset>` — the endpoint is
//!   date-level (daily close), so the price is stable per `(asset, date)` and backfill stays
//!   idempotent as the trait requires. On an hourly collector grid every hour of a day resolves
//!   to the same daily value.
//!
//! Metals are quoted per troy ounce. The API returns `rates.<SYMBOL>` (metal per 1 USD) and its
//! reciprocal `rates.USD<SYMBOL>` (USD per unit). We return **USD-per-unit**: prefer the
//! `USD<SYMBOL>` field, falling back to `1 / rates.<SYMBOL>`.
//!
//! The URL builders and response parser are pure functions so they are unit-testable without
//! network or environment access (see `packages/shared/tests/metal_price_provider.rs`); the async
//! trait methods are thin HTTP wrappers around them, mirroring the client style in
//! [`crate::crystal`].

use std::str::FromStr;

use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use bigdecimal::{BigDecimal, Zero};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;

use crate::price_provider::PriceProvider;

/// Default MetalpriceAPI base URL (US endpoint). The EU mirror is
/// `https://api-eu.metalpriceapi.com/v1`; override via `METALPRICE_BASE_URL`.
const DEFAULT_BASE_URL: &str = "https://api.metalpriceapi.com/v1";

/// Configuration for [`MetalPricePriceProvider`], read from the environment.
///
/// Mirrors the `from_env` style of the other external integrations (e.g.
/// [`crate::crystal`]).
#[derive(Clone)]
pub struct MetalPriceSettings {
    /// MetalpriceAPI API key, sent as the `api_key` query parameter.
    pub api_key: String,
    /// API base URL (no trailing slash). Defaults to [`DEFAULT_BASE_URL`].
    pub base_url: String,
}

impl MetalPriceSettings {
    /// Read settings from `METALPRICE_API_KEY` (required) and `METALPRICE_BASE_URL`
    /// (optional, defaults to [`DEFAULT_BASE_URL`]).
    pub fn from_env() -> Result<Self> {
        let api_key = std::env::var("METALPRICE_API_KEY")
            .context("required env var METALPRICE_API_KEY is not set")?;
        let base_url =
            std::env::var("METALPRICE_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_owned());
        Ok(Self { api_key, base_url })
    }
}

/// Loosely-typed MetalpriceAPI response, covering both the success and error shapes.
///
/// Success: `{ "success": true, "base": "USD", "rates": { "XAU": .., "USDXAU": .. } }`.
/// Error:   `{ "success": false, "error": { "code": .., "info": ".." } }`.
#[derive(Debug, Deserialize)]
struct MetalPriceResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    rates: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default)]
    error: Option<serde_json::Value>,
}

/// Build the `/latest` (current price) request URL.
pub fn latest_url(base_url: &str, api_key: &str, asset: &str) -> String {
    format!("{base_url}/latest?api_key={api_key}&base=USD&currencies={asset}")
}

/// Build the dated historical (`/{YYYY-MM-DD}`) request URL.
pub fn historical_url(base_url: &str, api_key: &str, asset: &str, date: NaiveDate) -> String {
    // `NaiveDate`'s `Display` is ISO-8601 `YYYY-MM-DD`, exactly the path segment the API expects.
    format!("{base_url}/{date}?api_key={api_key}&base=USD&currencies={asset}")
}

/// Parse a MetalpriceAPI response body into the USD price per unit of `asset`.
///
/// Prefers the reciprocal `USD<asset>` field (USD per unit); falls back to inverting
/// `<asset>` (units per USD). Surfaces `success: false`, a missing `rates` object, and a
/// missing/zero symbol as errors.
pub fn parse_usd_price(body: &str, asset: &str) -> Result<BigDecimal> {
    let resp: MetalPriceResponse =
        serde_json::from_str(body).context("metalpriceapi: failed to parse response body")?;

    if !resp.success {
        let detail = resp
            .error
            .map_or_else(|| "unknown error".to_owned(), |e| e.to_string());
        bail!("metalpriceapi: request unsuccessful: {detail}");
    }

    let rates = resp
        .rates
        .ok_or_else(|| anyhow!("metalpriceapi: response missing `rates`"))?;

    let usd_key = format!("USD{asset}");
    if let Some(v) = rates.get(&usd_key) {
        return json_number_to_bigdecimal(v, &usd_key);
    }

    if let Some(v) = rates.get(asset) {
        let rate = json_number_to_bigdecimal(v, asset)?;
        if rate.is_zero() {
            bail!("metalpriceapi: rate for {asset} is zero");
        }
        return Ok(BigDecimal::from(1) / rate);
    }

    bail!("metalpriceapi: no rate for `{asset}` in response")
}

/// Convert a JSON rate value to `BigDecimal` via its textual form, preserving the exact decimal
/// digits (never through `f64`, which would introduce binary-float precision loss).
fn json_number_to_bigdecimal(value: &serde_json::Value, field: &str) -> Result<BigDecimal> {
    match value {
        serde_json::Value::Number(n) => BigDecimal::from_str(&n.to_string())
            .with_context(|| format!("metalpriceapi: invalid number for `{field}`: {n}")),
        serde_json::Value::String(s) => BigDecimal::from_str(s)
            .with_context(|| format!("metalpriceapi: invalid number string for `{field}`: {s}")),
        other => bail!("metalpriceapi: unexpected type for `{field}`: {other}"),
    }
}

/// Live USD price provider over MetalpriceAPI.
pub struct MetalPricePriceProvider {
    http: reqwest::Client,
    settings: MetalPriceSettings,
}

impl MetalPricePriceProvider {
    /// Construct from environment (`METALPRICE_API_KEY`, optional `METALPRICE_BASE_URL`).
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            http: reqwest::Client::new(),
            settings: MetalPriceSettings::from_env()?,
        })
    }

    /// GET `url`, check the HTTP status, then parse the USD price for `asset`.
    async fn fetch_price(&self, url: &str, asset: &str) -> Result<BigDecimal> {
        let response = self
            .http
            .get(url)
            .send()
            .await
            .context("metalpriceapi request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            bail!("metalpriceapi returned {status}: {text}");
        }

        let text = response
            .text()
            .await
            .context("metalpriceapi: failed to read response body")?;
        parse_usd_price(&text, asset)
    }
}

#[async_trait]
impl PriceProvider for MetalPricePriceProvider {
    async fn current_price(&self, asset: &str) -> Result<BigDecimal> {
        let url = latest_url(&self.settings.base_url, &self.settings.api_key, asset);
        self.fetch_price(&url, asset).await
    }

    async fn historical_price(&self, asset: &str, at: DateTime<Utc>) -> Result<BigDecimal> {
        let url = historical_url(
            &self.settings.base_url,
            &self.settings.api_key,
            asset,
            at.date_naive(),
        );
        self.fetch_price(&url, asset).await
    }
}
