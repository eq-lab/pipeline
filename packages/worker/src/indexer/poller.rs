use std::time::Duration;

use alloy::{
    primitives::Address,
    providers::{Provider, ProviderBuilder},
    rpc::types::Filter,
    transports::http::Http,
};
use anyhow::Result;
use reqwest::Client;

use shared::log_mapper::LogMapper;

type HttpProvider = alloy::providers::RootProvider<Http<Client>>;
type DecodeFn = Box<dyn Fn(&alloy::rpc::types::Log) -> Option<Box<dyn LogMapper>> + Send + Sync>;

pub struct HandlerEntry {
    pub addresses: Vec<Address>,
    pub decode: DecodeFn,
}

pub struct EvmEventPoller {
    provider: HttpProvider,
    handlers: Vec<HandlerEntry>,
    block_range: u64,
    interval_ms: u64,
}

pub struct EvmEventPollerBuilder {
    provider: HttpProvider,
    handlers: Vec<HandlerEntry>,
    block_range: u64,
    interval_ms: u64,
}

impl EvmEventPollerBuilder {
    pub fn new(rpc_url: &str, block_range: u64, interval_ms: u64) -> Self {
        let provider = ProviderBuilder::new().on_http(rpc_url.parse().expect("valid RPC URL"));
        Self {
            provider,
            handlers: vec![],
            block_range,
            interval_ms,
        }
    }

    /// Register a handler for a specific event type.
    /// `decode_fn` receives a raw log and returns `Some(Box<dyn LogMapper>)` on match, `None` otherwise.
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

    pub fn build(self) -> EvmEventPoller {
        EvmEventPoller {
            provider: self.provider,
            handlers: self.handlers,
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
    pub async fn poll(&self, from_block: u64, to_block: u64) -> Result<Vec<Box<dyn LogMapper>>> {
        let all_addresses: Vec<Address> = self
            .handlers
            .iter()
            .flat_map(|h| h.addresses.iter().cloned())
            .collect();

        let mut result: Vec<Box<dyn LogMapper>> = vec![];
        let mut current = from_block;

        while current <= to_block {
            let chunk_end = (current + self.block_range - 1).min(to_block);

            let filter = Filter::new()
                .address(all_addresses.clone())
                .from_block(current)
                .to_block(chunk_end);

            let logs = self.provider.get_logs(&filter).await?;

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
}
