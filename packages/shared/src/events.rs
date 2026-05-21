use alloy_primitives::{Address, B256};

pub struct ContractLog {
    pub contract_address: Address,
    pub event_name: String,
    pub block_number: u64,
    pub tx_hash: B256,
    pub log_index: u64,
    pub block_timestamp: u64,
    /// Event-specific data. Replaces the former individual nullable columns
    /// (sender, receiver, amount, request_id, cumulative, assets, shares,
    ///  shares_balance, avg_buy_share_price, realized_pnl).
    pub params: serde_json::Value,
}
