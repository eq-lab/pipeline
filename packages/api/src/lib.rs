mod middleware;
pub mod routes;

use alloy::signers::local::PrivateKeySigner;
use shared::eip712::Eip712Domain;
use shared::kyc_repo::KycRepo;
use shared::position_repo::PositionRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;

pub struct AppState {
    pub pool: sqlx::PgPool,
    pub kyc_repo: KycRepo,
    pub position_repo: PositionRepo,
    pub chain_id: i64,
    pub sumsub_client: Option<SumsubClient>,
    pub sumsub_settings: Option<SumsubSettings>,
    pub voucher_signer: Option<PrivateKeySigner>,
    pub dm_domain: Option<Eip712Domain>,
    pub wq_domain: Option<Eip712Domain>,
    pub crystal_enabled: bool,
}
