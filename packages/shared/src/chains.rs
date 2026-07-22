//! Multi-chain env-var parsing primitives.
//!
//! Both the API and the worker read `CHAINS=<csv>` and `DEFAULT_CHAIN_ID=<id>`
//! at startup. The per-chain config beyond those two values is crate-specific
//! (voucher signers in the API, RPC URLs / contract addresses in the worker),
//! so each crate carries its own settings struct. The shared primitives here are
//! used by both crates.

use std::env;

use anyhow::{Context, Result};
use bigdecimal::{BigDecimal, RoundingMode};

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

/// Normalize a USDC-denominated amount for **display/API use only**.
///
/// `contract_logs` always stores the raw value exactly as read from the chain —
/// this is never applied at indexer write/carry-forward time, only when a repo
/// method reads data back out for an API consumer. EVM's on-chain `uint256`
/// monetary fields are already 6-decimal by the EVM contract's own convention, so
/// `Evm` is a no-op. Stellar's Soroban contracts (LoanRegistry, DepositManager,
/// WithdrawalQueue, YieldMinter) store monetary fields at the native USDC-SAC scale
/// (7 decimals) — confirmed cross-repo against `pipeline-stellar-contracts`, see
/// issue #901 — so `Stellar` divides by `10^(7-6)`.
///
/// Truncated (not rounded) to a whole base-6 unit — `BigDecimal` division does not
/// floor on its own (`123456789 / 10 = 12345678.9`, not `12345678`), and every raw
/// on-chain amount is a whole integer at its native scale, so the result must be
/// too, matching `base6_to_decimal_string`'s own `RoundingMode::Down` and the
/// integer division EVM's `uint256` fields get "for free". Discovered via code
/// review after the initial version left the fractional remainder in place.
pub fn normalize_usdc_amount(kind: ChainKind, amount: &BigDecimal) -> BigDecimal {
    match kind {
        ChainKind::Evm => amount.clone(),
        ChainKind::Stellar => {
            (amount / BigDecimal::from(10)).with_scale_round(0, RoundingMode::Down)
        }
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

/// Normalize and validate a Stellar contract-id env var (a `C…` Strkey).
pub fn validate_contract_id(key: &str, raw: String) -> Result<String> {
    let upper = validate_strkey(key, raw, &['C'])?;
    Ok(upper)
}

/// Normalize and validate a Stellar address env var that may be either an
/// account (`G…`) or a contract (`C…`) Strkey.
///
/// Used for custody/ramp address lists, where transfers can move between
/// end-user accounts (`G…`) and contracts (`C…`). Uppercases and enforces the
/// 56-char base32 Strkey shape; accepts a leading `G` or `C`.
pub fn validate_stellar_address(key: &str, raw: String) -> Result<String> {
    validate_strkey(key, raw, &['G', 'C'])
}

/// Shared Strkey normalizer: uppercases `raw`, enforces the 56-char base32
/// alphabet, and requires the first character to be one of `allowed_prefixes`.
fn validate_strkey(key: &str, mut raw: String, allowed_prefixes: &[char]) -> Result<String> {
    raw.make_ascii_uppercase();
    let upper = raw;
    if upper.len() != 56 {
        anyhow::bail!(
            "{key} must be a 56-char Stellar Strkey, got {} chars",
            upper.len()
        );
    }
    if !allowed_prefixes.iter().any(|p| upper.starts_with(*p)) {
        let prefixes: String = allowed_prefixes
            .iter()
            .map(|p| format!("'{p}'"))
            .collect::<Vec<_>>()
            .join(" or ");
        anyhow::bail!("{key} must be a Stellar Strkey that starts with {prefixes}");
    }
    if !upper
        .bytes()
        .all(|b| matches!(b, b'A'..=b'Z' | b'2'..=b'7'))
    {
        anyhow::bail!("{key} contains characters outside the Strkey base32 alphabet (A-Z, 2-7)");
    }
    Ok(upper)
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
