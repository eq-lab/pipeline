use bigdecimal::BigDecimal;
use serde::{Deserialize, Serialize};

/// The "snapshot" portion of `contract_logs.params` for any loan-related event.
/// Mirrors what `LoanHistoryRow`'s data columns carried; carry-forward fields
/// (IPFS + immutable) are sourced from the most recent prior row, mutable fields
/// from block-pinned eth_calls at event.block_number.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoanSnapshot {
    // IPFS-sourced
    pub originator: String,
    pub borrower_id: String,
    pub commodity: String,
    pub corridor: String,
    pub governing_law: String,
    /// Trade-finance protection instrument (e.g. "LC at sight", "Doc. coll.").
    /// `#[serde(default)]` is required: `LoanSnapshot` is `deny_unknown_fields` and
    /// is deserialized from existing `contract_logs.params.snapshot` JSONB rows that
    /// predate this field — empty string when absent.
    #[serde(default)]
    pub protection: String,
    /// Secondary URI inside the IPFS JSON document (optional). Distinct from
    /// `metadata_uri_onchain` which is the mutable on-chain URI pointer.
    pub metadata_uri: Option<String>,

    // immutableLoanData (7 fields matching the new contract struct)
    pub original_facility_size: BigDecimal,
    pub original_senior_tranche: BigDecimal,
    pub original_equity_tranche: BigDecimal,
    pub original_offtaker_price: BigDecimal,
    /// u32 on-chain; stored as u32 here (widened from i32 in prior schema).
    pub senior_interest_rate_bps: u32,
    /// Cast from u64 on-chain.
    pub origination_date: i64,
    /// Cast from u64 on-chain. Use `current_maturity_timestamp` for the rollover-aware value.
    pub original_maturity_date: i64,

    // mutableLoanData (block-pinned)
    /// Informational: `nextEconomicsEpochsId` from on-chain.
    pub next_economics_epochs_id: BigDecimal,
    pub next_repayment_id: BigDecimal,
    pub status: String,
    pub ccr_bps: u32,
    pub last_reported_ccr_timestamp: i64,
    /// Rollover-aware maturity timestamp (may differ from `original_maturity_date` after rollovers).
    /// NOTE: The portfolio yield compute uses `original_maturity_date` for the scheduled-end
    /// boundary to preserve existing yield-computation semantics. `current_maturity_timestamp`
    /// is stored for informational/future use.
    pub current_maturity_timestamp: i64,
    pub closure_reason: String,
    pub current_location: LocationUpdateSnapshot,
    /// The mutable on-chain URI (from `MutableLoanData.metadataURI`). Re-fetched from IPFS
    /// when it changes between events. Separate from `metadata_uri` (the secondary URI
    /// inside the IPFS JSON document).
    pub metadata_uri_onchain: String,

    // cumulativeRepaymentData (block-pinned)
    pub repayment: RepaymentSnapshot,
}

/// Snapshot of the on-chain `LocationUpdate` struct at event time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocationUpdateSnapshot {
    pub location_type: String,
    pub location_identifier: String,
    pub tracking_url: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RepaymentSnapshot {
    pub offtaker_received: BigDecimal,
    pub senior_principal_repaid: BigDecimal,
    pub senior_interest: BigDecimal,
    pub equity_distributed: BigDecimal,
    pub mgmt_fee: BigDecimal,
    pub perf_fee: BigDecimal,
    pub oet_alloc: BigDecimal,
}
