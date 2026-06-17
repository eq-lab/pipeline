/// Generic Soroban ScVal decoders shared across Stellar jobs.
///
/// Promoted from `indexer/stellar/parsers.rs` (Issue #568) into the shared
/// `stellar/` module so the price-poller and future jobs can decode ScVal
/// return values without importing from the indexer's job-namespaced module.
///
/// Indexer-specific log-shape parsers (e.g. `parse_vault_deposit`) remain in
/// `indexer/stellar/parsers.rs` — only the generic protocol-level decoders live here.
use stellar_xdr::curr::{Limits, ReadXdr, ScVal};

/// Decode a base64-encoded XDR `ScVal::I128` into an `i128`.
pub fn extract_i128(b64: &str) -> Option<i128> {
    let val = ScVal::from_xdr_base64(b64, Limits::none()).ok()?;
    match val {
        ScVal::I128(parts) => Some(i128_from_parts(parts.hi, parts.lo)),
        _ => None,
    }
}

fn i128_from_parts(hi: i64, lo: u64) -> i128 {
    ((hi as i128) << 64) | (lo as i128)
}
