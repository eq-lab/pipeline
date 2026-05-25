use alloy::primitives::{Address, U256};
use async_trait::async_trait;

use shared::metadata_fetcher::MetadataFetcher;

/// Off-chain JSON document pointed at by `tokenURI(loanId)`. Mirrors the Solidity
/// `ImmutableLoanData` struct described in the Issue body — note that no such on-chain
/// struct exists; this DTO is the canonical schema for the JSON the indexer ingests.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImmutableLoanData {
    pub originator: String,
    #[serde(rename = "borrowerId")]
    pub borrower_id: String,
    pub commodity: String,
    pub corridor: String,
    #[serde(rename = "originalFacilitySize")]
    pub original_facility_size: String,
    #[serde(rename = "originalSeniorTranche")]
    pub original_senior_tranche: String,
    #[serde(rename = "originalEquityTranche")]
    pub original_equity_tranche: String,
    #[serde(rename = "originalOfftakerPrice")]
    pub original_offtaker_price: String,
    #[serde(rename = "seniorInterestRateBps")]
    pub senior_interest_rate_bps: String,
    #[serde(rename = "originationDate")]
    pub origination_date: String,
    #[serde(rename = "originalMaturityDate")]
    pub original_maturity_date: String,
    #[serde(rename = "governingLaw")]
    pub governing_law: String,
    // Optional secondary URI inside the JSON document. Per Q3: empty/missing is a
    // normal value — stored as NULL in `loan_details.metadata_uri`, never a fetch failure.
    #[serde(default, rename = "metadataURI")]
    pub metadata_uri: Option<String>,
}

/// Abstraction over the metadata fetch so tests can substitute a mock without spinning
/// up an HTTP server. The production implementation delegates to the shared
/// `MetadataFetcher::fetch_json::<ImmutableLoanData>`.
#[async_trait]
pub trait LoanMetadataFetcher: Send + Sync {
    async fn fetch_metadata(&self, uri: &str) -> anyhow::Result<ImmutableLoanData>;
}

pub struct HttpLoanMetadataFetcher {
    inner: MetadataFetcher,
}

impl HttpLoanMetadataFetcher {
    pub fn new(inner: MetadataFetcher) -> Self {
        Self { inner }
    }
}

#[async_trait]
impl LoanMetadataFetcher for HttpLoanMetadataFetcher {
    async fn fetch_metadata(&self, uri: &str) -> anyhow::Result<ImmutableLoanData> {
        self.inner.fetch_json::<ImmutableLoanData>(uri).await
    }
}

/// Abstraction over the on-chain `tokenURI(loanId)` reader so tests can substitute a mock
/// instead of making real `eth_call` RPCs.
///
/// `contract` is the LoanRegistry address — passed per-call so a single resolver can serve
/// multiple deployed registries (the indexer accepts a CSV of registry addresses).
#[async_trait]
pub trait MetadataUriResolver: Send + Sync {
    async fn metadata_uri(&self, contract: Address, loan_id: U256) -> anyhow::Result<String>;
}
