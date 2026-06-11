//! Stellar/Soroban ed25519 voucher signing.
//!
//! Reproduces the on-chain `request-queue::crypto::digest` computation:
//!
//! ```text
//! domain_separator = sha256( XDR(Domain { contract_separator, network_id }) )
//! voucher_hash     = sha256( XDR(Voucher { request_id, sender, amount }) )
//! digest           = sha256( domain_separator || voucher_hash )
//! ```
//!
//! Both `Domain` and `Voucher` are `#[contracttype]` structs in soroban-sdk.
//! soroban's `to_xdr(e)` serialises a `#[contracttype]` struct as
//! `ScVal::Map(sorted-by-field-name map of ScSymbol → ScVal)`.
//! We reproduce this encoding directly with the `stellar-xdr` crate.
//!
//! The `sign_voucher` function is the public signing entry-point consumed by
//! the voucher route. `voucher_digest` is public so tests can exercise the
//! digest without a private key.

use ed25519_dalek::{Signature, Signer, SigningKey};
use sha2::{Digest, Sha256};
use stellar_xdr::curr::{
    AccountId, BytesM, ContractId, Hash, Int128Parts, Limits, PublicKey, ScAddress, ScBytes,
    ScMap, ScMapEntry, ScSymbol, ScVal, StringM, UInt128Parts, Uint256, VecM, WriteXdr,
};

/// A loaded ed25519 signing key for Stellar voucher signing.
#[derive(Debug)]
pub struct StellarVoucherSigner {
    signing_key: SigningKey,
    /// Raw 32-byte ed25519 public key — exposed for logging/diagnostics.
    pub verifier_pubkey: [u8; 32],
}

impl StellarVoucherSigner {
    /// Build from a raw 32-byte seed.
    pub fn from_seed(seed: [u8; 32]) -> Self {
        let signing_key = SigningKey::from_bytes(&seed);
        let verifier_pubkey = signing_key.verifying_key().to_bytes();
        Self {
            signing_key,
            verifier_pubkey,
        }
    }

    /// Build from a Stellar Strkey `S…` private key.
    ///
    /// Returns `Err` if `strkey` is not a valid `S…` Strkey.
    pub fn from_strkey(strkey: &str) -> anyhow::Result<Self> {
        let pk = stellar_strkey::ed25519::PrivateKey::from_string(strkey)
            .map_err(|e| anyhow::anyhow!("invalid STELLAR_VERIFIER_SECRET Strkey: {e}"))?;
        Ok(Self::from_seed(pk.0))
    }
}

/// The Stellar contract domain parameters used for voucher signing.
///
/// Mirrors the on-chain `Domain { contract_separator, network_id }` struct.
#[derive(Debug)]
pub struct StellarVoucherDomain {
    /// Raw 32-byte contract hash (from the `C…` Strkey).
    contract_id_bytes: [u8; 32],
    /// SHA-256 of the network passphrase (= `ledger.network_id()` on-chain).
    pub network_id: [u8; 32],
}

impl StellarVoucherDomain {
    /// Construct from a parsed `C…` contract Strkey and the network passphrase string.
    ///
    /// `network_id` is computed as `sha256(passphrase)`, matching
    /// `Env::ledger().network_id()` in the Soroban runtime.
    pub fn from_passphrase(contract_id: &stellar_strkey::Contract, passphrase: &str) -> Self {
        let network_id: [u8; 32] = Sha256::digest(passphrase.as_bytes()).into();
        Self {
            contract_id_bytes: contract_id.0,
            network_id,
        }
    }

    /// Return the `C…` Strkey for the contract stored in this domain as a `std::String`.
    ///
    /// Used by the voucher route to pass the contract address to `is_request_claimed`.
    pub fn contract_strkey(&self) -> String {
        // stellar_strkey::Contract::to_string() returns a heapless::String<56>;
        // use format! with the Display impl to convert to std::String.
        format!("{}", stellar_strkey::Contract(self.contract_id_bytes))
    }
}

// ─── Internal XDR helpers ────────────────────────────────────────────────────

