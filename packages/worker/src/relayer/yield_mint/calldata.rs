use alloy::hex;
use alloy::primitives::U256;
use alloy::sol;
use alloy::sol_types::SolCall;

sol! {
    function mintYield(uint256 loanId, uint256 repaymentId);
}

/// Produce the `"0x"` + hex-encoded 68-byte calldata for
/// `mintYield(loanId, repaymentId)`.
///
/// Layout: 4-byte selector | 32-byte loanId | 32-byte repaymentId = 68 bytes.
pub fn encode_mint_yield(loan_id: U256, repayment_id: U256) -> String {
    let bytes = mintYieldCall {
        loanId: loan_id,
        repaymentId: repayment_id,
    }
    .abi_encode();
    format!("0x{}", hex::encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::keccak256;

    /// The selector is the first 4 bytes of keccak256("mintYield(uint256,uint256)").
    const EXPECTED_SELECTOR: [u8; 4] = {
        // keccak256("mintYield(uint256,uint256)") = 0xbe14169e...
        [0xbe, 0x14, 0x16, 0x9e]
    };

    #[test]
    fn encode_mint_yield_produces_expected_selector() {
        // Dynamically verify: keccak256 of the canonical sig must match our constant.
        let hash = keccak256(b"mintYield(uint256,uint256)");
        assert_eq!(
            hash[..4],
            EXPECTED_SELECTOR,
            "selector mismatch — update EXPECTED_SELECTOR"
        );

        let encoded = encode_mint_yield(U256::ZERO, U256::ZERO);
        let bytes = hex::decode(&encoded[2..]).expect("valid hex");
        assert_eq!(
            bytes[..4],
            EXPECTED_SELECTOR,
            "encoded calldata selector mismatch"
        );
    }

    #[test]
    fn encode_mint_yield_packs_args_correctly() {
        // mintYield(42, 3)
        // selector: 0x84b0196e
        // loanId:   0x000...002a  (42 in 32 bytes)
        // repaymentId: 0x000...0003  (3 in 32 bytes)
        let encoded = encode_mint_yield(U256::from(42u64), U256::from(3u64));
        let bytes = hex::decode(&encoded[2..]).expect("valid hex");

        assert_eq!(bytes.len(), 68, "calldata must be 68 bytes");
        // selector
        assert_eq!(&bytes[..4], &EXPECTED_SELECTOR);
        // loanId: 32 bytes, big-endian, value 42
        assert_eq!(&bytes[4..36], &{
            let mut b = [0u8; 32];
            b[31] = 42;
            b
        });
        // repaymentId: 32 bytes, big-endian, value 3
        assert_eq!(&bytes[36..68], &{
            let mut b = [0u8; 32];
            b[31] = 3;
            b
        });
    }

    #[test]
    fn encode_mint_yield_handles_max_uint256() {
        let encoded = encode_mint_yield(U256::MAX, U256::MAX);
        let bytes = hex::decode(&encoded[2..]).expect("valid hex");
        assert_eq!(bytes.len(), 68, "max U256 calldata must still be 68 bytes");
    }
}
