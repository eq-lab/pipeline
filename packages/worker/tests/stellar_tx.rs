//! Encode/sign tests for the shared `worker::stellar::tx` helpers.

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use stellar_strkey::{ed25519::PublicKey as Ed25519Pub, Contract as ContractStrkey};
use stellar_xdr::curr::{
    HostFunction, Limits, OperationBody, ReadXdr, ScAddress, ScSymbol, ScVal, ScVec,
    TransactionEnvelope, VecM,
};

use pipeline_worker::stellar::tx::{
    address_account, address_contract, build_invoke_envelope, envelope_to_base64, sign_envelope,
    symbol,
};

fn fixture_user() -> Ed25519Pub {
    Ed25519Pub::from_string("GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM")
        .expect("valid G… strkey")
}

fn fixture_plusd() -> ContractStrkey {
    ContractStrkey::from_string("CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO")
        .expect("valid C… strkey")
}

fn fixture_access_manager() -> ContractStrkey {
    ContractStrkey::from_string("CCP6CHNZHUWOG7GGPMHOY55EKRVX2R352UAYBSPB5VH5P3HVCW7BFKJ6")
        .expect("valid C… strkey")
}

/// `access_manager.execute(target, function, args, caller)` must encode as a
/// 4-element `InvokeContractArgs.args` — matches the on-chain signature at
/// `pipeline-stellar-contracts/contracts/access-manager/src/lib.rs::execute`.
#[test]
fn access_manager_execute_args_have_4_elements() {
    let user = fixture_user();
    let signer = fixture_user(); // any G… works as the caller fixture
    let plusd = fixture_plusd();
    let am = fixture_access_manager();

    let inner_args: VecM<ScVal> = vec![address_account(&user), ScVal::Bool(true)]
        .try_into()
        .expect("two args fit in VecM");
    let args = vec![
        address_contract(&plusd),
        symbol("set_authorized"),
        ScVal::Vec(Some(ScVec(inner_args))),
        address_account(&signer),
    ];

    let envelope = build_invoke_envelope(&signer, 1, 10_000, &am, "execute", args, vec![], None);

    let TransactionEnvelope::Tx(env) = envelope else {
        panic!("expected Tx variant");
    };
    let op = env.tx.operations.first().expect("one op");
    let OperationBody::InvokeHostFunction(host_op) = &op.body else {
        panic!("expected InvokeHostFunction");
    };
    let HostFunction::InvokeContract(invoke) = &host_op.host_function else {
        panic!("expected InvokeContract");
    };

    // Contract target = access_manager
    let ScAddress::Contract(stellar_xdr::curr::ContractId(stellar_xdr::curr::Hash(addr_bytes))) =
        invoke.contract_address
    else {
        panic!("expected contract address");
    };
    assert_eq!(addr_bytes, am.0);

    // Function = "execute"
    let ScSymbol(name) = &invoke.function_name;
    assert_eq!(name.to_utf8_string_lossy(), "execute");

    // 4 args at the access-manager boundary.
    assert_eq!(
        invoke.args.len(),
        4,
        "execute requires (target, function, args, caller)"
    );

    // First arg = target contract address.
    let ScVal::Address(ScAddress::Contract(stellar_xdr::curr::ContractId(
        stellar_xdr::curr::Hash(target_bytes),
    ))) = &invoke.args[0]
    else {
        panic!("arg[0] must be contract Address");
    };
    assert_eq!(*target_bytes, plusd.0);

    // Second arg = function symbol "set_authorized".
    let ScVal::Symbol(ScSymbol(fn_name)) = &invoke.args[1] else {
        panic!("arg[1] must be Symbol");
    };
    assert_eq!(fn_name.to_utf8_string_lossy(), "set_authorized");

    // Third arg = Vec<Val> of length 2: [Address(user), Bool(true)].
    let ScVal::Vec(Some(ScVec(inner))) = &invoke.args[2] else {
        panic!("arg[2] must be Vec");
    };
    assert_eq!(inner.len(), 2);
    assert!(matches!(inner[0], ScVal::Address(ScAddress::Account(_))));
    assert!(matches!(inner[1], ScVal::Bool(true)));

    // Fourth arg = caller address (account).
    assert!(matches!(
        invoke.args[3],
        ScVal::Address(ScAddress::Account(_))
    ));
}

#[test]
fn signature_round_trip() {
    let signing_key = SigningKey::from_bytes(&[1u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();
    let source = Ed25519Pub(pubkey_bytes);

    let user = fixture_user();
    let sac = fixture_plusd();

    // One-arg call (the simulate-time `is_authorized(user)` view-call shape).
    let mut envelope = build_invoke_envelope(
        &source,
        42,
        10_000,
        &sac,
        "authorized",
        vec![address_account(&user)],
        vec![],
        None,
    );
    sign_envelope(
        &mut envelope,
        &signing_key,
        "Test SDF Network ; September 2015",
    )
    .expect("sign");

    let TransactionEnvelope::Tx(env) = &envelope else {
        panic!("not Tx variant");
    };
    assert_eq!(env.signatures.len(), 1);
    let sig0 = &env.signatures[0];
    assert_eq!(sig0.hint.0, pubkey_bytes[28..32]);

    // Verify the signature round-trips via base64 → XDR.
    let b64 = envelope_to_base64(&envelope).expect("base64");
    let bytes = STANDARD.decode(b64.as_bytes()).expect("decode");
    let decoded =
        TransactionEnvelope::from_xdr(bytes.as_slice(), Limits::none()).expect("from_xdr");
    let TransactionEnvelope::Tx(decoded_env) = decoded else {
        panic!("decoded not Tx");
    };
    assert_eq!(decoded_env.signatures.len(), 1);
}
