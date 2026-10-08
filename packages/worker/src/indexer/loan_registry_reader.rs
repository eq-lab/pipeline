use alloy::primitives::{Address, I256, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::sol;
use alloy::sol_types::SolCall;
use alloy::transports::http::Http;
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;

use super::loan_metadata::{
    BlockHint, ImmutableDataResolver, ImmutableLoanDataView, MutableDataResolver,
    MutableLoanDataView, RepaymentDataView,
};

sol! {
    interface ILoanRegistry {
        // #1434: hoodi-v4 (the only EVM deployment) is pre-rework; translate_pre_rework_status maps its ordinals into the canonical post-rework space until #1434 realigns this enum.
        enum LoanStatus {
            Performing,
            WatchList,
            Default,
            Closed
        }

        // #1434: hoodi-v4 is pre-rework; translate_pre_rework_closure_reason maps its ordinals into the canonical post-rework space until #1434 realigns this enum.
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

// #1434: hoodi-v4 reports LoanStatus as 0=Performing,1=WatchList,2=Default,3=Closed (no Approved). Maps into the canonical post-rework ordinals loan_mapper::loan_status_name expects (0=Approved,1=Performing,2=WatchList,3=Default,4=Closed). Deleted together with the sol! realignment once #1434 lands.
pub(crate) fn translate_pre_rework_status(ordinal: u8) -> u8 {
    match ordinal {
        0 => 1, // Performing
        1 => 2, // WatchList
        2 => 3, // Default
        3 => 4, // Closed
        other => other,
    }
}

// #1434: hoodi-v4 reports ClosureReason as 0=None,1=ScheduledMaturity,2=EarlyRepayment,3=Default,4=OtherWriteDown (no Cancelled). Maps into the canonical post-rework ordinals loan_mapper::closure_reason_name expects (…,3=Cancelled,4=Default,5=OtherWriteDown). Deleted together with the sol! realignment once #1434 lands.
pub(crate) fn translate_pre_rework_closure_reason(ordinal: u8) -> u8 {
    match ordinal {
        0 => 0, // None
        1 => 1, // ScheduledMaturity
        2 => 2, // EarlyRepayment
        3 => 4, // Default
        4 => 5, // OtherWriteDown
        other => other,
    }
}

/// Decode the `MutableLoanData` return value of `mutableLoanData(loanId)` and translate
/// its pre-rework `status`/`closureReason` ordinals into the canonical post-rework space.
/// `ccrBps`, `lastReportedCCRTimestamp` and `currentLocation` are decoded (required for the
/// struct to match hoodi-v4's ABI) and discarded — `MutableLoanDataView` no longer carries them.
/// Pure function so it is unit-testable without a live eth_call; see
/// `packages/worker/tests/loan_registry_reader.rs`.
pub fn decode_mutable_loan_data(result: &[u8]) -> Result<MutableLoanDataView> {
    let decoded = ILoanRegistry::mutableLoanDataCall::abi_decode_returns(result, true)
        .context("decode mutableLoanData return")?;
    let d = decoded._0;
    Ok(MutableLoanDataView {
        next_economics_epochs_id: d.nextEconomicsEpochsId,
        next_repayment_id: d.nextRepaymentId,
        status: translate_pre_rework_status(d.status as u8),
        current_maturity_timestamp: d.currentMaturityTimestamp,
        // #1434: realign the sol! block
        current_rate: 0,
        closure_reason: translate_pre_rework_closure_reason(d.closureReason as u8),
        // #1434: realign the sol! block
        carved_out: false,
        // #1434: realign the sol! block
        disbursed: U256::ZERO,
        // #1434: realign the sol! block
        repaid: U256::ZERO,
        // #1434: realign the sol! block
        written_down: U256::ZERO,
        // #1434: realign the sol! block
        interest_adjustment: I256::ZERO,
        metadata_uri: d.metadataURI,
    })
}

/// Reads on-chain LoanRegistry data via eth_call. Implements two resolver traits:
/// - `ImmutableDataResolver<Address, U256>`: `immutableLoanData(loanId)` — reads the immutable struct.
/// - `MutableDataResolver<Address, U256>`: `mutableLoanData(loanId)` — reads the mutable struct.
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
impl ImmutableDataResolver<Address, U256> for LoanRegistryReader {
    async fn immutable_loan_data(
        &self,
        contract: &Address,
        loan_id: U256,
    ) -> Result<ImmutableLoanDataView> {
        let call_data = ILoanRegistry::immutableLoanDataCall { loanId: loan_id }.abi_encode();

        let result = self
            .provider
            .call(
                &alloy::rpc::types::TransactionRequest::default()
                    .to(*contract)
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
            // #1434: not decoded yet; hoodi-v4's ImmutableLoanData carries no borrowerRef field.
            borrower_ref: None,
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
impl MutableDataResolver<Address, U256> for LoanRegistryReader {
    async fn mutable_loan_data(
        &self,
        contract: &Address,
        loan_id: U256,
        block: BlockHint,
    ) -> Result<MutableLoanDataView> {
        let call_data = ILoanRegistry::mutableLoanDataCall { loanId: loan_id }.abi_encode();

        let result = self
            .provider
            .call(
                &alloy::rpc::types::TransactionRequest::default()
                    .to(*contract)
                    .input(call_data.into()),
            )
            .block(block.to_evm_block_id())
            .await
            .with_context(|| {
                format!(
                    "eth_call mutableLoanData({loan_id}) on {contract} at block {block:?} failed"
                )
            })?;

        decode_mutable_loan_data(&result)
    }

    async fn cumulative_repayment_data(
        &self,
        contract: &Address,
        loan_id: U256,
        block: BlockHint,
    ) -> Result<RepaymentDataView> {
        let call_data = ILoanRegistry::cumulativeRepaymentDataCall { loanId: loan_id }.abi_encode();

        let result = self
            .provider
            .call(
                &alloy::rpc::types::TransactionRequest::default()
                    .to(*contract)
                    .input(call_data.into()),
            )
            .block(block.to_evm_block_id())
            .await
            .with_context(|| {
                format!(
                    "eth_call cumulativeRepaymentData({loan_id}) on {contract} at block {block:?} failed"
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
