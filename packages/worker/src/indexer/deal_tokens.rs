// spec: docs/references/backend.md#evm-dealtokenfactory-1485
use std::collections::HashMap;
use std::sync::RwLock;

use alloy::{primitives::Address, rpc::types::Log};
use anyhow::{bail, Result};

use shared::contract_logs_repo::DealRegistrationRow;

use super::deal_token_parsers::decode_deal_registered;
use super::poller::DynamicAddressSource;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DealTokenKind {
    Debt,
    Cargo,
}

impl DealTokenKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            DealTokenKind::Debt => "debt",
            DealTokenKind::Cargo => "cargo",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DealTokenInfo {
    pub loan_id: String,
    pub kind: DealTokenKind,
}

pub fn reject_core_collision(
    chain_id: i64,
    factory: Address,
    core: &[(&str, Address)],
) -> Result<()> {
    if let Some((role, _)) = core.iter().find(|(_, addr)| *addr == factory) {
        bail!(
            "CHAIN_{chain_id}_EVM_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS must not equal CHAIN_{chain_id}_EVM_INDEXER_{role} ({factory})"
        );
    }
    Ok(())
}

pub struct DealTokenRegistry {
    factory: Address,
    tokens: RwLock<HashMap<Address, DealTokenInfo>>,
}

impl DealTokenRegistry {
    pub fn new(factory: Address) -> Self {
        Self {
            factory,
            tokens: RwLock::new(HashMap::new()),
        }
    }

    pub fn factory(&self) -> Address {
        self.factory
    }

    pub fn lookup(&self, token: &Address) -> Option<DealTokenInfo> {
        self.tokens
            .read()
            .expect("deal token registry lock")
            .get(token)
            .cloned()
    }

    pub fn insert_deal(&self, loan_id: &str, debt: Address, cargo: Address) -> Vec<Address> {
        let mut tokens = self.tokens.write().expect("deal token registry lock");
        let mut added = Vec::new();
        for (addr, kind) in [(debt, DealTokenKind::Debt), (cargo, DealTokenKind::Cargo)] {
            if let std::collections::hash_map::Entry::Vacant(slot) = tokens.entry(addr) {
                slot.insert(DealTokenInfo {
                    loan_id: loan_id.to_owned(),
                    kind,
                });
                added.push(addr);
            }
        }
        added
    }

    pub fn seed(&self, rows: &[DealRegistrationRow]) -> usize {
        let mut inserted = 0;
        for row in rows {
            let parsed = (row.debt.parse::<Address>(), row.cargo.parse::<Address>());
            if let (Ok(debt), Ok(cargo)) = parsed {
                if !self.insert_deal(&row.loan_id, debt, cargo).is_empty() {
                    inserted += 1;
                }
            } else {
                tracing::warn!(
                    loan_id = %row.loan_id,
                    debt = %row.debt,
                    cargo = %row.cargo,
                    "skipping DealRegistered row with unparseable token address"
                );
            }
        }
        inserted
    }
}

impl DynamicAddressSource for DealTokenRegistry {
    fn addresses(&self) -> Vec<Address> {
        self.tokens
            .read()
            .expect("deal token registry lock")
            .keys()
            .copied()
            .collect()
    }

    fn observe(&self, log: &Log) -> Vec<Address> {
        if log.address() != self.factory {
            return vec![];
        }
        match decode_deal_registered(log) {
            Some((loan_id, debt, cargo)) => self.insert_deal(&loan_id.to_string(), debt, cargo),
            None => vec![],
        }
    }
}
