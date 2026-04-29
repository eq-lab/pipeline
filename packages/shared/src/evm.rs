use alloy_primitives::Address;

pub fn parse_address(wallet: &str) -> Option<Address> {
    match wallet.parse() {
        Ok(addr) => Some(addr),
        Err(e) => {
            tracing::error!(wallet, error = %e, "invalid wallet address, skipping");
            None
        }
    }
}
