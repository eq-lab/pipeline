use std::collections::HashMap;

/// Trait abstracting the event polling loop over a chain.
///
/// The EVM implementation (`EvmEventPoller`) uses `u64` cursors that correspond to
/// block numbers. For a future Stellar implementation, cursors would correspond to
/// ledger sequence numbers — also `u64` — so the cursor type is unchanged.
///
/// # Stellar mapping convention (doc comment only — no code change needed yet)
///
/// When a Stellar poller is implemented, it should map:
/// - `ledger_sequence` → `block_number` (the cursor)
/// - operation order within a transaction → synthesised `log_index`
/// - ledger close time → block timestamp
///
/// The trait shape is intentionally kept simple around the EVM call sites.
/// Refactor the trait when the Stellar impl actually lands; speculating now
/// risks the wrong abstraction.
#[async_trait::async_trait]
pub trait ChainEventPoller: Send + Sync {
    /// Latest finalised cursor on the source chain.
    /// For EVM: the current head block number.
    /// For Stellar: the latest closed ledger sequence.
    async fn get_latest_block(&self) -> anyhow::Result<u64>;

    /// Poll all decoded events in `[from, to]` (inclusive) as `LogMapper` boxes.
    /// Each `LogMapper` is a fully-parsed, chain-aware event ready to persist.
    async fn poll(
        &self,
        from: u64,
        to: u64,
    ) -> anyhow::Result<Vec<Box<dyn shared::log_mapper::LogMapper>>>;

    /// Per-event timestamp enrichment.
    /// For EVM: fetches the block header via `eth_getBlockByNumber` and caches
    /// the result in `cache` to avoid duplicate RPC calls per cycle.
    /// For Stellar: returns the ledger close time for the given ledger sequence.
    async fn get_block_timestamp(
        &self,
        block_number: u64,
        cache: &mut HashMap<u64, u64>,
    ) -> anyhow::Result<u64>;
}
