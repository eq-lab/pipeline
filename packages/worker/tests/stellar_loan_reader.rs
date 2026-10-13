/// Unit tests for `StellarLoanRegistryReader` ScVal → view-struct decoders.
///
/// Tests exercise `decode_immutable_loan_data`, `decode_mutable_loan_data`,
/// and `decode_cumulative_repayment_data` — pure ScVal → Rust functions,
/// no live RPC, no DB.
///
/// Fixtures use the current `ImmutableLoanData`/`MutableLoanData` key set from
/// `pipeline-stellar-contracts/contracts/loan-registry/src/types.rs` (#1433), not the
/// pre-rework `ccr`/`current_location`/`last_reported_ccr_timestamp` shape.
use alloy::primitives::{FixedBytes, I256, U256};
use pipeline_worker::indexer::loan_mapper::loan_status_name;
use pipeline_worker::indexer::stellar::loan_registry_reader::{
    decode_cumulative_repayment_data, decode_immutable_loan_data, decode_mutable_loan_data,
};
use stellar_xdr::curr::{
    Int128Parts, ScBytes, ScMap, ScMapEntry, ScString, ScSymbol, ScVal, ScVec, StringM,
    UInt128Parts, VecM,
};

// ── ScVal encode helpers ──────────────────────────────────────────────────────

fn sym(s: &str) -> ScVal {
    let inner: StringM<32> = s.try_into().unwrap();
    ScVal::Symbol(ScSymbol(inner))
}

fn u32_val(v: u32) -> ScVal {
    ScVal::U32(v)
}

fn u64_val(v: u64) -> ScVal {
    ScVal::U64(v)
}

fn u128_val(v: u128) -> ScVal {
    ScVal::U128(UInt128Parts {
        hi: (v >> 64) as u64,
        lo: (v & 0xFFFF_FFFF_FFFF_FFFF) as u64,
    })
}

fn i128_val(v: i128) -> ScVal {
    ScVal::I128(Int128Parts {
        hi: (v >> 64) as i64,
        lo: (v & 0xFFFF_FFFF_FFFF_FFFF) as u64,
    })
}

fn bool_val(v: bool) -> ScVal {
    ScVal::Bool(v)
}

fn bytes32_val(bytes: [u8; 32]) -> ScVal {
    ScVal::Bytes(ScBytes(bytes.to_vec().try_into().unwrap()))
}

fn string_val(s: &str) -> ScVal {
    let inner: StringM<{ u32::MAX }> = s.try_into().unwrap();
    ScVal::String(ScString(inner))
}

fn enum_variant(variant: &str) -> ScVal {
    let inner: StringM<32> = variant.try_into().unwrap();
    let vec: VecM<ScVal> = vec![ScVal::Symbol(ScSymbol(inner))].try_into().unwrap();
    ScVal::Vec(Some(ScVec(vec)))
}

fn make_map(entries: Vec<(&str, ScVal)>) -> ScVal {
    let mut sorted = entries;
    sorted.sort_by_key(|(k, _)| k.to_string());
    let map_entries: Vec<ScMapEntry> = sorted
        .into_iter()
        .map(|(k, v)| ScMapEntry {
            key: sym(k),
            val: v,
        })
        .collect();
    let vm: VecM<ScMapEntry> = map_entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(vm)))
}

const BORROWER_REF: [u8; 32] = [
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
    0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
];

fn immutable_loan_data_map(borrower_ref: [u8; 32]) -> ScVal {
    make_map(vec![
        ("borrower_ref", bytes32_val(borrower_ref)),
        (
            "original_facility_size",
            u128_val(10_000_000_000_000_000_000),
        ),
        (
            "original_senior_tranche",
            u128_val(8_000_000_000_000_000_000),
        ),
        (
            "original_equity_tranche",
            u128_val(2_000_000_000_000_000_000),
        ),
        ("original_offtaker_price", u128_val(500_000_000_000)),
        // Soroban-units (fraction of ONE=1_000_000). 100_000 = 10%.
        ("senior_interest_rate", u32_val(100_000)),
        ("origination_date", u64_val(1_700_000_000)),
        ("original_maturity_date", u64_val(1_731_600_000)),
    ])
}

// ── decode_immutable_loan_data ────────────────────────────────────────────────

#[test]
fn decode_immutable_loan_data_happy_path() {
    let scval = immutable_loan_data_map(BORROWER_REF);

    let view = decode_immutable_loan_data(&scval).expect("should decode ImmutableLoanData");

    assert_eq!(
        view.borrower_ref,
        Some(FixedBytes::<32>::from(BORROWER_REF))
    );
    assert_eq!(
        view.original_facility_size,
        U256::from(10_000_000_000_000_000_000_u128)
    );
    // Decoder converts Soroban-units → bps (1 bp = 1/10_000).
    // 100_000 / 100 = 1_000 bps = 10%.
    assert_eq!(view.senior_interest_rate_bps, 1_000);
    assert_eq!(view.origination_date, 1_700_000_000);
    assert_eq!(view.original_maturity_date, 1_731_600_000);
}

