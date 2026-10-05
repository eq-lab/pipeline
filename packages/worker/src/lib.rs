// `#[async_trait]` expands each method to a `Pin<Box<dyn Future>>` that already
// carries `#[must_use]`, which clippy 1.99 reads as a doubled one — a warning
// about macro output we do not write. See TD-115.
#![allow(clippy::double_must_use)]

pub mod asset_price_collector;
pub mod indexer;
pub mod kyc;
pub mod price_poller;
pub mod relayer;
pub mod stellar;
