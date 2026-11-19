// spec: docs/references/access-manager-events.md#evm-encoding
#![allow(dead_code, unused_imports)]
#[path = "../access_manager_support/mod.rs"]
mod access_manager_support;
pub use access_manager_support::*;

use alloy::{
    primitives::{address, hex, Address, LogData, B256, I256, U256},
    rpc::types::Log,
    sol,
    sol_types::SolCall,
};
use pipeline_worker::indexer::access_manager_evm_parsers::{hash_operation, EvmTargets};
use pipeline_worker::indexer::access_manager_evm_sync::EvmAmSyncConfig;
use serde_json::json;
use shared::access_manager_repo::AmLogRow;

sol! {
    struct Terms {
        uint32 advanceRatioBps;
        uint32 marginCallRatioBps;
        uint32 defaultRatioBps;
        uint64 curePeriod;
        uint64 priceStaleAfter;
        uint8 paymentTerm;
        uint64 gracePeriod;
        uint32 defaultRate;
        uint32 originatorFeeRate;
        uint64 attestationInterval;
        uint64 inspectionInterval;
        uint32 toleranceBps;
        uint32 gradeToleranceBps;
        uint64 marginCallAt;
        uint64 defaultBreachAt;
    }

    function setDefault(uint256 loanId);
    function upgradeToAndCall(address newImplementation, bytes data);
    function cure(uint256 loanId);
    function amendEconomics(uint256 loanId, uint32 newRate, uint64 newMaturityTimestamp);
    function adjustInterest(uint256 loanId, int256 delta, bytes32 reasonHash);
    function writeDown(uint256 loanId, uint256 amount);
    function closeDefaulted(uint256 loanId, uint8 reason);
    function reverseRepay(uint256 loanId, uint256 repaymentId, bytes32 refHash);
    function reverseDisburse(uint256 loanId, uint256 amount, bytes32 refHash, uint256 originalId);
    function releaseWithConsent(uint256 recordId, bytes32 consentHash);
    function resolveFlag(uint256 recordId, uint8 outcome, bytes32 reasonHash);
    function setInspectors(address[] newInspectors);
    function setTerms(uint256 loanId, Terms newTerms);
    function grantRole(uint64 roleId, address account, uint32 executionDelay);
}

pub const AM: Address = address!("5FbDB2315678afecb367f032d93F642f64180aa3");
pub const LOAN_REGISTRY: Address = address!("e7f1725E7734CE288F8367e1Bb143E90bb3F0512");
pub const SECURITY: Address = address!("9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0");
pub const MINTER: Address = address!("621BaAb0ced6b11f88019582183b081A118755f4");
pub const RECORD_NFT: Address = address!("f64302337Ad1F5A66b5f023F8ffd26074a68bA09");
pub const CALLER: Address = address!("70997970C51812dc3A010C7d01b50e0d17dc79C8");
pub const OTHER: Address = address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266");

pub const SCHEDULE_TOPIC: &str =
    "0x82a2da5dee54ea8021c6545b4444620291e07ee83be6dd57edb175062715f3b4";
pub const EXECUTE_TOPIC: &str =
    "0x76a2a46953689d4861a5d3f6ed883ad7e6af674a21f8e162707159fc9dde614d";
pub const CANCEL_TOPIC: &str = "0xbd9ac67a6e2f6463b80927326310338bcbb4bdb7936ce1365ea3e01067e7b9f7";
pub const ROLE_GRANTED_TOPIC: &str =
    "0xf98448b987f1428e0e230e1f3c6e2ce15b5693eaf31827fbd0b1ec4b424ae7cf";

pub const SET_DEFAULT_ID: &str = "2684102af1943361aad66e07f9ab2ba06e5a8ea5ff5458c52dddb483435e4a05";
pub const RESOLVE_FLAG_ID: &str =
    "a9d01ee005655bef891c93ead7d918a30f25e9451169a66d438805761d7d58bf";
pub const SET_DEFAULT_DATA: &str =
    "0xe0da6b660000000000000000000000000000000000000000000000000000000000000007";
pub const RESOLVE_FLAG_DATA: &str = "0xdf84b5b30000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000ab";
pub const SET_DEFAULT_WHEN: u64 = 1_794_937_208;
pub const RESOLVE_FLAG_WHEN: u64 = 1_794_940_810;

