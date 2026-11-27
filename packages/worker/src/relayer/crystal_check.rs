// EVM Phase 2 wiring: Crystal over this chain's transfers only.
// spec: docs/superpowers/specs/2026-05-06-crystal-kyt-integration-design.md
use shared::crystal::client::CrystalClient;
use shared::kyc_repo::KycRepo;

use super::kyt_check::phase_check_kyt;
pub use super::kyt_check::{screen_profile, screen_transfer};

pub async fn phase_check_crystal(crystal: &CrystalClient, kyc_repo: &KycRepo, chain_id: i64) {
    phase_check_kyt(crystal, kyc_repo, chain_id).await;
}
