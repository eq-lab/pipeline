use alloy::eips::BlockId;
use alloy::primitives::{Address, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::sol;
use alloy::sol_types::SolCall;
use alloy::transports::http::Http;
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;

use super::loan_metadata::{
    ImmutableDataResolver, ImmutableLoanDataView, LocationType, LocationUpdateView,
    MutableDataResolver, MutableLoanDataView, RepaymentDataView,
};

sol! {
    interface ILoanRegistry {
        enum LoanStatus {
            Performing,
            WatchList,
            Default,
            Closed
        }

        enum ClosureReason {
            None,
            ScheduledMaturity,
            EarlyRepayment,
            Default,
            OtherWriteDown
        }

        enum LocationType {
            Vessel,
            Warehouse,
            TankFarm,
            Other
        }

        struct LocationUpdate {
            LocationType locationType;
            string locationIdentifier;
            string trackingURL;
            uint64 updatedAt;
        }

        struct ImmutableLoanData {
            uint256 originalFacilitySize;
            uint256 originalSeniorTranche;
            uint256 originalEquityTranche;
            uint256 originalOfftakerPrice;
            uint32 seniorInterestRateBps;
            uint64 originationDate;
            uint64 originalMaturityDate;
        }

        struct MutableLoanData {
            uint256 nextEconomicsEpochsId;
            uint256 nextRepaymentId;
            LoanStatus status;
            uint32 ccrBps;
            uint64 lastReportedCCRTimestamp;
            uint64 currentMaturityTimestamp;
            ClosureReason closureReason;
            LocationUpdate currentLocation;
            string metadataURI;
        }

        struct RepaymentData {
            uint256 offtakerReceived;
            uint256 seniorPrincipalRepaid;
            uint256 seniorInterest;
            uint256 equityDistributed;
            uint256 mgmtFee;
            uint256 perfFee;
            uint256 oetAlloc;
        }

        function immutableLoanData(uint256 loanId) external view returns (ImmutableLoanData memory);
        function mutableLoanData(uint256 loanId) external view returns (MutableLoanData memory);
        function cumulativeRepaymentData(uint256 loanId) external view returns (RepaymentData memory);
    }
}

type HttpProvider = alloy::providers::RootProvider<Http<Client>>;

/// Reads on-chain LoanRegistry data via eth_call. Implements two resolver traits:
/// - `ImmutableDataResolver`: `immutableLoanData(loanId)` — reads the immutable struct.
/// - `MutableDataResolver`: `mutableLoanData(loanId)` — reads the mutable struct.
///
/// No in-process cache: each `LoanDrawn` event is processed exactly once (the
/// `is_duplicate(contract_logs)` gate short-circuits any re-process), so a cache would
/// have a 0% hit rate in the steady state. Reintroduce caching only if a new code path
/// starts calling these methods outside the once-per-event ingest flow.
pub struct LoanRegistryReader {
    provider: HttpProvider,
}

impl LoanRegistryReader {
    pub fn new(rpc_url: &str) -> Result<Self> {
        let provider: HttpProvider = ProviderBuilder::new().on_http(
            rpc_url
                .parse()
                .with_context(|| format!("LoanRegistryReader: invalid RPC URL {rpc_url}"))?,
        );
        Ok(Self { provider })
    }
}

#[async_trait]
impl ImmutableDataResolver for LoanRegistryReader {
    async fn immutable_loan_data(
        &self,
        contract: Address,
        loan_id: U256,
    ) -> Result<ImmutableLoanDataView> {
        let call_data = ILoanRegistry::immutableLoanDataCall { loanId: loan_id }.abi_encode();

        let result = self
            .provider
            .call(
                &alloy::rpc::types::TransactionRequest::default()
                    .to(contract)
                    .input(call_data.into()),
            )
            .await
            .with_context(|| {
                format!("eth_call immutableLoanData({loan_id}) on {contract} failed")
            })?;

        let decoded = ILoanRegistry::immutableLoanDataCall::abi_decode_returns(&result, true)
            .with_context(|| format!("decode immutableLoanData({loan_id}) return"))?;
        let d = decoded._0;
        Ok(ImmutableLoanDataView {
            original_facility_size: d.originalFacilitySize,
            original_senior_tranche: d.originalSeniorTranche,
            original_equity_tranche: d.originalEquityTranche,
            original_offtaker_price: d.originalOfftakerPrice,
            senior_interest_rate_bps: d.seniorInterestRateBps,
            origination_date: d.originationDate,
            original_maturity_date: d.originalMaturityDate,
        })
    }
}

#[async_trait]
impl MutableDataResolver for LoanRegistryReader {
    async fn mutable_loan_data(
        &self,
        contract: Address,
        loan_id: U256,
        block: BlockId,
    ) -> Result<MutableLoanDataView> {
        let call_data = ILoanRegistry::mutableLoanDataCall { loanId: loan_id }.abi_encode();

        let result = self
            .provider
            .call(
                &alloy::rpc::types::TransactionRequest::default()
                    .to(contract)
                    .input(call_data.into()),
            )
            .block(block)
            .await
            .with_context(|| {
                format!("eth_call mutableLoanData({loan_id}) on {contract} at {block:?} failed")
            })?;

        let decoded = ILoanRegistry::mutableLoanDataCall::abi_decode_returns(&result, true)
            .with_context(|| format!("decode mutableLoanData({loan_id}) return"))?;
        let d = decoded._0;
        let loc = d.currentLocation;
        Ok(MutableLoanDataView {
            next_economics_epochs_id: d.nextEconomicsEpochsId,
            next_repayment_id: d.nextRepaymentId,
            status: d.status as u8,
            ccr_bps: d.ccrBps,
            last_reported_ccr_timestamp: d.lastReportedCCRTimestamp,
            current_maturity_timestamp: d.currentMaturityTimestamp,
            closure_reason: d.closureReason as u8,
            current_location: LocationUpdateView {
                location_type: LocationType::from_ordinal(loc.locationType as u8),
                location_identifier: loc.locationIdentifier,
                tracking_url: loc.trackingURL,
                updated_at: loc.updatedAt,
            },
            metadata_uri: d.metadataURI,
        })
    }

    async fn cumulative_repayment_data(
        &self,
        contract: Address,
        loan_id: U256,
        block: BlockId,
    ) -> Result<RepaymentDataView> {
        let call_data = ILoanRegistry::cumulativeRepaymentDataCall { loanId: loan_id }.abi_encode();

        let result = self
            .provider
            .call(
                &alloy::rpc::types::TransactionRequest::default()
                    .to(contract)
                    .input(call_data.into()),
            )
            .block(block)
            .await
            .with_context(|| {
                format!(
                    "eth_call cumulativeRepaymentData({loan_id}) on {contract} at {block:?} failed"
                )
            })?;

        let decoded = ILoanRegistry::cumulativeRepaymentDataCall::abi_decode_returns(&result, true)
            .with_context(|| format!("decode cumulativeRepaymentData({loan_id}) return"))?;
        let rd = decoded._0;
        Ok(RepaymentDataView {
            offtaker_received: rd.offtakerReceived,
            senior_principal_repaid: rd.seniorPrincipalRepaid,
            senior_interest: rd.seniorInterest,
            equity_distributed: rd.equityDistributed,
            mgmt_fee: rd.mgmtFee,
            perf_fee: rd.perfFee,
            oet_alloc: rd.oetAlloc,
        })
    }
}
