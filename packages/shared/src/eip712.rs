use alloy::primitives::{keccak256, Address, B256, U256};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::Signer;
use alloy::sol;
use alloy::sol_types::SolStruct;
use anyhow::{Context, Result};

sol! {
    struct VerifiedRequests {
        uint256 requestId;
        address user;
        uint256 amount;
    }
}

/// EIP-712 domain parameters.
#[derive(Debug, Clone)]
pub struct Eip712Domain {
    pub name: String,
    pub version: String,
    pub chain_id: u64,
    pub verifying_contract: Address,
}

impl Eip712Domain {
    /// Compute the EIP-712 domain separator.
    pub fn separator(&self) -> B256 {
        let type_hash = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
        );
        let name_hash = keccak256(self.name.as_bytes());
        let version_hash = keccak256(self.version.as_bytes());

        let mut buf = Vec::with_capacity(5 * 32);
        buf.extend_from_slice(type_hash.as_slice());
        buf.extend_from_slice(name_hash.as_slice());
        buf.extend_from_slice(version_hash.as_slice());
        buf.extend_from_slice(&U256::from(self.chain_id).to_be_bytes::<32>());
        buf.extend_from_slice(self.verifying_contract.into_word().as_slice());

        keccak256(&buf)
    }
}

pub fn eip712_digest(domain: &Eip712Domain, struct_hash: B256) -> B256 {
    let mut buf = Vec::with_capacity(2 + 32 + 32);
    buf.extend_from_slice(&[0x19, 0x01]);
    buf.extend_from_slice(domain.separator().as_slice());
    buf.extend_from_slice(struct_hash.as_slice());
    keccak256(&buf)
}

/// Sign a `VerifiedRequests` voucher (used by both deposit and withdrawal claim flows).
pub async fn sign_verified_request(
    signer: &PrivateKeySigner,
    domain: &Eip712Domain,
    request_id: U256,
    amount: U256,
    user: Address,
) -> Result<Vec<u8>> {
    let data = VerifiedRequests {
        requestId: request_id,
        user,
        amount,
    };
    let struct_hash = data.eip712_hash_struct();
    let digest = eip712_digest(domain, struct_hash);

    let sig = signer
        .sign_hash(&digest)
        .await
        .context("failed to sign VerifiedRequests")?;

    Ok(sig_to_bytes(&sig))
}

fn sig_to_bytes(sig: &alloy::primitives::PrimitiveSignature) -> Vec<u8> {
    let mut out = Vec::with_capacity(65);
    out.extend_from_slice(&sig.r().to_be_bytes::<32>());
    out.extend_from_slice(&sig.s().to_be_bytes::<32>());
    out.push(sig.v() as u8);
    out
}
