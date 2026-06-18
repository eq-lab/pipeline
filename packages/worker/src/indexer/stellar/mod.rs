/// Stellar/Soroban event indexer module.
///
/// Sub-modules:
/// - `rpc` — thin JSON-RPC wrapper around Soroban `getEvents` / `getLatestLedger`.
/// - `parsers` — pure XDR decoder functions for the five indexed non-loan events.
/// - `loan_registry_parsers` — pure XDR decoder functions for the 9 LoanRegistry events.
/// - `loan_registry_reader` — `StellarAddress` newtype + `StellarLoanRegistryReader` (resolver impls).
/// - `mappers` — `StellarLogMapper` implementing `LogMapper`.
/// - `poller` — `StellarEventPoller` implementing `ChainEventPoller`, plus
///   `run_stellar_indexer_job`.
pub mod loan_registry_parsers;
pub mod loan_registry_reader;
pub mod mappers;
pub mod parsers;
pub mod poller;
pub mod rpc;

pub use poller::run_stellar_indexer_job;
