/// `StellarPricePoller` — samples `convert_to_assets(1 share)` via `simulateTransaction`.
///
/// Uses the shared `crate::stellar::tx::build_invoke_envelope` to construct a
/// view-only invocation envelope (dummy source account, seq_num = 0, fee = 0,
/// no auth entries, no soroban_data).  The result is decoded via
/// `crate::stellar::scval::extract_i128` and normalized to a `BigDecimal`.
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use stellar_strkey::{ed25519::PublicKey as Ed25519Pub, Contract};
use stellar_xdr::curr::{Int128Parts, Limits, ReadXdr, ScVal};

use crate::indexer::stellar::rpc::StellarRpc;
use crate::stellar::tx::{build_invoke_envelope, envelope_to_base64};

/// A single share-price sample returned by `StellarPricePoller::fetch_share_price`.
pub struct SamplePoint {
    /// Current ledger sequence at the time of the simulate call (maps to `block_number`).
    pub ledger_seq: i64,
    /// Sample timestamp — `Utc::now()` at the time of the RPC call.
    ///
    /// Note: `simulateTransaction` returns the latest-ledger sequence but not its
    /// close-time. Using `Utc::now()` introduces at most `poll_interval_secs` skew
    /// relative to the actual ledger close-time. TD-18 tracks the canonical-close-time
    /// follow-up.
    pub ledger_close_time: DateTime<Utc>,
    /// Normalized share price: `convert_to_assets(1 share) / 10^asset_decimals`.
    pub normalized_price: BigDecimal,
}

/// Soroban share-price sampler.
pub struct StellarPricePoller {
    pub rpc: StellarRpc,
    pub network_passphrase: String,
}

impl StellarPricePoller {
    pub fn new(rpc_url: &str, network_passphrase: String) -> Self {
        Self {
            rpc: StellarRpc::new(rpc_url),
            network_passphrase,
        }
    }

    /// Sample `vault_id.convert_to_assets(10^share_decimals)` at the current ledger.
    ///
    /// Uses a dummy all-zero source account (`Ed25519Pub([0u8; 32])`), `seq_num = 0`,
    /// and `fee = 0` — all safe for `simulateTransaction` which does not validate or
    /// charge the source account.
    pub async fn fetch_share_price(
        &self,
        vault_id: &Contract,
        share_decimals: i16,
        asset_decimals: i16,
    ) -> Result<SamplePoint> {
        // shares = 10^share_decimals as i128.
        let shares: i128 = 10i128
            .checked_pow(share_decimals as u32)
            .with_context(|| format!("10^{share_decimals} overflows i128"))?;

        // Encode the i128 as ScVal::I128 with the correct hi/lo parts.
        let hi = (shares >> 64) as i64;
        let lo = shares as u64;
        let shares_scval = ScVal::I128(Int128Parts { hi, lo });

        // Dummy source account — all-zero pubkey is safe for simulate-only calls.
        let dummy_source = Ed25519Pub([0u8; 32]);

        let envelope = build_invoke_envelope(
            &dummy_source,
            0, // seq_num = 0
            0, // fee = 0
            vault_id,
            "convert_to_assets",
            vec![shares_scval],
            vec![], // no auth entries
            None,   // no soroban_data
        );
        let envelope_b64 = envelope_to_base64(&envelope)?;

        let sim = self.rpc.simulate_transaction(&envelope_b64).await?;

        if let Some(err) = &sim.error {
            anyhow::bail!("simulateTransaction error: {err}");
        }

        let first = sim
            .results
            .first()
            .context("simulateTransaction returned empty results")?;

        // Decode return value: expected ScVal::I128.
        let xdr_bytes = STANDARD
            .decode(first.return_value_xdr_base64.as_bytes())
            .context("decode return_value_xdr_base64")?;
        let raw_val = ScVal::from_xdr(xdr_bytes.as_slice(), Limits::none())
            .context("decode ScVal from return value XDR")?;

        let raw_i128 = match raw_val {
            ScVal::I128(parts) => {
                let hi = parts.hi as i128;
                let lo = parts.lo as i128;
                (hi << 64) | lo
            }
            _ => anyhow::bail!("expected ScVal::I128 return value from convert_to_assets"),
        };

        // Normalize: raw / 10^asset_decimals — mirrors EVM path at price_poller/mod.rs:71-76.
        let scale = BigDecimal::from(
            10i128
                .checked_pow(asset_decimals as u32)
                .with_context(|| format!("10^{asset_decimals} overflows i128"))?,
        );
        let normalized_price = BigDecimal::from(raw_i128) / scale;

        let ledger_seq = i64::try_from(sim.latest_ledger).context("latest_ledger overflows i64")?;

        Ok(SamplePoint {
            ledger_seq,
            ledger_close_time: Utc::now(),
            normalized_price,
        })
    }
}
