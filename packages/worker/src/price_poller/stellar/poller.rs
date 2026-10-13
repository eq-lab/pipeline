// spec: docs/superpowers/specs/2026-10-12-multi-chain-price-poller-design.md#vault-source-settings-mirrored-into-vaults
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use stellar_strkey::{ed25519::PublicKey as Ed25519Pub, Contract};
use stellar_xdr::curr::{Int128Parts, Limits, ReadXdr, ScVal};

use crate::indexer::stellar::rpc::StellarRpc;
use crate::stellar::scval::{scval_contract, scval_u32};
use crate::stellar::tx::{build_invoke_envelope, envelope_to_base64};

pub struct SamplePoint {
    pub ledger_seq: i64,
    pub ledger_close_time: DateTime<Utc>,
    pub normalized_price: BigDecimal,
}

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

    async fn simulate_view(
        &self,
        contract: &Contract,
        function: &str,
        args: Vec<ScVal>,
    ) -> Result<(ScVal, u64)> {
        let dummy_source = Ed25519Pub([0u8; 32]);

        let envelope =
            build_invoke_envelope(&dummy_source, 0, 0, contract, function, args, vec![], None);
        let envelope_b64 = envelope_to_base64(&envelope)?;

        let sim = self.rpc.simulate_transaction(&envelope_b64).await?;

        if let Some(err) = &sim.error {
            anyhow::bail!("simulateTransaction error: {err}");
        }

        let first = sim
            .results
            .first()
            .context("simulateTransaction returned empty results")?;

        let xdr_bytes = STANDARD
            .decode(first.return_value_xdr_base64.as_bytes())
            .context("decode return_value_xdr_base64")?;
        let val = ScVal::from_xdr(xdr_bytes.as_slice(), Limits::none())
            .context("decode ScVal from return value XDR")?;

        Ok((val, sim.latest_ledger))
    }

    pub async fn fetch_decimals(&self, contract: &Contract) -> Result<u32> {
        let (val, _) = self.simulate_view(contract, "decimals", vec![]).await?;
        scval_u32(&val).context("expected ScVal::U32 return value from decimals")
    }

    pub async fn fetch_asset(&self, vault: &Contract) -> Result<Contract> {
        let (val, _) = self.simulate_view(vault, "query_asset", vec![]).await?;
        scval_contract(&val).context("expected contract ScVal::Address from query_asset")
    }

    pub async fn fetch_share_price(
        &self,
        vault_id: &Contract,
        share_decimals: i16,
        asset_decimals: i16,
    ) -> Result<SamplePoint> {
        let shares: i128 = 10i128
            .checked_pow(share_decimals as u32)
            .with_context(|| format!("10^{share_decimals} overflows i128"))?;

        let hi = (shares >> 64) as i64;
        let lo = shares as u64;
        let shares_scval = ScVal::I128(Int128Parts { hi, lo });

        let (raw_val, latest_ledger) = self
            .simulate_view(vault_id, "convert_to_assets", vec![shares_scval])
            .await?;

        let raw_i128 = match raw_val {
            ScVal::I128(parts) => {
                let hi = parts.hi as i128;
                let lo = parts.lo as i128;
                (hi << 64) | lo
            }
            _ => anyhow::bail!("expected ScVal::I128 return value from convert_to_assets"),
        };

        let scale = BigDecimal::from(
            10i128
                .checked_pow(asset_decimals as u32)
                .with_context(|| format!("10^{asset_decimals} overflows i128"))?,
        );
        let normalized_price = BigDecimal::from(raw_i128) / scale;

        let ledger_seq = i64::try_from(latest_ledger).context("latest_ledger overflows i64")?;

        Ok(SamplePoint {
            ledger_seq,
            ledger_close_time: Utc::now(),
            normalized_price,
        })
    }
}
