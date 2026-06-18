/// Stellar/Soroban resolver for on-chain `LoanRegistry` view functions.
///
/// Provides `StellarAddress` (a Strkey-encoded `C…` contract ID newtype) and
/// `StellarLoanRegistryReader` which issues `simulateTransaction` view calls against
/// `immutable_loan_data`, `mutable_loan_data`, and `cumulative_repayment_data`.
///
/// The `impl ImmutableDataResolver<StellarAddress, u32>` and
/// `impl MutableDataResolver<StellarAddress, u32>` blocks are added in Step 5b
/// after the traits are genericised in `loan_metadata.rs`.
///
/// `BlockHint` is accepted but ignored — Soroban `simulateTransaction` is
/// current-state-only (see TD-19 for the ledger-pinned follow-up).
use std::sync::Arc;

use anyhow::{Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine};
use stellar_strkey::ed25519::PublicKey as Ed25519Pub;
use stellar_strkey::Contract as ContractStrkey;
use stellar_xdr::curr::{Limits, ReadXdr, ScVal};

use crate::indexer::loan_metadata::{
    BlockHint, ImmutableDataResolver, ImmutableLoanDataView, LoanAddress, LocationType,
    LocationUpdateView, MutableDataResolver, MutableLoanDataView, RepaymentDataView,
};
use crate::indexer::stellar::rpc::StellarRpc;
use crate::stellar::tx::{build_invoke_envelope, envelope_to_base64};

// ── StellarAddress ────────────────────────────────────────────────────────────

/// Newtype wrapping a Strkey-encoded Stellar contract ID (`C…` form).
///
/// Implements `LoanAddress` so `LoanEventMapper<StellarAddress, u32>` can store the
/// contract address without coupling to alloy's `Address` type.
#[derive(Clone, Debug)]
pub struct StellarAddress(pub String);

impl LoanAddress for StellarAddress {
    fn as_db_string(&self) -> String {
        self.0.clone()
    }
}

// ── StellarLoanRegistryReader ─────────────────────────────────────────────────

/// Issues Soroban `simulateTransaction` view calls against LoanRegistry view functions.
///
/// Wraps `StellarRpc`. Each call constructs a dummy-source, zero-fee envelope (safe for
/// simulate-only calls per Soroban RPC spec — no signing or account sequence required).
pub struct StellarLoanRegistryReader {
    rpc: Arc<StellarRpc>,
}

impl StellarLoanRegistryReader {
    pub fn new(rpc: Arc<StellarRpc>) -> Self {
        Self { rpc }
    }

    /// Build and simulate an invocation of a LoanRegistry view function with a single
    /// `loan_id: u32` argument.  Returns the `ScVal` return value.
    ///
    /// Envelope shape mirrors `StellarPricePoller::fetch_share_price` (#568):
    /// - Dummy all-zero `Ed25519Pub([0u8; 32])` source account (simulate-only).
    /// - `seq_num = 0`, `fee = 0`.
    /// - Single arg `ScVal::U32(loan_id)`.
    /// - No auth entries, no soroban_data.
    pub(crate) async fn call_view(
        &self,
        contract_id: &str,
        fn_name: &str,
        loan_id: u32,
    ) -> Result<ScVal> {
        let contract = ContractStrkey::from_string(contract_id).with_context(|| {
            format!("StellarLoanRegistryReader: invalid contract id {contract_id}")
        })?;

        let dummy_source = Ed25519Pub([0u8; 32]);
        let args = vec![ScVal::U32(loan_id)];

        let envelope = build_invoke_envelope(
            &dummy_source,
            0, // seq_num
            0, // fee
            &contract,
            fn_name,
            args,
            vec![], // no auth entries
            None,   // no soroban_data
        );
        let envelope_b64 = envelope_to_base64(&envelope)?;

        let sim = self.rpc.simulate_transaction(&envelope_b64).await?;

        if let Some(err) = &sim.error {
            anyhow::bail!("simulateTransaction({fn_name}) error: {err}");
        }

        let first = sim
            .results
            .first()
            .context("simulateTransaction returned empty results")?;

        let xdr_bytes = STANDARD
            .decode(first.return_value_xdr_base64.as_bytes())
            .context("decode return_value_xdr_base64")?;
        ScVal::from_xdr(xdr_bytes.as_slice(), Limits::none())
            .context("decode ScVal from return value XDR")
    }
}

