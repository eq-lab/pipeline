use alloy::primitives::{Address, U256};
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
        enum LoanStatus {
            Approved,
            Performing,
            WatchList,
            Default,
            Closed
        }

        enum ClosureReason {
            None,
            ScheduledMaturity,
            EarlyRepayment,
            Cancelled,
            Default,
            OtherWriteDown
        }

        struct ImmutableLoanData {
            bytes32 borrowerRef;
            uint256 originalFacilitySize;
            uint256 originalSeniorTranche;
            uint256 originalEquityTranche;
            uint256 originalOfftakerPrice;
            uint32 seniorInterestRate;
            uint64 originationDate;
            uint64 originalMaturityDate;
        }

        struct MutableLoanData {
            uint256 nextEconomicsEpochsId;
            uint256 nextRepaymentId;
            LoanStatus status;
            uint64 currentMaturityTimestamp;
            uint32 currentRate;
            ClosureReason closureReason;
            bool carvedOut;
            uint256 disbursed;
            uint256 repaid;
            uint256 writtenDown;
            int256 interestAdjustment;
            string metadataURI;
        }

        function immutableLoanData(uint256 loanId) external view returns (ImmutableLoanData memory);
        function mutableLoanData(uint256 loanId) external view returns (MutableLoanData memory);
    }
}

type HttpProvider = alloy::providers::RootProvider<Http<Client>>;

/// `LoanRegistryUpgradeable.sol:17,653,235,610` — ppm (`ONE = 1_000_000`) to bps.
fn ppm_to_bps(raw: u32) -> u32 {
    raw / 100
}

/// Pure decode, unit-tested in `packages/worker/tests/loan_registry_reader.rs`.
pub fn decode_immutable_loan_data(result: &[u8]) -> Result<ImmutableLoanDataView> {
    let decoded = ILoanRegistry::immutableLoanDataCall::abi_decode_returns(result, true)
        .context("decode immutableLoanData return")?;
    let d = decoded._0;
    Ok(ImmutableLoanDataView {
        borrower_ref: Some(d.borrowerRef),
        original_facility_size: d.originalFacilitySize,
        original_senior_tranche: d.originalSeniorTranche,
        original_equity_tranche: d.originalEquityTranche,
        original_offtaker_price: d.originalOfftakerPrice,
        senior_interest_rate_bps: ppm_to_bps(d.seniorInterestRate),
        origination_date: d.originationDate,
        original_maturity_date: d.originalMaturityDate,
    })
}

/// Pure decode, unit-tested in `packages/worker/tests/loan_registry_reader.rs`.
pub fn decode_mutable_loan_data(result: &[u8]) -> Result<MutableLoanDataView> {
    let decoded = ILoanRegistry::mutableLoanDataCall::abi_decode_returns(result, true)
        .context("decode mutableLoanData return")?;
    let d = decoded._0;
    Ok(MutableLoanDataView {
        next_economics_epochs_id: d.nextEconomicsEpochsId,
        next_repayment_id: d.nextRepaymentId,
        status: d.status as u8,
        current_maturity_timestamp: d.currentMaturityTimestamp,
        current_rate: ppm_to_bps(d.currentRate),
        closure_reason: d.closureReason as u8,
        carved_out: d.carvedOut,
        disbursed: d.disbursed,
        repaid: d.repaid,
        written_down: d.writtenDown,
        interest_adjustment: d.interestAdjustment,
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

        decode_immutable_loan_data(&result)
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

    /// `cumulativeRepaymentData()` no longer exists (`LoanRegistryUpgradeable.sol:28-32,96`); `loan_mapper.rs` reconstructs it from indexed rows.
    async fn cumulative_repayment_data(
        &self,
        _contract: &Address,
        _loan_id: U256,
        _block: BlockHint,
    ) -> Result<Option<RepaymentDataView>> {
        Ok(None)
    }
}
