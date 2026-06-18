//! Pure helpers for building & signing Soroban transactions.
//!
//! Promoted from `relayer/stellar/tx.rs` into the shared `stellar/` module (Issue #568)
//! so the price-poller and future Stellar jobs can reuse these helpers without
//! cross-importing from the relayer's job-namespaced module.
//!
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
    PublicKey as XdrPublicKey, ScAddress, ScSymbol, ScVal, SequenceNumber, Signature,
    SignatureHint, SorobanAuthorizationEntry, SorobanTransactionData, StringM, Transaction,
    TransactionEnvelope, TransactionExt, TransactionSignaturePayload,
    TransactionSignaturePayloadTaggedTransaction, TransactionV1Envelope, Uint256, VecM, WriteXdr,
};

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
