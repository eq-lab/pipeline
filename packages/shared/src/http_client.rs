// spec: docs/references/backend.md#http-client-timeouts
use std::time::Duration;

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

pub fn http_client() -> reqwest::Client {
    http_client_with(REQUEST_TIMEOUT)
}

pub fn http_client_with(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(CONNECT_TIMEOUT.min(timeout))
        .build()
        .expect("reqwest client builds with fixed timeouts and no other config")
}
