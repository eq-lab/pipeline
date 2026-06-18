use std::sync::Arc;

use alloy::primitives::{Address, U256};

use shared::{contract_logs_repo::ContractLogsRepo, db::EventRepo};

use super::{
    loan_mapper::{LoanEvent, LoanEventMapper},
    loan_metadata::{ImmutableDataResolver, LoanMetadataFetcher, MutableDataResolver},
    mappers::ContractLogMapper,
    parsers::{
        parse_deposit_requested, parse_economics_amended, parse_loan_ccr_updated,
        parse_loan_closed, parse_loan_defaulted, parse_loan_drawn, parse_loan_location_updated,
        parse_loan_rolled_over, parse_loan_status_updated, parse_payment_recorded,
        parse_request_claimed, parse_staking_deposit, parse_staking_withdraw,
        parse_withdrawal_requested, parse_yield_minted,
    },
    poller::EvmEventPollerBuilder,
};

/// EVM contract addresses for a single chain.
pub struct EvmContractAddresses {
    pub dm_contracts: Vec<Address>,
    pub wq_contracts: Vec<Address>,
    pub splusd_contracts: Vec<Address>,
    pub loan_registry_contracts: Vec<Address>,
    pub yield_minter_contracts: Vec<Address>,
}

/// Shared DB repositories used by EVM event handlers.
pub struct EvmRepos {
    pub repo: Arc<EventRepo>,
    pub contract_logs_repo: Arc<ContractLogsRepo>,
}

/// Dependencies for loan event mappers.
pub struct EvmLoanDeps {
    pub fetcher: Arc<dyn LoanMetadataFetcher>,
    pub immutable_resolver: Arc<dyn ImmutableDataResolver<Address, U256>>,
    pub mutable_resolver: Arc<dyn MutableDataResolver<Address, U256>>,
}

/// Register all EVM event handlers for a single chain onto the given builder.
///
/// This function groups the parser registration that was previously inline in
/// `run_indexer_job` into a reusable, EVM-tagged function. The underlying
/// `parse_*` free functions in `parsers.rs` are unchanged so `tests/parsers.rs`
/// continues to work without modification.
pub fn register_evm_handlers(
    builder: EvmEventPollerBuilder,
    chain_id: i64,
    contracts: EvmContractAddresses,
    repos: EvmRepos,
    loan_deps: EvmLoanDeps,
) -> EvmEventPollerBuilder {
    let dm_repo = repos.repo.clone();
    let wq_repo = repos.repo.clone();
    let splusd_repo = repos.repo.clone();
    let loan_event_repo = repos.repo.clone();
    let yield_minter_repo = repos.repo.clone();

    let contract_logs_repo = repos.contract_logs_repo;
    let fetcher = loan_deps.fetcher;
    let immutable_resolver = loan_deps.immutable_resolver;
    let mutable_resolver = loan_deps.mutable_resolver;

    builder
        .add_event_handler(contracts.dm_contracts, move |log| {
            parse_deposit_requested(log)
                .or_else(|| parse_request_claimed(log))
                .map(|ev| {
                    Box::new(ContractLogMapper::new(ev, chain_id, dm_repo.clone()))
                        as Box<dyn shared::log_mapper::LogMapper>
                })
        })
        .add_event_handler(contracts.wq_contracts, move |log| {
            parse_withdrawal_requested(log)
                .or_else(|| parse_request_claimed(log))
                .map(|ev| {
                    Box::new(ContractLogMapper::new(ev, chain_id, wq_repo.clone()))
                        as Box<dyn shared::log_mapper::LogMapper>
                })
        })
        .add_event_handler(contracts.splusd_contracts, move |log| {
            parse_staking_deposit(log)
                .or_else(|| parse_staking_withdraw(log))
                .map(|ev| {
                    Box::new(
                        ContractLogMapper::new(ev, chain_id, splusd_repo.clone())
                            .with_position_tracking(),
                    ) as Box<dyn shared::log_mapper::LogMapper>
                })
        })
        .add_event_handler(contracts.loan_registry_contracts, move |log| {
            parse_loan_drawn(log)
                .or_else(|| parse_loan_defaulted(log))
                .or_else(|| parse_loan_closed(log))
                .or_else(|| parse_payment_recorded(log))
                .or_else(|| parse_loan_status_updated(log))
                .or_else(|| parse_loan_ccr_updated(log))
                .or_else(|| parse_loan_location_updated(log))
                .or_else(|| parse_loan_rolled_over(log))
                .or_else(|| parse_economics_amended(log))
                .map(|ev| -> Box<dyn shared::log_mapper::LogMapper> {
                    Box::new(LoanEventMapper::<Address, U256>::new(
                        LoanEvent {
                            contract_address: ev.contract_address,
                            event_name: ev.event_name,
                            block_number: ev.block_number,
                            tx_hash: format!("{:#x}", ev.tx_hash),
                            log_index: ev.log_index,
                            block_timestamp: ev.block_timestamp,
                            params: ev.params,
                        },
                        chain_id,
                        loan_event_repo.clone(),
                        contract_logs_repo.clone(),
                        fetcher.clone(),
                        immutable_resolver.clone(),
                        mutable_resolver.clone(),
                    ))
                })
        })
        .add_event_handler(contracts.yield_minter_contracts, move |log| {
            parse_yield_minted(log).map(|ev| {
                Box::new(ContractLogMapper::new(
                    ev,
                    chain_id,
                    yield_minter_repo.clone(),
                )) as Box<dyn shared::log_mapper::LogMapper>
            })
        })
}