#[test]
fn decode_immutable_loan_data_all_zero_borrower_ref_is_some_zero() {
    // An all-zero on-chain BytesN<32> is a legitimate value, distinct from "not decoded".
    let scval = immutable_loan_data_map([0u8; 32]);
    let view = decode_immutable_loan_data(&scval).expect("should decode");
    assert_eq!(view.borrower_ref, Some(FixedBytes::<32>::ZERO));
}

#[test]
fn decode_immutable_loan_data_rejects_missing_borrower_ref() {
    let scval = make_map(vec![
        ("original_facility_size", u128_val(1)),
        ("original_senior_tranche", u128_val(1)),
        ("original_equity_tranche", u128_val(1)),
        ("original_offtaker_price", u128_val(1)),
        ("senior_interest_rate", u32_val(1)),
        ("origination_date", u64_val(1)),
        ("original_maturity_date", u64_val(1)),
    ]);
    assert!(decode_immutable_loan_data(&scval).is_err());
}

#[test]
fn decode_immutable_loan_data_rejects_non_map() {
    let not_a_map = ScVal::U32(42);
    let result = decode_immutable_loan_data(&not_a_map);
    assert!(result.is_err(), "non-map ScVal should produce an error");
}

// ── decode_mutable_loan_data ──────────────────────────────────────────────────

/// Build the current `MutableLoanData` key set with every field parameterized.
#[allow(clippy::too_many_arguments)]
fn mutable_loan_data_map(
    current_rate_raw: u32,
    carved_out: bool,
    disbursed: u128,
    repaid: u128,
    written_down: u128,
    interest_adjustment: i128,
    status: &str,
    closure_reason: &str,
) -> ScVal {
    make_map(vec![
        ("next_economics_epochs_id", u32_val(1)),
        ("next_repayment_id", u32_val(2)),
        ("status", enum_variant(status)),
        ("current_maturity_timestamp", u64_val(1_731_600_000)),
        ("current_rate", u32_val(current_rate_raw)),
        ("closure_reason", enum_variant(closure_reason)),
        ("metadata_uri", string_val("ipfs://QmAbc")),
        ("disbursed", u128_val(disbursed)),
        ("repaid", u128_val(repaid)),
        ("written_down", u128_val(written_down)),
        ("carved_out", bool_val(carved_out)),
        ("interest_adjustment", i128_val(interest_adjustment)),
    ])
}

#[test]
fn decode_mutable_loan_data_happy_path() {
    let scval = mutable_loan_data_map(
        100_000, // Soroban-units: ONE=1_000_000 scale. 100_000 = 10%.
        true,
        5_000_000_000,
        1_000_000_000,
        0,
        0,
        "Performing",
        "None",
    );

    let view = decode_mutable_loan_data(&scval).expect("should decode MutableLoanData");

    assert_eq!(view.status, 1); // 1 = Performing
    assert_eq!(view.closure_reason, 0); // 0 = None
    assert_eq!(view.next_economics_epochs_id, U256::from(1u32));
    assert_eq!(view.next_repayment_id, U256::from(2u32));
    assert_eq!(view.metadata_uri, "ipfs://QmAbc");
    // Decoder converts Soroban-units → bps: 100_000 / 100 = 1_000 bps = 10%.
    assert_eq!(view.current_rate, 1_000);
    assert!(view.carved_out);
    assert_eq!(view.disbursed, U256::from(5_000_000_000_u128));
    assert_eq!(view.repaid, U256::from(1_000_000_000_u128));
    assert_eq!(view.written_down, U256::ZERO);
    assert_eq!(view.interest_adjustment, I256::ZERO);
}

#[test]
fn decode_mutable_loan_data_negative_interest_adjustment() {
    // Negative = waiver (R3): a sign-extension bug here is silent.
    let scval = mutable_loan_data_map(0, false, 0, 0, 0, -1_500_000, "Performing", "None");
    let view = decode_mutable_loan_data(&scval).expect("should decode");
    assert_eq!(
        view.interest_adjustment,
        I256::try_from(-1_500_000i128).unwrap()
    );
}

#[test]
fn decode_mutable_loan_data_closed_status() {
    let scval = mutable_loan_data_map(0, false, 0, 0, 0, 0, "Closed", "ScheduledMaturity");
    let view = decode_mutable_loan_data(&scval).expect("should decode Closed status");
    assert_eq!(view.status, 4); // 4 = Closed
    assert_eq!(view.closure_reason, 1); // 1 = ScheduledMaturity
}

#[test]
fn decode_mutable_loan_data_approved_status() {
    let scval = mutable_loan_data_map(0, false, 0, 0, 0, 0, "Approved", "None");
    let view = decode_mutable_loan_data(&scval).expect("should decode Approved status");
    assert_eq!(view.status, 0); // 0 = Approved
}

