use alloy::primitives::{Address, U256};
use alloy::sol_types::SolValue;
use pipeline_worker::price_poller::align_to_grid;
use pipeline_worker::price_poller::evm::poller::{decode_asset, decode_decimals};

#[test]
fn test_align_to_grid() {
    // origin=100, interval=300
    assert_eq!(align_to_grid(100, 100, 300), 100);
    assert_eq!(align_to_grid(101, 100, 300), 400);
    assert_eq!(align_to_grid(399, 100, 300), 400);
    assert_eq!(align_to_grid(400, 100, 300), 400);
    assert_eq!(align_to_grid(401, 100, 300), 700);
    assert_eq!(align_to_grid(50, 100, 300), 100);
}

#[test]
fn decode_decimals_reads_uint8() {
    assert_eq!(decode_decimals(&U256::from(6u8).abi_encode()).unwrap(), 6);
    assert_eq!(decode_decimals(&U256::from(18u8).abi_encode()).unwrap(), 18);
}

#[test]
fn decode_decimals_rejects_short_return() {
    assert!(decode_decimals(&[0u8; 31]).is_err());
    assert!(decode_decimals(&[]).is_err());
}

#[test]
fn decode_asset_reads_address() {
    let addr: Address = "0x87CD1002bdB9401423cb50A860314FC8f11440Cd"
        .parse()
        .unwrap();
    assert_eq!(decode_asset(&addr.abi_encode()).unwrap(), addr);
}

#[test]
fn decode_asset_rejects_empty_return() {
    assert!(decode_asset(&[]).is_err());
}
