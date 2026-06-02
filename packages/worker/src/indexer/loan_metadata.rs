use alloy::eips::BlockId;
use alloy::primitives::{Address, U256};
use async_trait::async_trait;

use shared::metadata_fetcher::MetadataFetcher;

/// Off-chain JSON document pointed at by `tokenURI(loanId)`.
/// Contains only the six fields that live off-chain; all other loan data
/// comes from the on-chain `immutableLoanData` / `mutableLoanData` views.
///
/// Note: `metadataURI` is now a mutable field on-chain (stored in `MutableLoanData.metadataURI`).
/// The IPFS document shape is unchanged — this DTO still deserialises the same six fields.
/// The on-chain URI itself is tracked in `LoanSnapshot.metadata_uri_onchain`.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoanMetadataJson {
    pub originator: String,
    #[serde(rename = "borrowerId")]
    pub borrower_id: String,
    pub commodity: String,
    pub corridor: String,
    #[serde(rename = "governingLaw")]
    pub governing_law: String,
    // Optional secondary URI inside the JSON document. Empty/missing is a
    // normal value — stored as NULL in the snapshot's `metadata_uri` field, never a fetch failure.
    #[serde(default, rename = "metadataURI")]
    pub metadata_uri: Option<String>,
}

/// Plain-Rust projection of `ILoanRegistry.ImmutableLoanData` returned by
/// `LoanRegistryReader::immutable_loan_data`. Decouples the mapper from the
/// alloy-generated types so mapper tests can use a mock resolver.
#[derive(Debug, Clone)]
pub struct ImmutableLoanDataView {
    pub original_facility_size: alloy::primitives::U256,
    pub original_senior_tranche: alloy::primitives::U256,
    pub original_equity_tranche: alloy::primitives::U256,
    pub original_offtaker_price: alloy::primitives::U256,
    pub senior_interest_rate_bps: u32,
    pub origination_date: u64,
    pub original_maturity_date: u64,
}

/// Location type enum matching the on-chain `ILoanRegistry.LocationType`.
/// 0=Vessel, 1=Warehouse, 2=TankFarm, 3=Other
#[derive(Debug, Clone, PartialEq)]
pub enum LocationType {
    Vessel,
    Warehouse,
    TankFarm,
    Other,
}

impl LocationType {
    /// Map numeric ordinal from on-chain enum to Rust variant.
    /// Out-of-range values clamp to `Other`.
    pub fn from_ordinal(ord: u8) -> LocationType {
        match ord {
            0 => LocationType::Vessel,
            1 => LocationType::Warehouse,
            2 => LocationType::TankFarm,
            _ => LocationType::Other,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            LocationType::Vessel => "Vessel",
            LocationType::Warehouse => "Warehouse",
            LocationType::TankFarm => "TankFarm",
            LocationType::Other => "Other",
        }
    }
}

/// Plain-Rust projection of `ILoanRegistry.LocationUpdate`.
#[derive(Debug, Clone)]
pub struct LocationUpdateView {
    pub location_type: LocationType,
    pub location_identifier: String,
    pub tracking_url: String,
    pub updated_at: u64,
}

/// Plain-Rust projection of `ILoanRegistry.RepaymentData`.
#[derive(Debug, Clone)]
pub struct RepaymentDataView {
    pub offtaker_received: alloy::primitives::U256,
    pub senior_principal_repaid: alloy::primitives::U256,
    pub senior_interest: alloy::primitives::U256,
    pub equity_distributed: alloy::primitives::U256,
    pub mgmt_fee: alloy::primitives::U256,
    pub perf_fee: alloy::primitives::U256,
    pub oet_alloc: alloy::primitives::U256,
}

/// Plain-Rust projection of `ILoanRegistry.MutableLoanData` returned by
/// `LoanRegistryReader::mutable_loan_data`. Decouples the mapper from alloy types.
#[derive(Debug, Clone)]
pub struct MutableLoanDataView {
    /// `nextEconomicsEpochsId` — informational; not queried further.
    pub next_economics_epochs_id: alloy::primitives::U256,
    /// `nextRepaymentId` — monotonically incrementing counter for repayment IDs.
    pub next_repayment_id: alloy::primitives::U256,
    /// Numeric ordinal of `LoanStatus`: 0=Performing, 1=WatchList, 2=Default, 3=Closed
    pub status: u8,
    pub ccr_bps: u32,
    pub last_reported_ccr_timestamp: u64,
    pub current_maturity_timestamp: u64,
    /// Numeric ordinal of `ClosureReason`: 0=None, 1=ScheduledMaturity, 2=EarlyRepayment, 3=Default, 4=OtherWriteDown
    pub closure_reason: u8,
    pub current_location: LocationUpdateView,
    /// The mutable on-chain metadata URI (set by `_updateMutable`).
    pub metadata_uri: String,
}

/// Abstraction over the on-chain `immutableLoanData(loanId)` reader.
#[async_trait]
pub trait ImmutableDataResolver: Send + Sync {
    async fn immutable_loan_data(
        &self,
        contract: Address,
        loan_id: U256,
    ) -> anyhow::Result<ImmutableLoanDataView>;
}

/// Abstraction over the on-chain `mutableLoanData(loanId)` and
/// `cumulativeRepaymentData(loanId)` readers.
///
/// `block` pins every call to a specific block so the indexer always reads canonical
/// state at the event's block, even during historical re-sync.
#[async_trait]
pub trait MutableDataResolver: Send + Sync {
    async fn mutable_loan_data(
        &self,
        contract: Address,
        loan_id: U256,
        block: BlockId,
    ) -> anyhow::Result<MutableLoanDataView>;

    /// Read `cumulativeRepaymentData(loanId)` pinned to `block`. This is the
    /// authoritative source for the 7 repayment fields — `MutableLoanData` carries
    /// no cumulative repayment data in the new contract.
    async fn cumulative_repayment_data(
        &self,
        contract: Address,
        loan_id: U256,
        block: BlockId,
    ) -> anyhow::Result<RepaymentDataView>;
}

/// Abstraction over the metadata fetch so tests can substitute a mock without spinning
/// up an HTTP server. The production implementation delegates to the shared
/// `MetadataFetcher::fetch_json::<LoanMetadataJson>`.
#[async_trait]
pub trait LoanMetadataFetcher: Send + Sync {
    async fn fetch_metadata(&self, uri: &str) -> anyhow::Result<LoanMetadataJson>;
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
    async fn fetch_metadata(&self, uri: &str) -> anyhow::Result<LoanMetadataJson> {
        self.inner.fetch_json::<LoanMetadataJson>(uri).await
    }
}
