// spec: docs/superpowers/specs/2026-10-12-multi-chain-price-poller-design.md#structure
pub mod config;
pub mod evm;
pub mod stellar;

pub use config::{EvmPricePollerSettings, PricePollerSettings, StellarPricePollerSettings};
pub use evm::run_evm_price_poller_job;
pub use stellar::run_stellar_price_poller_job;

pub fn align_to_grid(block: u64, origin: u64, interval: u64) -> u64 {
    if block <= origin {
        return origin;
    }
    let offset = block - origin;
    let remainder = offset % interval;
    if remainder == 0 {
        block
    } else {
        block + (interval - remainder)
    }
}
