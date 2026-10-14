use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use alloy::{
    primitives::Address,
    providers::{Provider, ProviderBuilder},
    rpc::types::{Filter, Log},
    transports::http::Http,
};
use anyhow::Result;
use reqwest::Client;

use shared::log_mapper::LogMapper;

use super::chain_poller::ChainEventPoller;

type HttpProvider = alloy::providers::RootProvider<Http<Client>>;
type DecodeFn = Box<dyn Fn(&alloy::rpc::types::Log) -> Option<Box<dyn LogMapper>> + Send + Sync>;

pub trait DynamicAddressSource: Send + Sync {
    fn addresses(&self) -> Vec<Address>;
    fn observe(&self, log: &Log) -> Vec<Address>;
}

#[async_trait::async_trait]
pub trait LogFetcher: Send + Sync {
    async fn get_logs(&self, addresses: Vec<Address>, from: u64, to: u64) -> Result<Vec<Log>>;
}

struct ProviderLogFetcher(HttpProvider);

#[async_trait::async_trait]
impl LogFetcher for ProviderLogFetcher {
    async fn get_logs(&self, addresses: Vec<Address>, from: u64, to: u64) -> Result<Vec<Log>> {
        let filter = Filter::new()
            .address(addresses)
            .from_block(from)
            .to_block(to);
        Ok(self.0.get_logs(&filter).await?)
    }
}

pub const MAX_DYNAMIC_ADDRESSES_PER_REQUEST: usize = 25;

async fn fetch_dynamic_batches(
    fetcher: &dyn LogFetcher,
    addresses: &[Address],
    from: u64,
    to: u64,
) -> Result<Vec<Log>> {
    let mut logs = Vec::new();
    for batch in addresses.chunks(MAX_DYNAMIC_ADDRESSES_PER_REQUEST) {
        logs.extend(fetcher.get_logs(batch.to_vec(), from, to).await?);
    }
    Ok(logs)
}

pub async fn fetch_chunk_logs(
    fetcher: &dyn LogFetcher,
    static_addresses: &[Address],
    sources: &[Arc<dyn DynamicAddressSource>],
    from: u64,
    to: u64,
) -> Result<Vec<Log>> {
    let mut seen: HashSet<Address> = HashSet::new();
    let core: Vec<Address> = static_addresses
        .iter()
        .copied()
        .filter(|a| seen.insert(*a))
        .collect();
    let dynamic: Vec<Address> = sources
        .iter()
        .flat_map(|s| s.addresses())
        .filter(|a| seen.insert(*a))
        .collect();

    let mut logs = if core.is_empty() {
        vec![]
    } else {
        fetcher.get_logs(core, from, to).await?
    };
    logs.extend(fetch_dynamic_batches(fetcher, &dynamic, from, to).await?);

    if !sources.is_empty() {
        let mut discovered: Vec<Address> = Vec::new();
        for log in logs.iter().filter(|l| !l.removed) {
            for source in sources {
                for addr in source.observe(log) {
                    if seen.insert(addr) {
                        discovered.push(addr);
                    }
                }
            }
        }
        if !discovered.is_empty() {
            logs.extend(fetch_dynamic_batches(fetcher, &discovered, from, to).await?);
        }
    }

    logs.sort_by_key(|l| {
        (
            l.block_number.unwrap_or(u64::MAX),
            l.log_index.unwrap_or(u64::MAX),
        )
    });
    Ok(logs)
}

pub struct HandlerEntry {
    pub addresses: Vec<Address>,
    pub decode: DecodeFn,
}

pub struct EvmEventPoller {
    provider: HttpProvider,
    handlers: Vec<HandlerEntry>,
    dynamic_sources: Vec<Arc<dyn DynamicAddressSource>>,
    block_range: u64,
    interval_ms: u64,
}

pub struct EvmEventPollerBuilder {
    provider: HttpProvider,
    handlers: Vec<HandlerEntry>,
    dynamic_sources: Vec<Arc<dyn DynamicAddressSource>>,
    block_range: u64,
    interval_ms: u64,
}

