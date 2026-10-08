/// Unit tests for the EVM `LoanRegistryReader`'s pure ABI decode —
/// `decode_mutable_loan_data` — no live eth_call, no DB.
///
/// hoodi-v4, the only EVM deployment, is pre-rework: its `mutableLoanData` return
/// still carries `ccrBps`/`lastReportedCCRTimestamp`/`currentLocation`. This locks the
/// regression a prior round introduced (removing those fields from the `sol!` struct
/// made every `mutableLoanData` eth_call fail to decode) and the ordinal translation
/// that keeps `MutableLoanDataView.status`/`closure_reason` in the canonical
/// post-rework space the shared name tables expect.
use alloy::primitives::U256;
use alloy::sol_types::SolValue;
use pipeline_worker::indexer::loan_mapper::{closure_reason_name, loan_status_name};
use pipeline_worker::indexer::loan_registry_reader::{decode_mutable_loan_data, ILoanRegistry};

fn pre_rework_payload(status: u8, closure_reason: u8) -> Vec<u8> {
    let data = ILoanRegistry::MutableLoanData {
        nextEconomicsEpochsId: U256::from(1u64),
        nextRepaymentId: U256::from(2u64),
        status: status.try_into().expect("valid LoanStatus ordinal"),
        ccrBps: 1_250_000,
        lastReportedCCRTimestamp: 1_700_000_000,
        currentMaturityTimestamp: 1_731_600_000,
        closureReason: closure_reason
            .try_into()
            .expect("valid ClosureReason ordinal"),
        currentLocation: ILoanRegistry::LocationUpdate {
            locationType: 0u8.try_into().expect("valid LocationType ordinal"),
            locationIdentifier: "IMO-1234567".to_owned(),
            trackingURL: "https://track.example.com".to_owned(),
            updatedAt: 1_700_500_000,
        },
        metadataURI: "ipfs://QmAbc".to_owned(),
    };
    data.abi_encode()
}

#[test]
fn decode_mutable_loan_data_decodes_pre_rework_payload() {
    // status=0 (pre-rework Performing), closure_reason=0 (None) — the regression:
    // before the restore, this `sol!` struct had no `currentLocation` field and every
    // decode of a real hoodi-v4 return errored out.
    let bytes = pre_rework_payload(0, 0);

    let view = decode_mutable_loan_data(&bytes).expect("should decode pre-rework MutableLoanData");

    assert_eq!(view.next_economics_epochs_id, U256::from(1u64));
    assert_eq!(view.next_repayment_id, U256::from(2u64));
    assert_eq!(view.current_maturity_timestamp, 1_731_600_000);
    assert_eq!(view.metadata_uri, "ipfs://QmAbc");
}

#[test]
fn decode_mutable_loan_data_translates_status_and_closure_reason() {
    // raw pre-rework ordinals: status=2 (Default), closure_reason=4 (OtherWriteDown).
    let bytes = pre_rework_payload(2, 4);

    let view = decode_mutable_loan_data(&bytes).expect("should decode pre-rework MutableLoanData");

    assert_eq!(loan_status_name(view.status), "Default");
    assert_eq!(closure_reason_name(view.closure_reason), "OtherWriteDown");
}

#[test]
fn decode_then_name_performing_is_not_approved() {
    let bytes = pre_rework_payload(0, 0);

    let view = decode_mutable_loan_data(&bytes).expect("should decode pre-rework MutableLoanData");

    assert_eq!(loan_status_name(view.status), "Performing");
    assert_ne!(loan_status_name(view.status), "Approved");
}

#[test]
fn decode_mutable_loan_data_every_pre_rework_status_ordinal() {
    let cases: [(u8, &str); 4] = [
        (0, "Performing"),
        (1, "WatchList"),
        (2, "Default"),
        (3, "Closed"),
    ];
    for (raw, expected) in cases {
        let bytes = pre_rework_payload(raw, 0);
        let view =
            decode_mutable_loan_data(&bytes).expect("should decode pre-rework MutableLoanData");
        assert_eq!(loan_status_name(view.status), expected);
    }
}