#[test]
fn decode_mutable_loan_data_cancelled_closure_reason() {
    let scval = mutable_loan_data_map(0, false, 0, 0, 0, 0, "Closed", "Cancelled");
    let view = decode_mutable_loan_data(&scval).expect("should decode Cancelled closure_reason");
    assert_eq!(view.closure_reason, 3); // 3 = Cancelled
}

#[test]
fn decode_then_name_performing_is_not_approved() {
    let scval = mutable_loan_data_map(0, false, 0, 0, 0, 0, "Performing", "None");
    let view = decode_mutable_loan_data(&scval).expect("should decode Performing status");
    assert_eq!(loan_status_name(view.status), "Performing");
    assert_ne!(loan_status_name(view.status), "Approved");
}

#[test]
fn decode_mutable_loan_data_rejects_missing_current_rate() {
    let scval = make_map(vec![
        ("next_economics_epochs_id", u32_val(0)),
        ("next_repayment_id", u32_val(0)),
        ("status", enum_variant("Approved")),
        ("current_maturity_timestamp", u64_val(0)),
        ("closure_reason", enum_variant("None")),
        ("metadata_uri", string_val("ipfs://Q")),
        ("disbursed", u128_val(0)),
        ("repaid", u128_val(0)),
        ("written_down", u128_val(0)),
        ("carved_out", bool_val(false)),
        ("interest_adjustment", i128_val(0)),
        // current_rate omitted
    ]);
    assert!(decode_mutable_loan_data(&scval).is_err());
}

#[test]
fn decode_mutable_loan_data_rejects_missing_carved_out() {
    let scval = make_map(vec![
        ("next_economics_epochs_id", u32_val(0)),
        ("next_repayment_id", u32_val(0)),
        ("status", enum_variant("Approved")),
        ("current_maturity_timestamp", u64_val(0)),
        ("current_rate", u32_val(0)),
        ("closure_reason", enum_variant("None")),
        ("metadata_uri", string_val("ipfs://Q")),
        ("disbursed", u128_val(0)),
        ("repaid", u128_val(0)),
        ("written_down", u128_val(0)),
        ("interest_adjustment", i128_val(0)),
        // carved_out omitted
    ]);
    assert!(decode_mutable_loan_data(&scval).is_err());
}

#[test]
fn decode_mutable_loan_data_rejects_missing_interest_adjustment() {
    let scval = make_map(vec![
        ("next_economics_epochs_id", u32_val(0)),
        ("next_repayment_id", u32_val(0)),
        ("status", enum_variant("Approved")),
        ("current_maturity_timestamp", u64_val(0)),
        ("current_rate", u32_val(0)),
        ("closure_reason", enum_variant("None")),
        ("metadata_uri", string_val("ipfs://Q")),
        ("disbursed", u128_val(0)),
        ("repaid", u128_val(0)),
        ("written_down", u128_val(0)),
        ("carved_out", bool_val(false)),
        // interest_adjustment omitted
    ]);
    assert!(decode_mutable_loan_data(&scval).is_err());
}

// ── decode_cumulative_repayment_data ──────────────────────────────────────────

#[test]
fn decode_cumulative_repayment_data_happy_path() {
    let scval = make_map(vec![
        ("equity_distributed", u128_val(40)),
        ("mgmt_fee", u128_val(50)),
        ("oet_alloc", u128_val(70)),
        ("offtaker_received", u128_val(10)),
        ("perf_fee", u128_val(60)),
        ("senior_interest", u128_val(30)),
        ("senior_principal_repaid", u128_val(20)),
    ]);

    let view = decode_cumulative_repayment_data(&scval).expect("should decode RepaymentData");

    assert_eq!(view.offtaker_received, U256::from(10u128));
    assert_eq!(view.senior_principal_repaid, U256::from(20u128));
    assert_eq!(view.senior_interest, U256::from(30u128));
    assert_eq!(view.equity_distributed, U256::from(40u128));
    assert_eq!(view.mgmt_fee, U256::from(50u128));
    assert_eq!(view.perf_fee, U256::from(60u128));
    assert_eq!(view.oet_alloc, U256::from(70u128));
}

#[test]
fn decode_cumulative_repayment_data_u128_max() {
    let max = u128::MAX;
    let scval = make_map(vec![
        ("equity_distributed", u128_val(max)),
        ("mgmt_fee", u128_val(max)),
        ("oet_alloc", u128_val(max)),
        ("offtaker_received", u128_val(max)),
        ("perf_fee", u128_val(max)),
        ("senior_interest", u128_val(max)),
        ("senior_principal_repaid", u128_val(max)),
    ]);

    let view =
        decode_cumulative_repayment_data(&scval).expect("should decode u128::MAX repayment data");

    assert_eq!(view.offtaker_received, U256::from(u128::MAX));
}
