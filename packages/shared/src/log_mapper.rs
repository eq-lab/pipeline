use async_trait::async_trait;
use sqlx::PgConnection;

#[async_trait]
pub trait LogMapper: Send + Sync {
    /// Returns true if this event already exists in the DB (dedup check).
    /// Implementations may also return true to signal the event should be skipped
    /// (e.g. zero-value transfers).
    async fn is_duplicate(&self, conn: &mut PgConnection) -> anyhow::Result<bool>;

    /// Inserts this event into the DB. Called only when is_duplicate returns false.
    async fn insert(&self, conn: &mut PgConnection) -> anyhow::Result<()>;

    /// Returns the block number of the underlying event.
    fn block_number(&self) -> u64;

    /// Sets the block timestamp (Unix seconds) on the underlying event.
    /// Called right before insert, once the timestamp has been fetched from the RPC.
    fn set_block_timestamp(&mut self, ts: u64);
}
