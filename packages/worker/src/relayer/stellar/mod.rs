//! Stellar/Soroban relayer module.
//!
//! Per-chain dispatch in `worker/main.rs` routes Stellar chains here. The job
//! runs Phase 0 (profile population) and Phase 3 (whitelist sync via the
//! access-manager's `execute(set_authorized)` entrypoint). See
//! `docs/exec-plans/active/issue-562-stellar-soroban-whitelist.md`.
//!
//! Note: tx helpers were promoted to `crate::stellar::tx` (Issue #568) and are
//! re-exported from there. `pub mod tx` is removed; existing call sites in this
//! module use `crate::stellar::tx::*` directly.

pub mod job;
pub mod sim_decode;
pub mod whitelist;
pub mod yield_mint;

pub use whitelist::{phase_sync_whitelist_stellar, StellarWhitelister};