pub const GOLDEN_SCHEDULE_SET_DEFAULT: (&[&str], &str, u64) = (
    &[
        SCHEDULE_TOPIC,
        "0x2684102af1943361aad66e07f9ab2ba06e5a8ea5ff5458c52dddb483435e4a05",
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    ],
    "0x000000000000000000000000000000000000000000000000000000006afc917800000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8000000000000000000000000e7f1725e7734ce288f8367e1bb143e90bb3f051200000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000024e0da6b66000000000000000000000000000000000000000000000000000000000000000700000000000000000000000000000000000000000000000000000000",
    8,
);

pub const GOLDEN_EXECUTE_SET_DEFAULT: (&[&str], &str, u64) = (
    &[
        EXECUTE_TOPIC,
        "0x2684102af1943361aad66e07f9ab2ba06e5a8ea5ff5458c52dddb483435e4a05",
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    ],
    "0x",
    10,
);

pub const GOLDEN_SCHEDULE_RESOLVE_FLAG: (&[&str], &str, u64) = (
    &[
        SCHEDULE_TOPIC,
        "0xa9d01ee005655bef891c93ead7d918a30f25e9451169a66d438805761d7d58bf",
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    ],
    "0x000000000000000000000000000000000000000000000000000000006afc9f8a00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000009fe46736679d2d9a65f0992f2272de9f3c7fa6e000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000064df84b5b30000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000ab00000000000000000000000000000000000000000000000000000000",
    11,
);

pub const GOLDEN_CANCEL_RESOLVE_FLAG: (&[&str], &str, u64) = (
    &[
        CANCEL_TOPIC,
        "0xa9d01ee005655bef891c93ead7d918a30f25e9451169a66d438805761d7d58bf",
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    ],
    "0x",
    12,
);

pub const GOLDEN_RESCHEDULE_RESOLVE_FLAG: (&[&str], &str, u64) = (
    &[
        SCHEDULE_TOPIC,
        "0xa9d01ee005655bef891c93ead7d918a30f25e9451169a66d438805761d7d58bf",
        "0x0000000000000000000000000000000000000000000000000000000000000002",
    ],
    GOLDEN_SCHEDULE_RESOLVE_FLAG.1,
    13,
);

pub const GOLDEN_ROLE_GRANTED: (&[&str], &str, u64) = (
    &[
        ROLE_GRANTED_TOPIC,
        "0x0000000000000000000000000000000000000000000000000000000000000007",
        "0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8",
    ],
    "0x0000000000000000000000000000000000000000000000000000000000000e10000000000000000000000000000000000000000000000000000000006afc83680000000000000000000000000000000000000000000000000000000000000001",
    7,
);

pub fn b256(s: &str) -> B256 {
    s.parse().expect("32-byte hex")
}

pub fn golden_log(golden: &(&[&str], &str, u64)) -> Log {
    let (topics, data, block) = golden;
    log_at(
        AM,
        topics.iter().map(|t| b256(t)).collect(),
        hex::decode(data).expect("hex data"),
        *block,
    )
}

pub fn log_at(address: Address, topics: Vec<B256>, data: Vec<u8>, block: u64) -> Log {
    Log {
        inner: alloy::primitives::Log {
            address,
            data: LogData::new(topics, data.into()).expect("valid log data"),
        },
        block_number: Some(block),
        transaction_hash: Some(b256(
            "0x513ac41afcc1adbac874c64c43aac1b1476fad96301b8c9983996066dd66417a",
        )),
        log_index: Some(0),
        ..Default::default()
    }
}

pub fn data_bytes(data: &str) -> Vec<u8> {
    hex::decode(data).expect("hex data")
}

pub fn op_id(caller: Address, target: Address, data: &[u8]) -> String {
    hex::encode(hash_operation(caller, target, data))
}

pub fn set_default_data(loan: u64) -> Vec<u8> {
    setDefaultCall {
        loanId: U256::from(loan),
    }
    .abi_encode()
}

pub fn upgrade_to_and_call_data(implementation: Address, init: &[u8]) -> Vec<u8> {
    upgradeToAndCallCall {
        newImplementation: implementation,
        data: init.to_vec().into(),
    }
    .abi_encode()
}

pub fn amend_data(loan: u64, rate: u32, maturity: u64) -> Vec<u8> {
    amendEconomicsCall {
        loanId: U256::from(loan),
        newRate: rate,
        newMaturityTimestamp: maturity,
    }
    .abi_encode()
}