/// Build a single `ScMapEntry` with a string-symbol key.
fn map_entry(key: &str, val: ScVal) -> ScMapEntry {
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

/// Encode the `Domain` struct as the XDR bytes that soroban's `to_xdr(e)` produces.
///
/// `Domain { contract_separator: Address, network_id: BytesN<32> }`.
/// Field order after alphabetical sort: `contract_separator` < `network_id`.
fn domain_xdr(domain: &StellarVoucherDomain) -> Vec<u8> {
    let contract_val = ScVal::Address(ScAddress::Contract(ContractId(Hash(
        domain.contract_id_bytes,
    ))));

    let network_bytes: BytesM = domain
        .network_id
        .to_vec()
        .try_into()
        .expect("network_id is 32 bytes, well within BytesM limits");
    let network_val = ScVal::Bytes(ScBytes(network_bytes));

    let entries: VecM<ScMapEntry> = vec![
        map_entry("contract_separator", contract_val),
        map_entry("network_id", network_val),
    ]
    .try_into()
    .expect("two entries fit in VecM");

    let sc_map_val = ScVal::Map(Some(ScMap(entries)));
    sc_map_val
        .to_xdr(Limits::none())
        .expect("ScVal::Map XDR serialisation is infallible for valid inputs")
}

/// Encode the `Voucher` struct as the XDR bytes that soroban's `to_xdr(e)` produces.
///
/// `Voucher { request_id: u128, sender: Address, amount: i128 }`.
/// Field order after alphabetical sort: `amount` < `request_id` < `sender`.
fn voucher_xdr(
    request_id: u128,
    sender: &stellar_strkey::ed25519::PublicKey,
    amount: i128,
) -> Vec<u8> {
    // amount (i128)
    let (hi, lo) = i128_to_parts(amount);
    let amount_val = ScVal::I128(Int128Parts { hi, lo });

    // request_id (u128)
    let (hi, lo) = u128_to_parts(request_id);
    let rid_val = ScVal::U128(UInt128Parts { hi, lo });

    // sender (Address = Account ed25519)
    let sender_val = ScVal::Address(ScAddress::Account(AccountId(
        PublicKey::PublicKeyTypeEd25519(Uint256(sender.0)),
    )));

    let entries: VecM<ScMapEntry> = vec![
        map_entry("amount", amount_val),
        map_entry("request_id", rid_val),
        map_entry("sender", sender_val),
    ]
    .try_into()
    .expect("three entries fit in VecM");

    let sc_map_val = ScVal::Map(Some(ScMap(entries)));
    sc_map_val
        .to_xdr(Limits::none())
        .expect("ScVal::Map XDR serialisation is infallible for valid inputs")
}

// ─── Public API ──────────────────────────────────────────────────────────────

/// Compute the Soroban voucher digest exactly as `request-queue::crypto::digest` does.
///
/// ```text
/// domain_separator = sha256( XDR(Domain { contract_separator, network_id }) )
/// voucher_hash     = sha256( XDR(Voucher { request_id, sender, amount }) )
/// digest           = sha256( domain_separator || voucher_hash )
/// ```
pub fn voucher_digest(
    domain: &StellarVoucherDomain,
    request_id: u128,
    sender: &stellar_strkey::ed25519::PublicKey,
    amount: i128,
) -> [u8; 32] {
    let domain_sep: [u8; 32] = Sha256::digest(domain_xdr(domain)).into();
    let voucher_hash: [u8; 32] =
        Sha256::digest(voucher_xdr(request_id, sender, amount)).into();

    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(&domain_sep);
    combined[32..].copy_from_slice(&voucher_hash);

    Sha256::digest(combined).into()
}

/// Sign a Stellar voucher, returning the 64-byte raw ed25519 signature.
pub fn sign_voucher(
    signer: &StellarVoucherSigner,
    domain: &StellarVoucherDomain,
    request_id: u128,
    sender: &stellar_strkey::ed25519::PublicKey,
    amount: i128,
) -> [u8; 64] {
    let digest = voucher_digest(domain, request_id, sender, amount);
    let sig: Signature = signer.signing_key.sign(&digest);
    sig.to_bytes()
}

// ─── Numeric helpers ─────────────────────────────────────────────────────────

fn u128_to_parts(v: u128) -> (u64, u64) {
    ((v >> 64) as u64, v as u64)
}

fn i128_to_parts(v: i128) -> (i64, u64) {
    ((v >> 64) as i64, v as u64)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;

    const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";
    /// Deployed testnet DepositManager (from .env.example)
    const TESTNET_DM_STRKEY: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
    /// Deployed testnet verifier pubkey (from the Issue body)
    const TESTNET_VERIFIER: &str = "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM";

    fn testnet_domain() -> StellarVoucherDomain {
        let contract_id =
            stellar_strkey::Contract::from_string(TESTNET_DM_STRKEY).expect("valid C… strkey");
        StellarVoucherDomain::from_passphrase(&contract_id, TESTNET_PASSPHRASE)
    }

    fn testnet_sender() -> stellar_strkey::ed25519::PublicKey {
        stellar_strkey::ed25519::PublicKey::from_string(TESTNET_VERIFIER)
            .expect("valid G… strkey")
    }

    // ── Golden-fixture test ───────────────────────────────────────────────────
    //
    // The expected digest below was obtained by invoking the deployed testnet
    // DepositManager `digest(...)` view via the Stellar CLI:
    //
    //   stellar contract invoke \
    //     --id CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO \
    //     --network testnet \
    //     --source-account GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM \
    //     --send=no \
    //     -- digest \
    //     --request_id 1 \
    //     --sender GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM \
    //     --amount 1000000
    //
    // If this test fails after a soroban-sdk upgrade, re-run the command above and
    // update `GOLDEN_DIGEST_HEX` — a divergence means the on-chain `to_xdr(e)`
    // layout has changed and our `stellar-xdr` reproduction needs to catch up.
    const GOLDEN_DIGEST_HEX: &str =
        "9b5efb4375bbbb89200320c22d0aba0acb8c86e901030379ca3d326e55345191";

    #[test]
    fn golden_digest_fixture() {
        let expected = hex::decode(GOLDEN_DIGEST_HEX).expect("valid hex");
        let domain = testnet_domain();
        let sender = testnet_sender();
        let got = voucher_digest(&domain, 1u128, &sender, 1_000_000_i128);
        assert_eq!(
            got.as_slice(),
            expected.as_slice(),
            "XDR-encoded digest must match the on-chain `digest(...)` view byte-for-byte; \
             a divergence means our stellar-xdr reproduction differs from soroban-sdk's to_xdr"
        );
    }

    // ── XDR structural tests ─────────────────────────────────────────────────

    /// Verify that `domain_xdr` produces a non-empty byte slice and that the
    /// length is stable across repeated calls (deterministic serialisation).
    #[test]
    fn domain_xdr_is_deterministic() {
        let domain = testnet_domain();
        let a = domain_xdr(&domain);
        let b = domain_xdr(&domain);
        assert!(!a.is_empty(), "domain XDR should not be empty");
        assert_eq!(a, b, "domain XDR should be deterministic");
    }

    /// Verify that `voucher_xdr` is deterministic.
    #[test]
    fn voucher_xdr_is_deterministic() {
        let sender = testnet_sender();
        let a = voucher_xdr(1u128, &sender, 1_000_000_i128);
        let b = voucher_xdr(1u128, &sender, 1_000_000_i128);
        assert!(!a.is_empty(), "voucher XDR should not be empty");
        assert_eq!(a, b, "voucher XDR should be deterministic");
    }

    /// Domain separator parity: sha256(domain_xdr) is consistent.
    #[test]
    fn domain_separator_reproducible() {
        let domain = testnet_domain();
        let sep_a: [u8; 32] = Sha256::digest(domain_xdr(&domain)).into();
        let sep_b: [u8; 32] = Sha256::digest(domain_xdr(&domain)).into();
        assert_eq!(sep_a, sep_b);
        // Must be non-zero
        assert_ne!(sep_a, [0u8; 32]);
    }

    /// Voucher hash parity: sha256(voucher_xdr) is consistent.
    #[test]
    fn voucher_hash_reproducible() {
        let sender = testnet_sender();
        let hash_a: [u8; 32] = Sha256::digest(voucher_xdr(1u128, &sender, 1_000_000_i128)).into();
        let hash_b: [u8; 32] = Sha256::digest(voucher_xdr(1u128, &sender, 1_000_000_i128)).into();
        assert_eq!(hash_a, hash_b);
        assert_ne!(hash_a, [0u8; 32]);
    }

    /// Digest changes when any input changes (collision resistance smoke-check).
    #[test]
    fn digest_changes_on_input_change() {
        let domain = testnet_domain();
        let sender = testnet_sender();

        let base = voucher_digest(&domain, 1u128, &sender, 1_000_000_i128);
        let diff_rid = voucher_digest(&domain, 2u128, &sender, 1_000_000_i128);
        let diff_amount = voucher_digest(&domain, 1u128, &sender, 2_000_000_i128);

        assert_ne!(base, diff_rid, "changing request_id must change digest");
        assert_ne!(base, diff_amount, "changing amount must change digest");
    }

    // ── Signature round-trip ─────────────────────────────────────────────────

    /// Use the canonical test fixture from the contracts repo (seed = [1u8; 32])
    /// to verify that ed25519-dalek signs and verifies correctly.
    #[test]
    fn signature_round_trip() {
        let signer = StellarVoucherSigner::from_seed([1u8; 32]);
        let domain = testnet_domain();
        let sender = testnet_sender();

        let sig_bytes = sign_voucher(&signer, &domain, 1u128, &sender, 1_000_000_i128);
        assert_eq!(sig_bytes.len(), 64);

        // Verify via ed25519-dalek VerifyingKey
        let verifying_key =
            ed25519_dalek::VerifyingKey::from_bytes(&signer.verifier_pubkey).unwrap();
        let sig = ed25519_dalek::Signature::from_bytes(&sig_bytes);
        let digest = voucher_digest(&domain, 1u128, &sender, 1_000_000_i128);
        verifying_key
            .verify(&digest, &sig)
            .expect("signature must verify");
    }

    // ── Strkey seed parsing ───────────────────────────────────────────────────

    /// Build a `StellarVoucherSigner` from a known S… strkey and verify the
    /// derived pubkey matches the expected G… strkey.
    #[test]
    fn strkey_seed_parsing() {
        // Use the well-known seed [1u8; 32] Strkey.
        // stellar_strkey encodes S… as: PrivateKey([1u8;32])
        let seed = [1u8; 32];
        // Use format! to convert heapless::String to std::String
        let s_strkey = format!("{}", stellar_strkey::ed25519::PrivateKey(seed));
        let signer = StellarVoucherSigner::from_strkey(&s_strkey).expect("valid strkey");
        // Verifier pubkey should match the expected verifying key
        let expected = ed25519_dalek::SigningKey::from_bytes(&seed)
            .verifying_key()
            .to_bytes();
        assert_eq!(signer.verifier_pubkey, expected);
    }

    // ── Numeric helpers ───────────────────────────────────────────────────────

    #[test]
    fn u128_parts_round_trip() {
        let v: u128 = 0xDEAD_BEEF_CAFE_1234_5678_9ABC_DEF0_1234;
        let (hi, lo) = u128_to_parts(v);
        let reconstructed = ((hi as u128) << 64) | (lo as u128);
        assert_eq!(v, reconstructed);
    }

    #[test]
    fn i128_parts_round_trip() {
        let v: i128 = -1_000_000_i128;
        let (hi, lo) = i128_to_parts(v);
        let reconstructed = ((hi as i128) << 64) | (lo as i128);
        assert_eq!(v, reconstructed);
    }

    /// Negative amount must differ from positive amount.
    #[test]
    fn negative_amount_differs_from_positive() {
        let domain = testnet_domain();
        let sender = testnet_sender();
        let pos = voucher_digest(&domain, 1u128, &sender, 1_000_000_i128);
        let neg = voucher_digest(&domain, 1u128, &sender, -1_000_000_i128);
        assert_ne!(pos, neg);
    }
}
