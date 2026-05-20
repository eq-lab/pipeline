use alloy_primitives::{Address, B256, U256};
use bigdecimal::BigDecimal;

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
    pub assets: Option<U256>,
    pub shares: Option<U256>,
    // Position tracking (populated for StakingDeposit/StakingWithdrawal only)
    pub shares_balance: Option<BigDecimal>,
    pub avg_buy_share_price: Option<BigDecimal>,
    pub realized_pnl: Option<BigDecimal>,
}
