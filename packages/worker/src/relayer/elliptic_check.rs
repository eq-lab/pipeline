// Stellar Phase 2 wiring: Elliptic over this chain's transfers only.
// spec: docs/superpowers/specs/2026-07-06-elliptic-stellar-kyt-design.md
use shared::elliptic::client::EllipticClient;
use shared::kyc_repo::KycRepo;

use super::kyt_check::phase_check_kyt;
pub use super::kyt_check::{screen_profile, screen_transfer};

pub async fn phase_check_elliptic(
    elliptic: &EllipticClient,
    kyc_repo: &KycRepo,
    chain_id: i64,
    backlog_warn_secs: i64,
) {
    phase_check_kyt(elliptic, kyc_repo, chain_id, backlog_warn_secs).await;
}
