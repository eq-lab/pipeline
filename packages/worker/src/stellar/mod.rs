//! Chain-protocol-level helpers shared across Stellar/Soroban jobs.
//!
//! This module consolidates helpers that are needed by two or more Stellar jobs
//! (indexer, relayer, price-poller) so each job can import from a single shared
//! location without cross-importing from a sibling job's namespace.
//!
//! - `tx`    — Soroban transaction envelope construction and signing.
//!   Promoted from `relayer/stellar/tx.rs` (Issue #568).
//! - `scval` — Generic `ScVal` decoders (e.g. `extract_i128`).
//!   Promoted from `indexer/stellar/parsers.rs` (Issue #568).
//!   Indexer-specific log-shape parsers remain in `indexer/stellar/parsers.rs`.

pub mod scval;
pub mod tx;
