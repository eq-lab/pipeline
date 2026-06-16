//! Stellar/Soroban relayer module.
//!
//! Per-chain dispatch in `worker/main.rs` routes Stellar chains here. The job
//! runs Phase 0 (profile population) and Phase 3 (whitelist sync via the
//! access-manager's `execute(set_authorized)` entrypoint). See
//! `docs/exec-plans/active/issue-562-stellar-soroban-whitelist.md`.

pub mod job;
pub mod tx;
pub mod whitelist;

pub use whitelist::{phase_sync_whitelist_stellar, StellarWhitelister};
