#![allow(dead_code)]
use alloy::{
    primitives::{address, b256, Address, FixedBytes, LogData, U256},
    rpc::types::Log,
    sol,
    sol_types::SolEvent,
};

sol! {
    event DealRegistered(uint256 indexed loanId, address debt, address cargo);
    event DebtSynced(uint256 indexed loanId, uint256 target, uint256 previous, uint256 minted, uint256 clawed);
    event CargoSynced(uint256 indexed loanId, uint256 target, uint256 previous, uint256 minted, uint256 burned);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event WireInRecorded(uint256 indexed id, address indexed receiver, uint256 amount, uint64 valueDate, bytes32 refHash);
}

pub const FACTORY: Address = address!("fa00000000000000000000000000000000000001");
pub const DEBT: Address = address!("de00000000000000000000000000000000000001");
pub const CARGO: Address = address!("ca00000000000000000000000000000000000001");
pub const HOLDER: Address = address!("1111111111111111111111111111111111111111");
pub const SPLUSD: Address = address!("5000000000000000000000000000000000000001");
pub const TX_HASH: FixedBytes<32> =
    b256!("1111111111111111111111111111111111111111111111111111111111111111");

pub fn make_log(address: Address, data: LogData, block: u64, index: u64) -> Log {
    Log {
        inner: alloy::primitives::Log { address, data },
        block_number: Some(block),
        transaction_hash: Some(TX_HASH),
        log_index: Some(index),
        ..Default::default()
    }
}

pub fn deal_registered(loan: U256, debt: Address, cargo: Address, block: u64, idx: u64) -> Log {
    let ev = DealRegistered {
        loanId: loan,
        debt,
        cargo,
    };
    make_log(FACTORY, ev.encode_log_data(), block, idx)
}

pub fn debt_synced(loan: U256, minted: u64, clawed: u64, block: u64, idx: u64) -> Log {
    let ev = DebtSynced {
        loanId: loan,
        target: U256::from(minted),
        previous: U256::ZERO,
        minted: U256::from(minted),
        clawed: U256::from(clawed),
    };
    make_log(FACTORY, ev.encode_log_data(), block, idx)
}

pub fn cargo_synced(loan: U256, minted: u64, burned: u64, block: u64, idx: u64) -> Log {
    let ev = CargoSynced {
        loanId: loan,
        target: U256::from(minted),
        previous: U256::ZERO,
        minted: U256::from(minted),
        burned: U256::from(burned),
    };
    make_log(FACTORY, ev.encode_log_data(), block, idx)
}

pub fn transfer(
    token: Address,
    from: Address,
    to: Address,
    value: u64,
    block: u64,
    idx: u64,
) -> Log {
    let ev = Transfer {
        from,
        to,
        value: U256::from(value),
    };
    make_log(token, ev.encode_log_data(), block, idx)
}

pub fn wire_in(block: u64, idx: u64) -> Log {
    let ev = WireInRecorded {
        id: U256::from(1u64),
        receiver: HOLDER,
        amount: U256::from(5u64),
        valueDate: 0,
        refHash: FixedBytes::ZERO,
    };
    make_log(FACTORY, ev.encode_log_data(), block, idx)
}