// ── Trait impls ───────────────────────────────────────────────────────────────

#[async_trait]
impl ImmutableDataResolver<StellarAddress, u32> for StellarLoanRegistryReader {
    async fn immutable_loan_data(
        &self,
        contract: &StellarAddress,
        loan_id: u32,
    ) -> Result<ImmutableLoanDataView> {
        let scval = self
            .call_view(&contract.0, "immutable_loan_data", loan_id)
            .await?;
        decode_immutable_loan_data(&scval)
    }
}

#[async_trait]
impl MutableDataResolver<StellarAddress, u32> for StellarLoanRegistryReader {
    async fn mutable_loan_data(
        &self,
        contract: &StellarAddress,
        loan_id: u32,
        _block: BlockHint,
    ) -> Result<MutableLoanDataView> {
        // `_block` is ignored — Soroban `simulateTransaction` is current-state-only.
        // See TD-19 for the ledger-pinned follow-up.
        let scval = self
            .call_view(&contract.0, "mutable_loan_data", loan_id)
            .await?;
        decode_mutable_loan_data(&scval)
    }

    async fn cumulative_repayment_data(
        &self,
        contract: &StellarAddress,
        loan_id: u32,
        _block: BlockHint,
    ) -> Result<RepaymentDataView> {
        let scval = self
            .call_view(&contract.0, "cumulative_repayment_data", loan_id)
            .await?;
        decode_cumulative_repayment_data(&scval)
    }
}

// ── Pure ScVal decoders (pub(crate) for unit tests) ───────────────────────────

/// Decode the `ImmutableLoanData` return value of `immutable_loan_data(loan_id)`.
///
/// On-chain `ImmutableLoanData` (Stellar) uses `u128` for monetary fields and `u64`
/// for timestamps. The view struct holds `alloy::primitives::U256`; we lift via
/// `U256::from(u128_value)`.
pub fn decode_immutable_loan_data(scval: &ScVal) -> Result<ImmutableLoanDataView> {
    use alloy::primitives::U256;

    let map = expect_map(scval, "ImmutableLoanData")?;
    let original_facility_size = U256::from(map_u128(
        &map,
        "original_facility_size",
        "ImmutableLoanData",
    )?);
    let original_senior_tranche = U256::from(map_u128(
        &map,
        "original_senior_tranche",
        "ImmutableLoanData",
    )?);
    let original_equity_tranche = U256::from(map_u128(
        &map,
        "original_equity_tranche",
        "ImmutableLoanData",
    )?);
    let original_offtaker_price = U256::from(map_u128(
        &map,
        "original_offtaker_price",
        "ImmutableLoanData",
    )?);
    let senior_interest_rate_bps = map_u32(&map, "senior_interest_rate", "ImmutableLoanData")?;
    let origination_date = map_u64(&map, "origination_date", "ImmutableLoanData")?;
    let original_maturity_date = map_u64(&map, "original_maturity_date", "ImmutableLoanData")?;

    Ok(ImmutableLoanDataView {
        original_facility_size,
        original_senior_tranche,
        original_equity_tranche,
        original_offtaker_price,
        senior_interest_rate_bps,
        origination_date,
        original_maturity_date,
    })
}

