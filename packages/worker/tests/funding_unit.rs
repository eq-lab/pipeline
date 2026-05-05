#[cfg(test)]
mod tests {
    use alloy::primitives::U256;
    use bigdecimal::BigDecimal;

    use pipeline_worker::relayer::funding::bigdecimal_to_u256;

    #[test]
    fn bigdecimal_to_u256_works() {
        let bd = BigDecimal::from(1_000_000u64);
        let u = bigdecimal_to_u256(&bd).unwrap();
        assert_eq!(u, U256::from(1_000_000u64));
    }

    #[test]
    fn bigdecimal_to_u256_large_value() {
        let bd = BigDecimal::from(5_000_000u64) * BigDecimal::from(1_000_000u64);
        let u = bigdecimal_to_u256(&bd).unwrap();
        assert_eq!(u, U256::from(5_000_000_000_000u64));
    }
}
