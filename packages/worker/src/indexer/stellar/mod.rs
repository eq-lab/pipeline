/// Stellar/Soroban event indexer module.
///
/// Sub-modules:
/// - `rpc` — thin JSON-RPC wrapper around Soroban `getEvents` / `getLatestLedger`.
/// - `parsers` — pure XDR decoder functions for the five indexed non-loan events.
/// - `loan_registry_parsers` — pure XDR decoder functions for the 9 LoanRegistry events.
/// - `collateral_registry_parsers` — pure XDR decoder functions for the 11 CollateralRegistry events.
/// - `loan_registry_reader` — `StellarAddress` newtype + `StellarLoanRegistryReader` (resolver impls).
/// - `deal_token_factory_parsers` — deal-token-factory events, per-deal DEBT/CARGO movements, and the discovered token set.
/// - `mappers` — `StellarLogMapper` implementing `LogMapper`.
/// - `poller` — `StellarEventPoller` implementing `ChainEventPoller`, plus
///   `run_stellar_indexer_job`.
pub mod collateral_registry_parsers;
pub mod deal_token_factory_parsers;
pub mod loan_registry_parsers;
pub mod loan_registry_reader;
pub mod mappers;
pub mod minter_parsers;
pub mod parsers;
pub mod poller;
pub mod rpc;

pub use poller::run_stellar_indexer_job;