/// Decode the `MutableLoanData` return value of `mutable_loan_data(loan_id)`.
///
/// Stellar `MutableLoanData` uses `u32` for counter fields (unlike EVM's `U256`);
/// we lift via `U256::from(u32_value)`.
pub fn decode_mutable_loan_data(scval: &ScVal) -> Result<MutableLoanDataView> {
    use alloy::primitives::U256;

    let map = expect_map(scval, "MutableLoanData")?;
    let next_economics_epochs_id = U256::from(map_u32(
        &map,
        "next_economics_epochs_id",
        "MutableLoanData",
    )?);
    let next_repayment_id = U256::from(map_u32(&map, "next_repayment_id", "MutableLoanData")?);

    // `status` is a `LoanStatus` enum encoded as `ScVal::Vec([Symbol("Variant")])`.
    let status_variant = map_enum_variant(&map, "status", "MutableLoanData")?;
    let status: u8 = match status_variant.as_str() {
        "Performing" => 0,
        "WatchList" => 1,
        "Default" => 2,
        "Closed" => 3,
        other => anyhow::bail!("MutableLoanData.status: unknown variant '{other}'"),
    };

    let ccr_bps = map_u32(&map, "ccr", "MutableLoanData")?;
    let last_reported_ccr_timestamp =
        map_u64(&map, "last_reported_ccr_timestamp", "MutableLoanData")?;
    let current_maturity_timestamp =
        map_u64(&map, "current_maturity_timestamp", "MutableLoanData")?;

    // `closure_reason` is a `ClosureReason` enum.
    let cr_variant = map_enum_variant(&map, "closure_reason", "MutableLoanData")?;
    let closure_reason: u8 = match cr_variant.as_str() {
        "None" => 0,
        "ScheduledMaturity" => 1,
        "EarlyRepayment" => 2,
        "Default" => 3,
        "OtherWriteDown" => 4,
        other => anyhow::bail!("MutableLoanData.closure_reason: unknown variant '{other}'"),
    };

    let current_location = map_location_update(&map, "current_location")?;
    let metadata_uri = map_string(&map, "metadata_uri", "MutableLoanData")?;

    Ok(MutableLoanDataView {
        next_economics_epochs_id,
        next_repayment_id,
        status,
        ccr_bps,
        last_reported_ccr_timestamp,
        current_maturity_timestamp,
        closure_reason,
        current_location,
        metadata_uri,
    })
}

/// Decode the `RepaymentData` return value of `cumulative_repayment_data(loan_id)`.
///
/// Stellar `RepaymentData` is a flat struct with 7 × `u128` fields; lifted to `U256`.
pub fn decode_cumulative_repayment_data(scval: &ScVal) -> Result<RepaymentDataView> {
    use alloy::primitives::U256;

    let map = expect_map(scval, "RepaymentData")?;
    Ok(RepaymentDataView {
        offtaker_received: U256::from(map_u128(&map, "offtaker_received", "RepaymentData")?),
        senior_principal_repaid: U256::from(map_u128(
            &map,
            "senior_principal_repaid",
            "RepaymentData",
        )?),
        senior_interest: U256::from(map_u128(&map, "senior_interest", "RepaymentData")?),
        equity_distributed: U256::from(map_u128(&map, "equity_distributed", "RepaymentData")?),
        mgmt_fee: U256::from(map_u128(&map, "mgmt_fee", "RepaymentData")?),
        perf_fee: U256::from(map_u128(&map, "perf_fee", "RepaymentData")?),
        oet_alloc: U256::from(map_u128(&map, "oet_alloc", "RepaymentData")?),
    })
}

// ── Private decoder primitives ────────────────────────────────────────────────

type ScMapSlice = stellar_xdr::curr::ScMap;

fn expect_map(scval: &ScVal, ctx: &str) -> Result<ScMapSlice>
where
    ScMapSlice: Clone,
{
    match scval {
        ScVal::Map(Some(m)) => Ok(m.clone()),
        _ => anyhow::bail!("{ctx}: expected ScVal::Map, got {scval:?}"),
    }
}

fn map_entry<'a>(map: &'a ScMapSlice, key: &str) -> Option<&'a ScVal> {
    map.0.iter().find_map(|e| {
        if let ScVal::Symbol(sym) = &e.key {
            if sym.0.to_utf8_string_lossy() == key {
                return Some(&e.val);
            }
        }
        None
    })
}

