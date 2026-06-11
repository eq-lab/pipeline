//! Multi-chain env-var parsing primitives.
//!
//! Both the API and the worker read `CHAINS=<csv>` and `DEFAULT_CHAIN_ID=<id>`
//! at startup. The per-chain config beyond those two values is crate-specific
//! (voucher signers in the API, RPC URLs / contract addresses in the worker),
//! so each crate carries its own settings struct. The shared primitives here are
//! used by both crates.

use std::env;

use anyhow::{Context, Result};

// ─── Chain-kind discriminator ─────────────────────────────────────────────────

/// Discriminator for per-chain type.
///
/// EVM is the implicit default when `CHAIN_<id>_TYPE` is unset or set to `"evm"`.
/// Stellar is set when `CHAIN_<id>_TYPE=stellar`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChainKind {
    Evm,
    Stellar,
}

/// Read `CHAIN_<id>_TYPE` and return the discriminator.
/// Defaults to `Evm` when unset. Returns `Err` for unknown values.
pub fn parse_chain_type(chain_id: i64) -> Result<ChainKind> {
    let key = format!("CHAIN_{chain_id}_TYPE");
    match env::var(&key).as_deref() {
        Ok("stellar") => Ok(ChainKind::Stellar),
        Ok("evm") | Err(_) => Ok(ChainKind::Evm),
        Ok(v) => anyhow::bail!("{key} must be 'evm' or 'stellar', got '{v}'"),
    }
}

/// Parse `CHAINS` env var as a comma-separated list of `i64` chain IDs.
/// Errors if the var is unset, empty, or contains a non-integer entry.
pub fn parse_chains_env() -> Result<Vec<i64>> {
    let raw =
        env::var("CHAINS").context("CHAINS env var is required (comma-separated chain IDs)")?;
    let ids: Vec<i64> = raw
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.parse::<i64>()
                .with_context(|| format!("CHAINS: invalid chain id '{s}'"))
        })
        .collect::<Result<_>>()?;
    if ids.is_empty() {
        anyhow::bail!("CHAINS must not be empty");
    }
    Ok(ids)
}

/// Parse `DEFAULT_CHAIN_ID` and verify it is a member of `chains`.
/// `chains` is typically the result of `parse_chains_env()`.
pub fn parse_default_chain_id(chains: &[i64]) -> Result<i64> {
    let default_chain_id: i64 = env::var("DEFAULT_CHAIN_ID")
        .context("DEFAULT_CHAIN_ID env var is required")?
        .parse()
        .context("DEFAULT_CHAIN_ID must be a valid integer")?;

    if !chains.contains(&default_chain_id) {
        anyhow::bail!("DEFAULT_CHAIN_ID={default_chain_id} is not a member of CHAINS={chains:?}");
    }

    Ok(default_chain_id)
}
