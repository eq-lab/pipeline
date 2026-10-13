// spec: docs/superpowers/specs/2026-10-12-multi-chain-price-poller-design.md#vault-source-settings-mirrored-into-vaults
use alloy::primitives::{Address, U256};
use alloy::providers::Provider;
use alloy::rpc::types::BlockNumberOrTag;
use alloy::sol;
use alloy::sol_types::SolCall;
use alloy::transports::http::Http;
use anyhow::Context;
use chrono::{DateTime, Utc};
use reqwest::Client;

sol! {
    #[sol(rpc)]
    interface IERC4626 {
        function convertToAssets(uint256 shares) external view returns (uint256 assets);
        function decimals() external view returns (uint8);
        function asset() external view returns (address);
    }
}

pub type HttpProvider = alloy::providers::RootProvider<Http<Client>>;

pub fn decode_decimals(ret: &[u8]) -> anyhow::Result<u8> {
    let decoded = IERC4626::decimalsCall::abi_decode_returns(ret, true)
        .context("decode decimals() return")?;
    Ok(decoded._0)
}

pub fn decode_asset(ret: &[u8]) -> anyhow::Result<Address> {
    let decoded =
        IERC4626::assetCall::abi_decode_returns(ret, true).context("decode asset() return")?;
    Ok(decoded._0)
}

async fn call_latest(
    provider: &HttpProvider,
    to: Address,
    call_data: Vec<u8>,
) -> anyhow::Result<alloy::primitives::Bytes> {
    let result = provider
        .call(
            &alloy::rpc::types::TransactionRequest::default()
                .to(to)
                .input(call_data.into()),
        )
        .await?;
    Ok(result)
}

pub async fn fetch_decimals(provider: &HttpProvider, contract: Address) -> anyhow::Result<u8> {
    let ret = call_latest(provider, contract, IERC4626::decimalsCall {}.abi_encode()).await?;
    decode_decimals(&ret).with_context(|| format!("decimals() on {contract}"))
}

pub async fn fetch_asset(provider: &HttpProvider, vault: Address) -> anyhow::Result<Address> {
    let ret = call_latest(provider, vault, IERC4626::assetCall {}.abi_encode()).await?;
    decode_asset(&ret).with_context(|| format!("asset() on {vault}"))
}

pub async fn fetch_price_and_timestamp(
    provider: &HttpProvider,
    vault: Address,
    shares: U256,
    block: u64,
) -> anyhow::Result<(U256, DateTime<Utc>)> {
    let call_data = IERC4626::convertToAssetsCall { shares }.abi_encode();

    let result = provider
        .call(
            &alloy::rpc::types::TransactionRequest::default()
                .to(vault)
                .input(call_data.into()),
        )
        .block(BlockNumberOrTag::Number(block).into())
        .await?;

    if result.len() < 32 {
        anyhow::bail!(
            "convertToAssets returned {} bytes (expected ≥32) for vault {vault} at block {block}; vault may not exist at this block",
            result.len()
        );
    }
    let assets = U256::from_be_slice(&result[result.len() - 32..]);

    let block_info = provider
        .get_block_by_number(BlockNumberOrTag::Number(block), false.into())
        .await?
        .ok_or_else(|| anyhow::anyhow!("block {block} not found"))?;

    let ts = DateTime::from_timestamp(block_info.header.timestamp as i64, 0).unwrap_or_default();

    Ok((assets, ts))
}