fn map_u128(map: &ScMapSlice, key: &str, ctx: &str) -> Result<u128> {
    let entry = map_entry(map, key).ok_or_else(|| anyhow::anyhow!("{ctx}.{key}: field missing"))?;
    match entry {
        ScVal::U128(parts) => Ok(u128_from_hi_lo(parts.hi, parts.lo)),
        _ => anyhow::bail!("{ctx}.{key}: expected U128, got {entry:?}"),
    }
}

fn map_u64(map: &ScMapSlice, key: &str, ctx: &str) -> Result<u64> {
    let entry = map_entry(map, key).ok_or_else(|| anyhow::anyhow!("{ctx}.{key}: field missing"))?;
    match entry {
        ScVal::U64(v) => Ok(*v),
        _ => anyhow::bail!("{ctx}.{key}: expected U64, got {entry:?}"),
    }
}

fn map_u32(map: &ScMapSlice, key: &str, ctx: &str) -> Result<u32> {
    let entry = map_entry(map, key).ok_or_else(|| anyhow::anyhow!("{ctx}.{key}: field missing"))?;
    match entry {
        ScVal::U32(v) => Ok(*v),
        _ => anyhow::bail!("{ctx}.{key}: expected U32, got {entry:?}"),
    }
}

fn map_string(map: &ScMapSlice, key: &str, ctx: &str) -> Result<String> {
    let entry = map_entry(map, key).ok_or_else(|| anyhow::anyhow!("{ctx}.{key}: field missing"))?;
    match entry {
        ScVal::String(s) => Ok(s.to_utf8_string_lossy()),
        _ => anyhow::bail!("{ctx}.{key}: expected String, got {entry:?}"),
    }
}

/// Read a `#[contracttype]` unit-enum field encoded as `ScVal::Vec([Symbol("Variant")])`.
fn map_enum_variant(map: &ScMapSlice, key: &str, ctx: &str) -> Result<String> {
    let entry = map_entry(map, key).ok_or_else(|| anyhow::anyhow!("{ctx}.{key}: field missing"))?;
    match entry {
        ScVal::Vec(Some(vec_inner)) if vec_inner.0.len() == 1 => {
            if let ScVal::Symbol(sym) = &vec_inner.0[0] {
                Ok(sym.0.to_utf8_string_lossy())
            } else {
                anyhow::bail!("{ctx}.{key}: Vec[0] is not a Symbol")
            }
        }
        _ => anyhow::bail!("{ctx}.{key}: expected Vec([Symbol(...)]), got {entry:?}"),
    }
}

/// Decode a `LocationUpdate` struct from a map entry.
/// `LocationUpdate` is a `#[contracttype]` struct, encoded as a nested `ScVal::Map`.
fn map_location_update(map: &ScMapSlice, key: &str) -> Result<LocationUpdateView> {
    let entry = map_entry(map, key)
        .ok_or_else(|| anyhow::anyhow!("MutableLoanData.{key}: field missing"))?;
    let ScVal::Map(Some(loc_map)) = entry else {
        anyhow::bail!("MutableLoanData.{key}: expected nested Map");
    };

    // `location_type` is a `LocationType` enum encoded as `ScVal::Vec([Symbol(...)])`.
    let lt_variant = map_enum_variant(loc_map, "location_type", "LocationUpdate")?;
    let location_type = match lt_variant.as_str() {
        "Vessel" => LocationType::Vessel,
        "Warehouse" => LocationType::Warehouse,
        "TankFarm" => LocationType::TankFarm,
        _ => LocationType::Other,
    };

    let location_identifier = map_string(loc_map, "location_identifier", "LocationUpdate")?;
    let tracking_url = map_string(loc_map, "tracking_url", "LocationUpdate")?;
    let updated_at = map_u64(loc_map, "updated_at", "LocationUpdate")?;

    Ok(LocationUpdateView {
        location_type,
        location_identifier,
        tracking_url,
        updated_at,
    })
}

fn u128_from_hi_lo(hi: u64, lo: u64) -> u128 {
    ((hi as u128) << 64) | (lo as u128)
}
