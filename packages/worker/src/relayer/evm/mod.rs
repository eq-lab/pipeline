//! EVM relayer: the chain-facing mirror of `relayer::stellar`.
//! See `docs/exec-plans/active/evm-relayer-v5.md`.

pub mod job;
pub mod whitelist;

pub use whitelist::{phase_sync_whitelist_evm, EvmWhitelister};
