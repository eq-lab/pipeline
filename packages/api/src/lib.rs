mod middleware;
pub mod routes;

use shared::kyc_repo::KycRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;

pub struct AppState {
    pub pool: sqlx::PgPool,
    pub kyc_repo: KycRepo,
    pub sumsub_client: Option<SumsubClient>,
    pub sumsub_settings: Option<SumsubSettings>,
}
