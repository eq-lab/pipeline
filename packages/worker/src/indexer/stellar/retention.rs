// spec: docs/references/backend.md#stellar-indexer-cursor-and-rpc-retention
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CursorBelowRetention {
    pub chain_id: i64,
    pub cursor: u64,
    pub oldest_ledger: u64,
    pub missing_ledgers: u64,
}

impl fmt::Display for CursorBelowRetention {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "stellar indexer cursor {} (chain {}) is below RPC retention (oldest ledger {}, {} ledgers missing)",
            self.cursor, self.chain_id, self.oldest_ledger, self.missing_ledgers
        )
    }
}

impl std::error::Error for CursorBelowRetention {}

pub fn retention_gap(
    chain_id: i64,
    cursor: u64,
    oldest_ledger: u64,
) -> Option<CursorBelowRetention> {
    (cursor < oldest_ledger).then(|| CursorBelowRetention {
        chain_id,
        cursor,
        oldest_ledger,
        missing_ledgers: oldest_ledger - cursor,
    })
}
