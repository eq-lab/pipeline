/// Stellar/Soroban event indexer module.
///
/// Sub-modules:
/// - `rpc` — thin JSON-RPC wrapper around Soroban `getEvents` / `getLatestLedger`.
/// - `parsers` — pure XDR decoder functions for the five indexed events.
/// - `mappers` — `StellarLogMapper` implementing `LogMapper`.
/// - `poller` — `StellarEventPoller` implementing `ChainEventPoller`, plus
///   `run_stellar_indexer_job`.
pub mod mappers;
pub mod parsers;
pub mod poller;
pub mod rpc;

pub use poller::run_stellar_indexer_job;