impl EvmEventPollerBuilder {
    pub fn new(rpc_url: &str, block_range: u64, interval_ms: u64) -> Self {
        let provider = ProviderBuilder::new().on_http(rpc_url.parse().expect("valid RPC URL"));
        Self {
            provider,
            handlers: vec![],
            dynamic_sources: vec![],
            block_range,
            interval_ms,
        }
    }

    /// Register a handler for a specific event type.
    /// `decode_fn` receives a raw log and returns `Some(Box<dyn LogMapper>)` on match, `None` otherwise.
    /// The block timestamp is injected after matching via `LogMapper::set_block_timestamp`.
    pub fn add_event_handler(
        mut self,
        addresses: Vec<Address>,
        decode_fn: impl Fn(&alloy::rpc::types::Log) -> Option<Box<dyn LogMapper>>
            + Send
            + Sync
            + 'static,
    ) -> Self {
        self.handlers.push(HandlerEntry {
            addresses,
            decode: Box::new(decode_fn),
        });
        self
    }

    pub fn add_dynamic_address_source(mut self, source: Arc<dyn DynamicAddressSource>) -> Self {
        self.dynamic_sources.push(source);
        self
    }

    pub fn build(self) -> EvmEventPoller {
        EvmEventPoller {
            provider: self.provider,
            handlers: self.handlers,
            dynamic_sources: self.dynamic_sources,
            block_range: self.block_range,
            interval_ms: self.interval_ms,
        }
    }
}

impl EvmEventPoller {
    pub async fn get_latest_block(&self) -> Result<u64> {
        Ok(self.provider.get_block_number().await?)
    }

    /// Fetches all matching logs for `[from_block, to_block]` in `block_range`-sized chunks.
    /// Each log is offered to every registered handler in order; the first match wins.
    /// Logs with `removed = true` (reorg) are skipped.
    /// Block timestamps are fetched via `eth_getBlockByNumber` and cached per block number.
    pub async fn poll(&self, from_block: u64, to_block: u64) -> Result<Vec<Box<dyn LogMapper>>> {
        let static_addresses: Vec<Address> = self
            .handlers
            .iter()
            .flat_map(|h| h.addresses.iter().copied())
            .collect();

        let fetcher = ProviderLogFetcher(self.provider.clone());
        let mut result: Vec<Box<dyn LogMapper>> = vec![];
        let mut current = from_block;

        while current <= to_block {
            let chunk_end = (current + self.block_range - 1).min(to_block);

            let logs = fetch_chunk_logs(
                &fetcher,
                &static_addresses,
                &self.dynamic_sources,
                current,
                chunk_end,
            )
            .await?;

            for log in &logs {
                if log.removed {
                    continue;
                }

                for handler in &self.handlers {
                    if let Some(mapper) = (handler.decode)(log) {
                        result.push(mapper);
                        break;
                    }
                }
            }

            tokio::time::sleep(Duration::from_millis(self.interval_ms)).await;
            current = chunk_end + 1;
        }

        Ok(result)
    }

    pub async fn get_block_timestamp(
        &self,
        block_number: u64,
        cache: &mut HashMap<u64, u64>,
    ) -> Result<u64> {
        if let Some(&ts) = cache.get(&block_number) {
            return Ok(ts);
        }

        let block = self
            .provider
            .get_block_by_number(block_number.into(), false.into())
            .await?
            .ok_or_else(|| anyhow::anyhow!("block {block_number} not found"))?;

        let ts = block.header.timestamp;
        cache.insert(block_number, ts);
        Ok(ts)
    }
}

#[async_trait::async_trait]
impl ChainEventPoller for EvmEventPoller {
    async fn get_latest_block(&self) -> Result<u64> {
        self.get_latest_block().await
    }

    async fn poll(&self, from: u64, to: u64) -> Result<Vec<Box<dyn LogMapper>>> {
        self.poll(from, to).await
    }

    async fn get_block_timestamp(
        &self,
        block_number: u64,
        cache: &mut HashMap<u64, u64>,
    ) -> Result<u64> {
        self.get_block_timestamp(block_number, cache).await
    }
}
