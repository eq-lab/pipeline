// spec: docs/references/backend.md#stellar-indexer-cursor-and-rpc-retention
use shared::log_mapper::LogMapper;

pub struct PolledRange {
    pub mappers: Vec<Box<dyn LogMapper>>,
    pub covered_to: u64,
}

pub fn commit_end(cursor: u64, requested_end: u64, covered_to: u64) -> Option<u64> {
    let end = requested_end.min(covered_to);
    (end >= cursor).then_some(end)
}

pub fn covered_to(requested_end: u64, latest_ledgers: impl IntoIterator<Item = u64>) -> u64 {
    latest_ledgers
        .into_iter()
        .fold(requested_end, std::cmp::Ord::min)
}