pub fn adjust_interest_data(loan: u64, delta: i64) -> Vec<u8> {
    adjustInterestCall {
        loanId: U256::from(loan),
        delta: I256::try_from(delta).unwrap(),
        reasonHash: B256::repeat_byte(0xcd),
    }
    .abi_encode()
}

pub fn resolve_flag_data(record: u64, outcome: u8) -> Vec<u8> {
    resolveFlagCall {
        recordId: U256::from(record),
        outcome,
        reasonHash: B256::repeat_byte(0xab),
    }
    .abi_encode()
}

pub fn release_with_consent_data(record: u64) -> Vec<u8> {
    releaseWithConsentCall {
        recordId: U256::from(record),
        consentHash: B256::repeat_byte(0x01),
    }
    .abi_encode()
}

pub fn reverse_repay_data(loan: u64) -> Vec<u8> {
    reverseRepayCall {
        loanId: U256::from(loan),
        repaymentId: U256::from(2),
        refHash: B256::repeat_byte(0x02),
    }
    .abi_encode()
}

pub fn reverse_disburse_data(loan: u64) -> Vec<u8> {
    reverseDisburseCall {
        loanId: U256::from(loan),
        amount: U256::from(5),
        refHash: B256::repeat_byte(0x03),
        originalId: U256::from(9),
    }
    .abi_encode()
}

pub fn set_inspectors_data(inspectors: Vec<Address>) -> Vec<u8> {
    setInspectorsCall {
        newInspectors: inspectors,
    }
    .abi_encode()
}

pub fn terms() -> Terms {
    Terms {
        advanceRatioBps: 7000,
        marginCallRatioBps: 8000,
        defaultRatioBps: 9000,
        curePeriod: 604_800,
        priceStaleAfter: 86_400,
        paymentTerm: 1,
        gracePeriod: 3600,
        defaultRate: 100,
        originatorFeeRate: 50,
        attestationInterval: 2_592_000,
        inspectionInterval: 5_184_000,
        toleranceBps: 200,
        gradeToleranceBps: 100,
        marginCallAt: 0,
        defaultBreachAt: 0,
    }
}

pub fn set_terms_data(loan: u64) -> Vec<u8> {
    setTermsCall {
        loanId: U256::from(loan),
        newTerms: terms(),
    }
    .abi_encode()
}

pub fn hex_data(data: &[u8]) -> String {
    format!("0x{}", hex::encode(data))
}

pub fn scheduled_row(
    id: i64,
    tx: &str,
    operation_id: &str,
    target: Address,
    data: &str,
    nonce: u32,
    when: u64,
) -> AmLogRow {
    AmLogRow {
        id,
        event_name: "AccessManagerOperationScheduled".to_owned(),
        block_number: 5_710_000 + id,
        tx_hash: tx.to_owned(),
        log_index: 2000,
        block_timestamp: 1_794_000_000 + id,
        params: json!({
            "operation_id": operation_id,
            "caller": CALLER.to_checksum(None),
            "nonce": nonce.to_string(),
            "when": when.to_string(),
            "target": target.to_checksum(None),
            "data": data,
        }),
    }
}

pub fn canceled_row(id: i64, tx: &str, operation_id: &str, nonce: u32) -> AmLogRow {
    AmLogRow {
        id,
        event_name: "AccessManagerOperationCanceled".to_owned(),
        block_number: 5_710_000 + id,
        tx_hash: tx.to_owned(),
        log_index: 2000,
        block_timestamp: 1_794_000_000 + id,
        params: json!({ "operation_id": operation_id, "nonce": nonce.to_string() }),
    }
}

pub fn executed_row(id: i64, tx: &str, operation_id: &str, nonce: u32) -> AmLogRow {
    AmLogRow {
        id,
        event_name: "AccessManagerOperationExecuted".to_owned(),
        block_number: 5_710_000 + id,
        tx_hash: tx.to_owned(),
        log_index: 2000,
        block_timestamp: 1_794_000_000 + id,
        params: json!({ "operation_id": operation_id, "nonce": nonce.to_string() }),
    }
}

pub fn config() -> EvmAmSyncConfig {
    EvmAmSyncConfig {
        contract_id: AM.to_checksum(None),
        targets: EvmTargets {
            loan_registry: LOAN_REGISTRY,
            minter: MINTER,
            security_registry: Some(SECURITY),
            record_nft: Some(RECORD_NFT),
        },
    }
}
