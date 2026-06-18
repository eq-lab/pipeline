/// Unit tests for `StellarLoanRegistryReader` ScVal → view-struct decoders.
///
/// Tests exercise `decode_immutable_loan_data`, `decode_mutable_loan_data`,
/// and `decode_cumulative_repayment_data` — pure ScVal → Rust functions,
/// no live RPC, no DB.
use alloy::primitives::U256;
use pipeline_worker::indexer::stellar::loan_registry_reader::{
    decode_cumulative_repayment_data, decode_immutable_loan_data, decode_mutable_loan_data,
};
use stellar_xdr::curr::{
    Limits, ReadXdr, ScMap, ScMapEntry, ScString, ScSymbol, ScVal, ScVec, StringM, UInt128Parts,
    VecM, WriteXdr,
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

fn encode_scval(val: &ScVal) -> String {
    val.to_xdr_base64(Limits::none()).unwrap()
}

// ── decode_immutable_loan_data ────────────────────────────────────────────────

#[test]
fn decode_immutable_loan_data_happy_path() {
    let scval = make_map(vec![
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
    ]);
    let b64 = encode_scval(&scval);

    let view = decode_immutable_loan_data(
        &ScVal::from_xdr_base64(&b64, stellar_xdr::curr::Limits::none()).unwrap(),
    )
    .expect("should decode ImmutableLoanData");

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
fn decode_immutable_loan_data_rejects_non_map() {
    let not_a_map = ScVal::U32(42);
    let result = decode_immutable_loan_data(&not_a_map);
    assert!(result.is_err(), "non-map ScVal should produce an error");
}

// ── decode_mutable_loan_data ──────────────────────────────────────────────────

fn location_map(loc_type: &str, identifier: &str, url: &str, updated_at: u64) -> ScVal {
    make_map(vec![
        ("location_identifier", string_val(identifier)),
        ("location_type", enum_variant(loc_type)),
        ("tracking_url", string_val(url)),
        ("updated_at", u64_val(updated_at)),
    ])
}

#[test]
fn decode_mutable_loan_data_happy_path() {
    let current_location = location_map(
        "Vessel",
        "IMO-1234567",
        "https://track.example.com",
        1_700_500_000,
    );

    let scval = make_map(vec![
        ("ccr", u32_val(12500)),
        ("closure_reason", enum_variant("None")),
        ("current_location", current_location),
        ("current_maturity_timestamp", u64_val(1_731_600_000)),
        ("last_reported_ccr_timestamp", u64_val(1_700_000_000)),
        ("metadata_uri", string_val("ipfs://QmAbc")),
        ("next_economics_epochs_id", u32_val(1)),
        ("next_repayment_id", u32_val(2)),
        ("status", enum_variant("Performing")),
    ]);

    let view = decode_mutable_loan_data(&scval).expect("should decode MutableLoanData");

    assert_eq!(view.status, 0); // 0 = Performing
    assert_eq!(view.closure_reason, 0); // 0 = None
    assert_eq!(view.ccr_bps, 12500);
    assert_eq!(view.next_economics_epochs_id, U256::from(1u32));
    assert_eq!(view.next_repayment_id, U256::from(2u32));
    assert_eq!(view.metadata_uri, "ipfs://QmAbc");
    assert_eq!(view.current_location.location_identifier, "IMO-1234567");
    assert_eq!(view.current_location.updated_at, 1_700_500_000);
}

#[test]
fn decode_mutable_loan_data_closed_status() {
    let current_location = location_map("Warehouse", "WH-001", "", 0);

    let scval = make_map(vec![
        ("ccr", u32_val(0)),
        ("closure_reason", enum_variant("ScheduledMaturity")),
        ("current_location", current_location),
        ("current_maturity_timestamp", u64_val(0)),
        ("last_reported_ccr_timestamp", u64_val(0)),
        ("metadata_uri", string_val("ipfs://QmDone")),
        ("next_economics_epochs_id", u32_val(5)),
        ("next_repayment_id", u32_val(10)),
        ("status", enum_variant("Closed")),
    ]);

    let view = decode_mutable_loan_data(&scval).expect("should decode Closed status");
    assert_eq!(view.status, 3); // 3 = Closed
    assert_eq!(view.closure_reason, 1); // 1 = ScheduledMaturity
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
