//! Shared decoders for Soroban `simulateTransaction` response fields.
//!
//! Extracted from `whitelist.rs` so the whitelist and yield-mint phases share
//! one implementation (avoids drift).

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use stellar_xdr::curr::{Limits, ReadXdr, SorobanAuthorizationEntry, SorobanTransactionData};

use crate::indexer::stellar::rpc::SimulateResult;

pub fn decode_soroban_data(b64: &str) -> Result<SorobanTransactionData> {
    let bytes = STANDARD
        .decode(b64.as_bytes())
        .context("decode SorobanTransactionData base64")?;
    SorobanTransactionData::from_xdr(bytes.as_slice(), Limits::none())
        .context("decode SorobanTransactionData XDR")
}

pub fn decode_auth_entries(results: &[SimulateResult]) -> Result<Vec<SorobanAuthorizationEntry>> {
    let mut out = Vec::new();
    for r in results {
        for entry_b64 in &r.auth_xdr_base64 {
            let bytes = STANDARD
                .decode(entry_b64.as_bytes())
                .context("decode SorobanAuthorizationEntry base64")?;
            let entry = SorobanAuthorizationEntry::from_xdr(bytes.as_slice(), Limits::none())
                .context("decode SorobanAuthorizationEntry XDR")?;
            out.push(entry);
        }
    }
    Ok(out)
}
