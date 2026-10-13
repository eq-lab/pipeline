use alloy::primitives::{FixedBytes, I256, U256};
use alloy::sol_types::SolValue;
use pipeline_worker::indexer::loan_mapper::{closure_reason_name, loan_status_name};
use pipeline_worker::indexer::loan_registry_reader::{
    decode_immutable_loan_data, decode_mutable_loan_data, ILoanRegistry,
};

fn mutable_payload(status: u8, closure_reason: u8, current_rate: u32) -> Vec<u8> {
    let data = ILoanRegistry::MutableLoanData {
        nextEconomicsEpochsId: U256::from(1u64),
        nextRepaymentId: U256::from(2u64),
        status: status.try_into().expect("valid LoanStatus ordinal"),
        currentMaturityTimestamp: 1_731_600_000,
        currentRate: current_rate,
        closureReason: closure_reason
            .try_into()
            .expect("valid ClosureReason ordinal"),
        carvedOut: true,
        disbursed: U256::from(500_000u64),
        repaid: U256::from(100_000u64),
        writtenDown: U256::from(0u64),
        interestAdjustment: I256::ZERO,
        metadataURI: "ipfs://QmAbc".to_owned(),
    };
    data.abi_encode()
}

fn immutable_payload(borrower_ref: [u8; 32], senior_interest_rate: u32) -> Vec<u8> {
    let data = ILoanRegistry::ImmutableLoanData {
        borrowerRef: FixedBytes::<32>::from(borrower_ref),
        originalFacilitySize: U256::from(1_000_000u64),
        originalSeniorTranche: U256::from(800_000u64),
        originalEquityTranche: U256::from(200_000u64),
        originalOfftakerPrice: U256::from(1_000_000u64),
        seniorInterestRate: senior_interest_rate,
        originationDate: 1_700_000_000,
        originalMaturityDate: 1_800_000_000,
    };
    data.abi_encode()
}

#[test]
fn decode_mutable_loan_data_happy_path() {
    let bytes = mutable_payload(1, 0, 100_000);

    let view = decode_mutable_loan_data(&bytes).expect("should decode MutableLoanData");

    assert_eq!(view.next_economics_epochs_id, U256::from(1u64));
    assert_eq!(view.next_repayment_id, U256::from(2u64));
    assert_eq!(view.current_maturity_timestamp, 1_731_600_000);
    assert_eq!(view.current_rate, 1_000, "100_000 ppm -> 1_000 bps (10%)");
    assert!(view.carved_out);
    assert_eq!(view.disbursed, U256::from(500_000u64));
    assert_eq!(view.repaid, U256::from(100_000u64));
    assert_eq!(view.written_down, U256::from(0u64));
    assert_eq!(view.metadata_uri, "ipfs://QmAbc");
}

#[test]
fn decode_mutable_loan_data_negative_interest_adjustment() {
    let data = ILoanRegistry::MutableLoanData {
        nextEconomicsEpochsId: U256::from(1u64),
        nextRepaymentId: U256::from(0u64),
        status: 1u8.try_into().unwrap(),
        currentMaturityTimestamp: 0,
        currentRate: 0,
        closureReason: 0u8.try_into().unwrap(),
        carvedOut: false,
        disbursed: U256::ZERO,
        repaid: U256::ZERO,
        writtenDown: U256::ZERO,
        interestAdjustment: I256::try_from(-250_000i64).unwrap(),
        metadataURI: String::new(),
    };
    let bytes = data.abi_encode();

    let view = decode_mutable_loan_data(&bytes).expect("should decode MutableLoanData");

    assert_eq!(
        view.interest_adjustment,
        I256::try_from(-250_000i64).unwrap()
    );
    assert_eq!(view.interest_adjustment.to_string(), "-250000");
}

#[test]
fn decode_mutable_loan_data_every_status_ordinal() {
    let cases: [(u8, &str); 5] = [
        (0, "Approved"),
        (1, "Performing"),
        (2, "WatchList"),
        (3, "Default"),
        (4, "Closed"),
    ];
    for (raw, expected) in cases {
        let bytes = mutable_payload(raw, 0, 0);
        let view = decode_mutable_loan_data(&bytes).expect("should decode MutableLoanData");
        assert_eq!(loan_status_name(view.status), expected);
    }
}

#[test]
fn decode_mutable_loan_data_every_closure_reason_ordinal() {
    let cases: [(u8, &str); 6] = [
        (0, "None"),
        (1, "ScheduledMaturity"),
        (2, "EarlyRepayment"),
        (3, "Cancelled"),
        (4, "Default"),
        (5, "OtherWriteDown"),
    ];
    for (raw, expected) in cases {
        let bytes = mutable_payload(0, raw, 0);
        let view = decode_mutable_loan_data(&bytes).expect("should decode MutableLoanData");
        assert_eq!(closure_reason_name(view.closure_reason), expected);
    }
}

#[test]
fn decode_mutable_loan_data_rejects_pre_rework_payload() {
    // 7 pre-rework head words, no currentLocation/metadataURI tail — malformed against the post-rework 12-field ABI.
    let bytes = vec![0u8; 32 * 7];

    let result = decode_mutable_loan_data(&bytes);
    assert!(
        result.is_err(),
        "a pre-rework payload must not decode as a post-rework MutableLoanData"
    );
}

#[test]
fn decode_immutable_loan_data_happy_path() {
    let borrower_ref = [0xAB_u8; 32];
    let bytes = immutable_payload(borrower_ref, 100_000);

    let view = decode_immutable_loan_data(&bytes).expect("should decode ImmutableLoanData");

    assert_eq!(
        view.borrower_ref,
        Some(FixedBytes::<32>::from(borrower_ref))
    );
    assert_eq!(
        view.senior_interest_rate_bps, 1_000,
        "100_000 ppm -> 1_000 bps (10%) — the #765 regression"
    );
    assert_eq!(view.original_facility_size, U256::from(1_000_000u64));
    assert_eq!(view.original_senior_tranche, U256::from(800_000u64));
    assert_eq!(view.original_equity_tranche, U256::from(200_000u64));
    assert_eq!(view.original_offtaker_price, U256::from(1_000_000u64));
    assert_eq!(view.origination_date, 1_700_000_000);
    assert_eq!(view.original_maturity_date, 1_800_000_000);
}

#[test]
fn decode_immutable_loan_data_all_zero_borrower_ref_is_some_zero() {
    let bytes = immutable_payload([0u8; 32], 0);

    let view = decode_immutable_loan_data(&bytes).expect("should decode ImmutableLoanData");

    assert_eq!(
        view.borrower_ref,
        Some(FixedBytes::<32>::ZERO),
        "an all-zero on-chain borrowerRef must decode to Some(ZERO), not None"
    );
}
