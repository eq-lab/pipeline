use alloy::primitives::{Address, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::sol;
use alloy::sol_types::SolCall;
use alloy::transports::http::Http;
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;

use super::loan_metadata::MetadataUriResolver;

sol! {
    interface ILoanRegistryTokenURI {
        function tokenURI(uint256 tokenId) external view returns (string memory);
    }
}

type HttpProvider = alloy::providers::RootProvider<Http<Client>>;

/// Recovers the canonical metadata URI for a loan via the standard ERC-721
/// `tokenURI(tokenId)` reader on `LoanRegistryUpgradeable`.
///
/// The deployed contract does NOT expose `getImmutable(loanId)` or any on-chain
/// `ImmutableLoanData` struct — it inherits ERC-721 and only exposes `tokenURI`.
/// We use that to recover the URI string because the `LoanMinted` event declares
/// `string indexed metadataURI`, so the topic value is the keccak256 hash of the URI,
/// not the URI itself.
///
/// No in-process cache: each `LoanMinted` event is processed exactly once (the
/// `is_duplicate(contract_logs)` gate short-circuits any re-process), so a cache would
/// have a 0% hit rate in the steady state. Reintroduce caching only if a new code path
/// starts calling `tokenURI` outside the once-per-event ingest flow.
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
impl MetadataUriResolver for LoanRegistryReader {
    async fn metadata_uri(&self, contract: Address, loan_id: U256) -> Result<String> {
        let call_data = ILoanRegistryTokenURI::tokenURICall { tokenId: loan_id }.abi_encode();

        let result = self
            .provider
            .call(
                &alloy::rpc::types::TransactionRequest::default()
                    .to(contract)
                    .input(call_data.into()),
            )
            .await
            .with_context(|| format!("eth_call tokenURI({loan_id}) on {contract} failed"))?;

        let decoded = ILoanRegistryTokenURI::tokenURICall::abi_decode_returns(&result, true)
            .with_context(|| format!("decode tokenURI({loan_id}) return"))?;
        Ok(decoded._0)
    }
}
