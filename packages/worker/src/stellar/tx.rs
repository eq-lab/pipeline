//! Pure helpers for building & signing Soroban transactions.
//!
//! Promoted from `relayer/stellar/tx.rs` into the shared `stellar/` module (Issue #568)
//! so the price-poller and future Stellar jobs can reuse these helpers without
//! cross-importing from the relayer's job-namespaced module.
//!
//! - Encode `stellar_governance::timelock::storage::Operation` as `ScVal` exactly the way
//!   `soroban-sdk`'s `to_xdr(e)` does for `#[contracttype]` structs: an `ScVal::Map`
//!   of alphabetically-sorted `(ScSymbol, ScVal)` entries.
//! - Assemble the `TransactionEnvelope::Tx(...)` carrying one `InvokeHostFunction`
//!   operation, the `SorobanTransactionData` from a simulate response, and any
//!   auth entries returned by simulate.
//! - Sign the envelope: sha256 over `TransactionSignaturePayload { network_id, tagged_transaction }`,
//!   ed25519-sign the digest, wrap in `DecoratedSignature { hint = last_4_bytes_of_pubkey, signature }`.
//!
//! No I/O — all functions are deterministic and unit-testable.

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};
use stellar_strkey::{ed25519::PublicKey as Ed25519Pub, Contract as ContractStrkey};
use stellar_xdr::curr::{
    AccountId, BytesM, ContractId, DecoratedSignature, Hash, HostFunction, InvokeContractArgs,
    InvokeHostFunctionOp, Limits, Memo, MuxedAccount, Operation, OperationBody, Preconditions,
    PublicKey as XdrPublicKey, ScAddress, ScBytes, ScMap, ScMapEntry, ScSymbol, ScVal,
    SequenceNumber, Signature, SignatureHint, SorobanAuthorizationEntry, SorobanTransactionData,
    StringM, Transaction, TransactionEnvelope, TransactionExt, TransactionSignaturePayload,
    TransactionSignaturePayloadTaggedTransaction, TransactionV1Envelope, Uint256, VecM, WriteXdr,
};

// ─── Operation ScVal builder (parity with soroban-sdk `to_xdr` on `#[contracttype]`) ──

/// Build the `ScVal` representation of the `stellar_governance::timelock::storage::Operation`
/// struct:
///
/// ```text
/// pub struct Operation {
///     pub target: Address,        // alphabetical: 5th
///     pub function: Symbol,       // alphabetical: 2nd
///     pub args: Vec<Val>,         // alphabetical: 1st
///     pub predecessor: BytesN<32>,// alphabetical: 3rd
///     pub salt: BytesN<32>,       // alphabetical: 4th
/// }
/// ```
///
/// `soroban-sdk`'s `to_xdr(e)` produces an `ScVal::Map` whose entries are sorted
/// alphabetically by field-name symbol. We must match byte-for-byte; otherwise
/// `access_manager::hash_operation` computes a different ID and the salt-based
/// dedup is wrong.
pub fn build_set_authorized_operation_scval(
    plusd_sac: &ContractStrkey,
    user: &Ed25519Pub,
    salt: [u8; 32],
) -> ScVal {
    let target_val = address_contract(plusd_sac);
    let function_val = symbol("set_authorized");

    // args = [Address(user), Bool(true)]
    let user_val = address_account(user);
    let args_inner: VecM<ScVal> = vec![user_val, ScVal::Bool(true)]
        .try_into()
        .expect("two args fit in VecM");
    let args_val = ScVal::Vec(Some(stellar_xdr::curr::ScVec(args_inner)));

    let predecessor_val = bytes_32([0u8; 32]);
    let salt_val = bytes_32(salt);

    // Alphabetical: args, function, predecessor, salt, target.
    let entries: VecM<ScMapEntry> = vec![
        map_entry("args", args_val),
        map_entry("function", function_val),
        map_entry("predecessor", predecessor_val),
        map_entry("salt", salt_val),
        map_entry("target", target_val),
    ]
    .try_into()
    .expect("five entries fit in VecM");

    ScVal::Map(Some(ScMap(entries)))
}

// ─── Envelope assembly ───────────────────────────────────────────────────────

/// Build a Soroban tx envelope invoking `<contract>.<function>(...)`.
///
/// `source_account` is the relayer's `G…` (ed25519 pubkey). `fee` is the total
/// transaction fee (inclusion fee + resource fee). `auth` are the entries
/// returned by `simulateTransaction`; pass `[]` on the pre-check call.
#[allow(clippy::too_many_arguments)]
pub fn build_invoke_envelope(
    source_account: &Ed25519Pub,
    seq_num: i64,
    fee: u32,
    contract: &ContractStrkey,
    function_name: &str,
    args: Vec<ScVal>,
    auth: Vec<SorobanAuthorizationEntry>,
    soroban_data: Option<SorobanTransactionData>,
) -> TransactionEnvelope {
    let function_name_sym: StringM<32> = function_name
        .as_bytes()
        .to_vec()
        .try_into()
        .expect("function name fits in StringM<32>");

    let invoke_args = InvokeContractArgs {
        contract_address: ScAddress::Contract(ContractId(Hash(contract.0))),
        function_name: ScSymbol(function_name_sym),
        args: args.try_into().expect("args fit in VecM"),
    };

    let host_function = HostFunction::InvokeContract(invoke_args);
    let auth_vec: VecM<SorobanAuthorizationEntry> = auth.try_into().expect("auth fits in VecM");

    let op = Operation {
        source_account: None,
        body: OperationBody::InvokeHostFunction(InvokeHostFunctionOp {
            host_function,
            auth: auth_vec,
        }),
    };

    let ext = soroban_data.map_or(TransactionExt::V0, TransactionExt::V1);

    let tx = Transaction {
        source_account: MuxedAccount::Ed25519(Uint256(source_account.0)),
        fee,
        seq_num: SequenceNumber(seq_num),
        cond: Preconditions::None,
        memo: Memo::None,
        operations: vec![op].try_into().expect("one op fits in VecM"),
        ext,
    };

    TransactionEnvelope::Tx(TransactionV1Envelope {
        tx,
        signatures: VecM::default(),
    })
}

