use alloy_primitives::{Address, B256, U256};

pub struct ContractLog {
    pub contract_address: Address,
    pub event_name: String,
    pub block_number: u64,
    pub tx_hash: B256,
    pub log_index: u64,
    pub block_timestamp: u64,
    pub sender: Option<Address>,
    pub receiver: Option<Address>,
    pub amount: Option<U256>,
    pub request_id: Option<U256>,
    pub cumulative: Option<U256>,
}
