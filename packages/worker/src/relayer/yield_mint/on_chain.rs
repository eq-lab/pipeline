use std::str::FromStr;

use alloy::primitives::{Address, B256, U256};
use alloy::providers::Provider;
use alloy::rpc::types::TransactionRequest;
use alloy::sol;
use alloy::sol_types::SolCall;
use anyhow::{Context, Result};
use async_trait::async_trait;

use super::HttpProvider;

sol! {
    function canYieldBeMinted(uint256 loanId, uint256 repaymentId) external view returns (bool);
}

/// Trait abstracting the `canYieldBeMinted` view call.
///
/// The real impl delegates to the alloy `HttpProvider`; tests mock this trait.
#[async_trait]
pub trait CanYieldBeMintedView: Send + Sync {
    async fn can_yield_be_minted(
        &self,
        loan_registry: Address,
        loan_id: U256,
        repayment_id: U256,
    ) -> Result<bool>;
}

/// Production implementation that issues an `eth_call` to the RPC endpoint.
pub struct OnChainCanYieldBeMinted {
    provider: HttpProvider,
}

impl OnChainCanYieldBeMinted {
    pub fn new(provider: HttpProvider) -> Self {
        Self { provider }
    }
}

#[async_trait]
impl CanYieldBeMintedView for OnChainCanYieldBeMinted {
    async fn can_yield_be_minted(
        &self,
        loan_registry: Address,
        loan_id: U256,
        repayment_id: U256,
    ) -> Result<bool> {
        can_yield_be_minted_call(&self.provider, loan_registry, loan_id, repayment_id).await
    }
}

/// Free function that performs the actual `eth_call`.
pub async fn can_yield_be_minted_call(
    provider: &HttpProvider,
    loan_registry: Address,
    loan_id: U256,
    repayment_id: U256,
) -> Result<bool> {
    let call_data = canYieldBeMintedCall {
        loanId: loan_id,
        repaymentId: repayment_id,
    }
    .abi_encode();

    let result = provider
        .call(
            &TransactionRequest::default()
                .to(loan_registry)
                .input(call_data.into()),
        )
        .await
        .with_context(|| {
            format!(
                "eth_call canYieldBeMinted({loan_id}, {repayment_id}) on {loan_registry} failed"
            )
        })?;

    let decoded = canYieldBeMintedCall::abi_decode_returns(&result, true).with_context(|| {
        format!("decode canYieldBeMinted({loan_id}, {repayment_id}) return value")
    })?;

    Ok(decoded._0)
}

/// Errors returned by `TransactionReceiptView::get_receipt_status`.
///
/// Mirrors the definitive-vs-transient split used by `BitgoError`: the caller
/// uses `is_definitive()` to decide between `mark_failed` (definitive) and
/// "leave the row submitted, retry next cycle" (transient).
#[derive(Debug, thiserror::Error)]
pub enum ReceiptViewError {
    /// The tx hash supplied by BitGo could not be parsed as a 32-byte hex
    /// value. Retrying will return the same malformed hash, so this is
    /// definitive.
    #[error("invalid tx hash {hash}: {source}")]
    InvalidHash {
        hash: String,
        #[source]
        source: anyhow::Error,
    },

    /// RPC transport/decoding failure — transient.
    #[error("RPC error: {0}")]
    Rpc(#[source] anyhow::Error),
}

impl ReceiptViewError {
    pub fn is_definitive(&self) -> bool {
        matches!(self, ReceiptViewError::InvalidHash { .. })
    }
}

/// Trait abstracting `eth_getTransactionReceipt` for the yield-mint
/// confirmation step.
///
/// BitGo signals `state=delivered` as soon as it broadcasts the tx; that does
/// not guarantee the tx was actually included or that it succeeded. Phase 4
/// uses this trait to verify on-chain status before marking a row as
/// `confirmed`.
#[async_trait]
pub trait TransactionReceiptView: Send + Sync {
    /// Fetch a transaction's success status.
    ///
    /// * `Ok(None)`             — RPC has no receipt for this hash yet (tx
    ///   still pending, indexing lag, or a reorg dropped it). Caller should
    ///   retry next cycle.
    /// * `Ok(Some(true))`       — receipt found and execution succeeded.
    /// * `Ok(Some(false))`      — receipt found and the tx reverted.
    /// * `Err(InvalidHash { .. })` — definitive failure; caller should
    ///   `mark_failed`.
    /// * `Err(Rpc(_))`          — transient; caller should retry.
    async fn get_receipt_status(
        &self,
        tx_hash: &str,
    ) -> std::result::Result<Option<bool>, ReceiptViewError>;
}

pub struct OnChainTransactionReceipt {
    provider: HttpProvider,
}

impl OnChainTransactionReceipt {
    pub fn new(provider: HttpProvider) -> Self {
        Self { provider }
    }
}

#[async_trait]
impl TransactionReceiptView for OnChainTransactionReceipt {
    async fn get_receipt_status(
        &self,
        tx_hash: &str,
    ) -> std::result::Result<Option<bool>, ReceiptViewError> {
        let hash = B256::from_str(tx_hash).map_err(|e| ReceiptViewError::InvalidHash {
            hash: tx_hash.to_owned(),
            source: anyhow::Error::new(e),
        })?;
        let receipt = self
            .provider
            .get_transaction_receipt(hash)
            .await
            .map_err(|e| {
                ReceiptViewError::Rpc(
                    anyhow::Error::new(e)
                        .context(format!("eth_getTransactionReceipt({tx_hash}) failed")),
                )
            })?;
        Ok(receipt.map(|r| r.status()))
    }
}
