use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use reqwest::{Client, Url};
use serde::de::DeserializeOwned;

/// Reusable HTTP JSON fetcher with `ipfs://` resolution and bounded retry/backoff.
///
/// Convention: `attempts = retry_backoffs.len() + 1` — every entry in `retry_backoffs`
/// is the wait time **between** attempts, so all entries are used as actual sleeps.
/// Default `[1s, 5s, 30s]` therefore yields 4 attempts with ~36s of worst-case sleep.
///
/// Retries (with backoff) fire on transport errors (both during `send` and during the
/// response-body read) and on HTTP 5xx. Terminal (no retry) on HTTP 4xx, unknown URI
/// scheme, and JSON parse errors.
pub struct MetadataFetcher {
    http: Client,
    ipfs_gateway_url: String,
    retry_backoffs: Vec<Duration>,
}

impl MetadataFetcher {
    pub fn new(http: Client, ipfs_gateway_url: String) -> Self {
        Self {
            http,
            ipfs_gateway_url,
            retry_backoffs: vec![
                Duration::from_secs(1),
                Duration::from_secs(5),
                Duration::from_secs(30),
            ],
        }
    }

    /// Replace the default 3 backoffs (= 4 attempts). Tests use this to shorten waits.
    pub fn with_backoffs(mut self, backoffs: Vec<Duration>) -> Self {
        self.retry_backoffs = backoffs;
        self
    }

    /// GET the URI (resolving `ipfs://` to the configured gateway) and deserialise as `T`.
    pub async fn fetch_json<T: DeserializeOwned>(&self, uri: &str) -> Result<T> {
        let url = Self::resolve(uri, &self.ipfs_gateway_url)?;
        let max_attempts = self.retry_backoffs.len() + 1;
        let mut last_err: Option<anyhow::Error> = None;

        for attempt in 0..max_attempts {
            let is_last = attempt + 1 == max_attempts;

            // Compute a retriable error or return early. A successful 200 + parse returns
            // directly. A 4xx, parse failure, or other terminal error returns Err directly.
            // Transport errors (`send` or body-read) and 5xx fall through as retriable.
            let retriable_err: anyhow::Error = match self.http.get(url.clone()).send().await {
                Err(e) => anyhow::Error::new(e).context("transport error (send)"),
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        match resp.bytes().await {
                            Ok(bytes) => {
                                return serde_json::from_slice::<T>(&bytes).with_context(|| {
                                    format!("parse JSON from {url} (terminal — no retry)")
                                });
                            }
                            Err(e) => anyhow::Error::new(e).context("transport error (body)"),
                        }
                    } else if status.is_server_error() {
                        anyhow!("HTTP {status} from {url} (retriable)")
                    } else {
                        return Err(anyhow!("HTTP {status} from {url}"));
                    }
                }
            };

            if is_last {
                return Err(retriable_err);
            }
            last_err = Some(retriable_err);

            // Safe: attempt < max_attempts - 1 here, and backoffs has max_attempts - 1
            // entries, so this index is in range.
            tokio::time::sleep(self.retry_backoffs[attempt]).await;
        }

        Err(last_err.unwrap_or_else(|| anyhow!("all retries exhausted for {url}")))
    }

    /// Resolve a metadata URI to an HTTP(S) URL. Errors on unknown schemes.
    pub fn resolve(uri: &str, gateway: &str) -> Result<Url> {
        if let Some(rest) = uri.strip_prefix("ipfs://") {
            let joined = format!("{}{}", ensure_trailing_slash(gateway), rest);
            return Url::parse(&joined)
                .with_context(|| format!("invalid IPFS gateway URL {joined}"));
        }
        if uri.starts_with("http://") || uri.starts_with("https://") {
            return Url::parse(uri).with_context(|| format!("invalid URL {uri}"));
        }
        Err(anyhow!("unsupported URI scheme: {uri}"))
    }
}

fn ensure_trailing_slash(gateway: &str) -> String {
    if gateway.ends_with('/') {
        gateway.to_owned()
    } else {
        format!("{gateway}/")
    }
}
