use std::str::FromStr;

use alloy::primitives::{Address, U256};
use anyhow::{Context, Result};
use bigdecimal::BigDecimal;
use shared::funding_repo::FundingRepo;

use crate::relayer::config::RelayerJobSettings;
use crate::relayer::custodian::CustodianSigner;

/// USDC has 6 decimals.
const USDC_DECIMALS: u32 = 6;

pub async fn phase_funding(
    signer: &dyn CustodianSigner,
    funding_repo: &FundingRepo,
    settings: &RelayerJobSettings,
) -> Result<()> {
    let eligible_queued = funding_repo
        .get_eligible_queued(settings.chain_id)
        .await
        .context("failed to query eligible queued")?;

    let current_claimable_u256 = signer
        .current_claimable()
        .await
        .context("failed to read on-chain claimable")?;

    let current_claimable = BigDecimal::from_str(&current_claimable_u256.to_string())
        .context("failed to convert claimable to BigDecimal")?;

    let delta = &eligible_queued - &current_claimable;

    if delta <= BigDecimal::default() {
        tracing::debug!(
            eligible_queued = %eligible_queued,
            current_claimable = %current_claimable,
            "nothing to fund"
        );
        return Ok(());
    }

    let rolling_24h = funding_repo
        .get_rolling_24h_funded(settings.chain_id)
        .await
        .context("failed to query rolling 24h funded")?;

    let per_tx_cap =
        BigDecimal::from(settings.per_tx_cap_usdc) * BigDecimal::from(10u64.pow(USDC_DECIMALS));
    let rolling_24h_cap = BigDecimal::from(settings.rolling_24h_cap_usdc)
        * BigDecimal::from(10u64.pow(USDC_DECIMALS));

    let remaining_budget = &rolling_24h_cap - &rolling_24h;
    if remaining_budget <= BigDecimal::default() {
        tracing::warn!(
            rolling_24h = %rolling_24h,
            cap = %rolling_24h_cap,
            "24h rolling cap reached, skipping funding cycle"
        );
        return Ok(());
    }

    let funding_amount = delta.min(per_tx_cap).min(remaining_budget.clone());

    let funding_amount_u256 = bigdecimal_to_u256(&funding_amount)?;

    let capital_wallet: Address = settings
        .capital_wallet_address
        .parse()
        .context("invalid capital_wallet_address")?;

    let balance = signer
        .usdc_balance_of(capital_wallet)
        .await
        .context("failed to read USDC balance")?;

    if balance < funding_amount_u256 {
        tracing::warn!(
            balance = %balance,
            needed = %funding_amount_u256,
            "insufficient USDC in capital wallet, skipping funding cycle"
        );
        return Ok(());
    }

    let wq_address: Address = settings.wq_address.parse().context("invalid wq_address")?;

    tracing::info!(amount = %funding_amount_u256, "approving USDC for withdrawal queue");
    signer
        .approve_usdc(wq_address, funding_amount_u256)
        .await
        .context("approve tx failed")?;

    tracing::info!(amount = %funding_amount_u256, "funding withdrawals");
    let tx_hash = signer
        .fund_withdrawals(funding_amount_u256, capital_wallet)
        .await
        .context("fundWithdrawals tx failed")?;

    funding_repo
        .insert_funding(settings.chain_id, &funding_amount, &format!("{tx_hash:?}"))
        .await
        .context("failed to record funding in DB")?;

    tracing::info!(
        amount = %funding_amount,
        tx = ?tx_hash,
        "withdrawal funding completed"
    );

    Ok(())
}

pub fn bigdecimal_to_u256(bd: &BigDecimal) -> Result<U256> {
    let s = bd.to_string();
    // BigDecimal may produce decimal notation; strip any fractional part (should be 0 for USDC)
    let int_str = s.split('.').next().unwrap_or(&s);
    U256::from_str(int_str).context("failed to convert BigDecimal to U256")
}
