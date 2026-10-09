use std::sync::Arc;

use anyhow::Result;
use shared::kyc_repo::KycRepo;

use crate::relayer::config::RelayerSettings;
use crate::relayer::evm::job::run_evm_relayer_inner;
use crate::relayer::stellar::job::run_stellar_relayer_inner;

pub async fn run_relayer_job(settings: RelayerSettings, kyc_repo: Arc<KycRepo>) -> Result<()> {
    match settings {
        RelayerSettings::Evm(s) => run_evm_relayer_inner(*s, kyc_repo).await,
        RelayerSettings::Stellar(s) => run_stellar_relayer_inner(*s, kyc_repo).await,
    }
}
