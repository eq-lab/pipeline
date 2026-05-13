use alloy::primitives::{Address, PrimitiveSignature, U256};
use alloy::signers::local::PrivateKeySigner;
use alloy::sol_types::SolStruct;
use shared::eip712::{eip712_digest, sign_verified_request, Eip712Domain, VerifiedRequests};

fn test_signer() -> PrivateKeySigner {
    "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        .parse()
        .unwrap()
}

fn deposit_domain() -> Eip712Domain {
    Eip712Domain {
        name: "PipelineDepositManager".to_owned(),
        version: "1".to_owned(),
        chain_id: 1,
        verifying_contract: "0x1234567890abcdef1234567890abcdef12345678"
            .parse()
            .unwrap(),
    }
}

fn withdrawal_domain() -> Eip712Domain {
    Eip712Domain {
        name: "PipelineWithdrawalQueue".to_owned(),
        version: "1".to_owned(),
        chain_id: 1,
        verifying_contract: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
            .parse()
            .unwrap(),
    }
}

fn recover(sig_bytes: &[u8], digest: &alloy::primitives::B256) -> Address {
    let parity = sig_bytes[64] != 0;
    let sig = PrimitiveSignature::from_bytes_and_parity(&sig_bytes[..64], parity);
    sig.recover_address_from_prehash(digest).unwrap()
}

#[tokio::test]
async fn sign_and_recover_deposit_voucher() {
    let signer = test_signer();
    let domain = deposit_domain();
    let request_id = U256::from(42);
    let amount = U256::from(1_000_000);
    let user: Address = "0x1111111111111111111111111111111111111111"
        .parse()
        .unwrap();

    let sig_bytes = sign_verified_request(&signer, &domain, request_id, amount, user)
        .await
        .unwrap();
    assert_eq!(sig_bytes.len(), 65);

    let data = VerifiedRequests {
        requestId: request_id,
        user,
        amount,
    };
    let digest = eip712_digest(&domain, data.eip712_hash_struct());
    assert_eq!(recover(&sig_bytes, &digest), signer.address());
}

#[tokio::test]
async fn sign_and_recover_withdrawal_voucher() {
    let signer = test_signer();
    let domain = withdrawal_domain();
    let request_id = U256::from(7);
    let amount = U256::from(5_000_000);
    let user: Address = "0x2222222222222222222222222222222222222222"
        .parse()
        .unwrap();

    let sig_bytes = sign_verified_request(&signer, &domain, request_id, amount, user)
        .await
        .unwrap();
    assert_eq!(sig_bytes.len(), 65);

    let data = VerifiedRequests {
        requestId: request_id,
        user,
        amount,
    };
    let digest = eip712_digest(&domain, data.eip712_hash_struct());
    assert_eq!(recover(&sig_bytes, &digest), signer.address());
}

#[test]
fn domain_separator_is_deterministic() {
    let d1 = deposit_domain();
    let d2 = deposit_domain();
    assert_eq!(d1.separator(), d2.separator());
}

#[test]
fn different_domains_produce_different_separators() {
    let d1 = deposit_domain();
    let d2 = withdrawal_domain();
    assert_ne!(d1.separator(), d2.separator());
}
