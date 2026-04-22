use alloy_primitives::{Address, B256, U256};

pub struct TokenTransferEvent {
    pub contract_address: Address,
    pub from: Address,
    pub to: Address,
    pub value: U256,
    pub block_number: u64,
    pub tx_hash: B256,
    pub log_index: u64,
    pub block_timestamp: u64,
}
