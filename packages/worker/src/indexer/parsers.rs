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
pub fn parse_token_transfer(log: &Log) -> Option<TokenTransferEvent> {
    let decoded = Transfer::decode_log(log.as_ref(), true).ok()?;

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

#[cfg(test)]
mod tests {
    use alloy::{
        primitives::{address, b256, U256},
        rpc::types::Log,
    };

    use super::*;

    fn make_transfer_log(from: Address, to: Address, value: U256) -> Log {
        use alloy::{
            primitives::{FixedBytes, LogData},
            rpc::types::Log,
        };

        // topic0 = Transfer event selector
        let topic0 = Transfer::SIGNATURE_HASH;
        // topic1 = from (indexed, padded to 32 bytes)
        let topic1: FixedBytes<32> = from.into_word();
        // topic2 = to (indexed, padded to 32 bytes)
        let topic2: FixedBytes<32> = to.into_word();
        // data = value (non-indexed, ABI-encoded as 32 bytes)
        let mut data = [0u8; 32];
        data.copy_from_slice(&value.to_be_bytes::<32>());

        let inner = alloy::primitives::Log {
            address: address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            data: LogData::new(vec![topic0, topic1, topic2], data.into()).unwrap(),
        };

        Log {
            inner,
            block_number: Some(101),
            transaction_hash: Some(b256!(
                "1111111111111111111111111111111111111111111111111111111111111111"
            )),
            log_index: Some(0),
            ..Default::default()
        }
    }

    #[test]
    fn correct_log_decodes() {
        let from = address!("1111111111111111111111111111111111111111");
        let to = address!("2222222222222222222222222222222222222222");
        let value = U256::from(1000u64);

        let log = make_transfer_log(from, to, value);
        let ev = parse_token_transfer(&log).expect("should decode");

        assert_eq!(ev.from, from);
        assert_eq!(ev.to, to);
        assert_eq!(ev.value, value);
        assert_eq!(ev.block_number, 101);
    }

    #[test]
    fn wrong_topic0_returns_none() {
        use alloy::primitives::{FixedBytes, LogData};

        let inner = alloy::primitives::Log {
            address: address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            data: LogData::new(
                vec![FixedBytes::ZERO], // wrong topic0
                vec![].into(),
            )
            .unwrap(),
        };
        let log = Log {
            inner,
            ..Default::default()
        };

        assert!(parse_token_transfer(&log).is_none());
    }
}
