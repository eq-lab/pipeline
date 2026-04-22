use alloy::{primitives::Address, rpc::types::Log, sol, sol_types::SolEvent};

use shared::events::TokenTransferEvent;

sol! {
    event Transfer(address indexed from, address indexed to, uint256 value);
}

/// Decodes a raw ERC-20 Transfer log into a `TokenTransferEvent`.
/// Returns `None` if the log does not match the Transfer event signature.
///
/// Note: `block_timestamp` defaults to 0 and should be backfilled via a separate
/// block lookup when accurate timestamps are required (tracked in tech-debt).
pub fn parse_token_transfer(log: &Log, approved: &[Address]) -> Option<TokenTransferEvent> {
    let decoded = Transfer::decode_log(log.as_ref(), true).ok()?;

    if !approved.contains(&decoded.from) && !approved.contains(&decoded.to) {
        return None;
    }

    let contract_address: Address = log.address();
    let block_number = log.block_number?;
    let tx_hash = log.transaction_hash?;
    let log_index = log.log_index?;

    Some(TokenTransferEvent {
        contract_address,
        from: decoded.from,
        to: decoded.to,
        value: decoded.value,
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
    })
}