/// Sign a tx envelope in place.
///
/// Computes `sha256( XDR(TransactionSignaturePayload { network_id: sha256(passphrase),
/// tagged_transaction: Tx(tx) }) )`, ed25519-signs the digest, and appends a
/// `DecoratedSignature { hint = last 4 bytes of pubkey, signature }`.
pub fn sign_envelope(
    envelope: &mut TransactionEnvelope,
    signing_key: &SigningKey,
    network_passphrase: &str,
) -> Result<()> {
    let TransactionEnvelope::Tx(env) = envelope else {
        anyhow::bail!("sign_envelope: expected TransactionEnvelope::Tx");
    };
    let network_id: [u8; 32] = Sha256::digest(network_passphrase.as_bytes()).into();
    let payload = TransactionSignaturePayload {
        network_id: Hash(network_id),
        tagged_transaction: TransactionSignaturePayloadTaggedTransaction::Tx(env.tx.clone()),
    };
    let payload_xdr = payload
        .to_xdr(Limits::none())
        .context("encode TransactionSignaturePayload")?;
    let digest: [u8; 32] = Sha256::digest(&payload_xdr).into();
    let sig = signing_key.sign(&digest).to_bytes();

    let pubkey = signing_key.verifying_key().to_bytes();
    let mut hint = [0u8; 4];
    hint.copy_from_slice(&pubkey[28..32]);

    let sig_bytes: BytesM<64> = sig
        .to_vec()
        .try_into()
        .expect("64 bytes fits in BytesM<64>");
    let decorated = DecoratedSignature {
        hint: SignatureHint(hint),
        signature: Signature(sig_bytes),
    };

    let sigs_vec: Vec<DecoratedSignature> = vec![decorated];
    env.signatures = sigs_vec.try_into().expect("one signature fits in VecM");
    Ok(())
}

/// XDR-encode a `TransactionEnvelope` and base64-encode it for `sendTransaction`.
pub fn envelope_to_base64(envelope: &TransactionEnvelope) -> Result<String> {
    let bytes = envelope
        .to_xdr(Limits::none())
        .context("encode TransactionEnvelope")?;
    Ok(STANDARD.encode(bytes))
}

/// Compute the tx hash (sha256 of the signature payload) — used to poll `getTransaction`
/// when we don't want to rely on the `hash` echoed by `sendTransaction`.
pub fn compute_tx_hash(tx: &Transaction, network_passphrase: &str) -> Result<[u8; 32]> {
    let network_id: [u8; 32] = Sha256::digest(network_passphrase.as_bytes()).into();
    let payload = TransactionSignaturePayload {
        network_id: Hash(network_id),
        tagged_transaction: TransactionSignaturePayloadTaggedTransaction::Tx(tx.clone()),
    };
    let xdr = payload
        .to_xdr(Limits::none())
        .context("encode TransactionSignaturePayload")?;
    Ok(Sha256::digest(xdr).into())
}

// ─── ScVal primitives ────────────────────────────────────────────────────────

/// Build `ScVal::Address(ScAddress::Account(...))` from an ed25519 `G…` strkey.
pub fn address_account(pubkey: &Ed25519Pub) -> ScVal {
    ScVal::Address(ScAddress::Account(AccountId(
        XdrPublicKey::PublicKeyTypeEd25519(Uint256(pubkey.0)),
    )))
}

/// Build `ScVal::Address(ScAddress::Contract(...))` from a `C…` strkey.
pub fn address_contract(contract: &ContractStrkey) -> ScVal {
    ScVal::Address(ScAddress::Contract(ContractId(Hash(contract.0))))
}

pub fn symbol(s: &str) -> ScVal {
    let inner: StringM<32> = s
        .as_bytes()
        .to_vec()
        .try_into()
        .expect("symbol fits in StringM<32>");
    ScVal::Symbol(ScSymbol(inner))
}

pub fn bytes_32(b: [u8; 32]) -> ScVal {
    let m: BytesM = b
        .to_vec()
        .try_into()
        .expect("32 bytes fits in BytesM<u32::MAX>");
    ScVal::Bytes(ScBytes(m))
}

pub fn map_entry(key: &str, val: ScVal) -> ScMapEntry {
    let sym_inner: StringM<32> = key
        .as_bytes()
        .to_vec()
        .try_into()
        .expect("field name fits in StringM<32>");
    ScMapEntry {
        key: ScVal::Symbol(ScSymbol(sym_inner)),
        val,
    }
}
