// spec: docs/design-docs/multi-chain-kyc-sharding.md#stellar-relayer-whitelist
use pipeline_worker::relayer::stellar::whitelist::{
    classify_authorized_simulate, holder_scval, PlusdAuth,
};
use stellar_strkey::{ed25519::PublicKey as Ed25519Pub, Contract};
use stellar_xdr::curr::{ScAddress, ScVal};

#[test]
fn g_address_maps_to_account_scval() {
    let key = Ed25519Pub([7u8; 32]);
    let Some(ScVal::Address(ScAddress::Account(_))) = holder_scval(&key.to_string()) else {
        panic!("expected account address");
    };
    assert_eq!(
        holder_scval(&key.to_string()),
        Some(pipeline_worker::stellar::tx::address_account(&key))
    );
}

#[test]
fn c_address_maps_to_contract_scval() {
    let c = Contract([9u8; 32]);
    let Some(ScVal::Address(ScAddress::Contract(id))) = holder_scval(&c.to_string()) else {
        panic!("expected contract address");
    };
    assert_eq!(id.0 .0, [9u8; 32]);
}

#[test]
fn garbage_muxed_and_empty_are_rejected() {
    assert!(holder_scval("").is_none());
    assert!(holder_scval("not-a-strkey").is_none());
    let muxed = stellar_strkey::ed25519::MuxedAccount {
        ed25519: [1u8; 32],
        id: 5,
    };
    assert!(holder_scval(&muxed.to_string()).is_none());
}

#[test]
fn trustline_missing_error_is_no_trustline() {
    let err = "HostError: Error(Contract, #13)";
    assert_eq!(
        classify_authorized_simulate(Some(err), None),
        PlusdAuth::NoTrustline
    );
}

#[test]
fn other_errors_are_unknown_and_matcher_is_exact() {
    for err in [
        "HostError: Error(Contract, #4)",
        "HostError: Error(Contract, #130)",
        "rpc timeout",
    ] {
        assert_eq!(
            classify_authorized_simulate(Some(err), None),
            PlusdAuth::Unknown,
            "{err}"
        );
    }
}

#[test]
fn return_values_classify() {
    assert_eq!(classify_authorized_simulate(None, None), PlusdAuth::Unknown);
    assert_eq!(
        classify_authorized_simulate(None, Some(&ScVal::Bool(true))),
        PlusdAuth::Authorized
    );
    assert_eq!(
        classify_authorized_simulate(None, Some(&ScVal::Bool(false))),
        PlusdAuth::NotAuthorized
    );
    assert_eq!(
        classify_authorized_simulate(None, Some(&ScVal::U32(1))),
        PlusdAuth::Unknown
    );
}
