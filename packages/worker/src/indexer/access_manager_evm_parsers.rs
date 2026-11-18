// spec: docs/references/access-manager-events.md#evm-encoding
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use alloy::{
    dyn_abi::{DynSolValue, JsonAbiExt},
    json_abi::{Function, JsonAbi, Param},
    primitives::{keccak256, Address, Bytes, B256},
    rpc::types::Log,
    sol,
    sol_types::{SolEvent, SolValue},
};
use anyhow::{bail, Result};
use serde_json::{json, Map, Value};

use shared::{
    access_manager_repo::{OP_EVENT_CANCELED, OP_EVENT_EXECUTED, OP_EVENT_SCHEDULED},
    db::EventRepo,
    events::ContractLog,
    log_mapper::LogMapper,
};

use super::{
    access_manager_sync::{num_param, str_param, AmTopic, LoanRef},
    mappers::ContractLogMapper,
    parsers::extract_log_meta,
    poller::EvmEventPollerBuilder,
};

sol! {
    event OperationScheduled(bytes32 indexed operationId, uint32 indexed nonce, uint48 schedule, address caller, address target, bytes data);
    event OperationExecuted(bytes32 indexed operationId, uint32 indexed nonce);
    event OperationCanceled(bytes32 indexed operationId, uint32 indexed nonce);
    event RoleLabel(uint64 indexed roleId, string label);
    event RoleGranted(uint64 indexed roleId, address indexed account, uint32 delay, uint48 since, bool newMember);
    event RoleRevoked(uint64 indexed roleId, address indexed account);
    event RoleAdminChanged(uint64 indexed roleId, uint64 indexed admin);
    event RoleGuardianChanged(uint64 indexed roleId, uint64 indexed guardian);
    event RoleGrantDelayChanged(uint64 indexed roleId, uint32 delay, uint48 since);
    event TargetClosed(address indexed target, bool closed);
    event TargetFunctionRoleUpdated(address indexed target, bytes4 selector, uint64 indexed roleId);
    event TargetAdminDelayUpdated(address indexed target, uint32 delay, uint48 since);
}

pub const ACCESS_MANAGER_EVM_ALLOW_LISTED_TOPICS: [B256; 9] = [
    RoleLabel::SIGNATURE_HASH,
    RoleGranted::SIGNATURE_HASH,
    RoleRevoked::SIGNATURE_HASH,
    RoleAdminChanged::SIGNATURE_HASH,
    RoleGuardianChanged::SIGNATURE_HASH,
    RoleGrantDelayChanged::SIGNATURE_HASH,
    TargetClosed::SIGNATURE_HASH,
    TargetFunctionRoleUpdated::SIGNATURE_HASH,
    TargetAdminDelayUpdated::SIGNATURE_HASH,
];

pub fn classify_access_manager_topic(topic0: B256) -> AmTopic {
    if topic0 == OperationScheduled::SIGNATURE_HASH {
        AmTopic::Scheduled
    } else if topic0 == OperationCanceled::SIGNATURE_HASH {
        AmTopic::Canceled
    } else if topic0 == OperationExecuted::SIGNATURE_HASH {
        AmTopic::Executed
    } else if ACCESS_MANAGER_EVM_ALLOW_LISTED_TOPICS.contains(&topic0) {
        AmTopic::AllowListed
    } else {
        AmTopic::Unknown
    }
}

fn hex_prefixed(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

fn log_of(log: &Log, name: &str, params: Value) -> Option<ContractLog> {
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;
    Some(ContractLog {
        contract_address,
        event_name: name.to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params,
    })
}

fn parse_scheduled(log: &Log) -> Option<ContractLog> {
    let ev = OperationScheduled::decode_log(log.as_ref(), true)
        .ok()?
        .data;
    let params = json!({
        "operation_id": hex::encode(ev.operationId),
        "caller": ev.caller.to_checksum(None),
        "nonce": ev.nonce.to_string(),
        "when": ev.schedule.to_string(),
        "target": ev.target.to_checksum(None),
        "data": hex_prefixed(&ev.data),
    });
    log_of(log, OP_EVENT_SCHEDULED, params)
}

fn parse_canceled(log: &Log) -> Option<ContractLog> {
    let ev = OperationCanceled::decode_log(log.as_ref(), true).ok()?.data;
    let params = json!({
        "operation_id": hex::encode(ev.operationId),
        "nonce": ev.nonce.to_string(),
    });
    log_of(log, OP_EVENT_CANCELED, params)
}

fn parse_executed(log: &Log) -> Option<ContractLog> {
    let ev = OperationExecuted::decode_log(log.as_ref(), true).ok()?.data;
    let params = json!({
        "operation_id": hex::encode(ev.operationId),
        "nonce": ev.nonce.to_string(),
    });
    log_of(log, OP_EVENT_EXECUTED, params)
}

pub fn parse_access_manager_log(log: &Log, access_manager: Address) -> Option<ContractLog> {
    if log.address() != access_manager {
        return None;
    }
    let Some(topic0) = log.topic0().copied() else {
        tracing::warn!(tx_hash = ?log.transaction_hash, "AccessManager log without topic0; dropped");
        return None;
    };
    let parsed = match classify_access_manager_topic(topic0) {
        AmTopic::Scheduled => parse_scheduled(log),
        AmTopic::Canceled => parse_canceled(log),
        AmTopic::Executed => parse_executed(log),
        AmTopic::AllowListed => return None,
        AmTopic::Unknown => {
            tracing::warn!(
                contract = %access_manager,
                topic0 = %topic0,
                tx_hash = ?log.transaction_hash,
                "AccessManager emitted an unrecognised topic; dropped"
            );
            return None;
        }
    };
    if parsed.is_none() {
        tracing::warn!(
            contract = %access_manager,
            topic0 = %topic0,
            tx_hash = ?log.transaction_hash,
            "AccessManager event failed to decode; dropped"
        );
    }
    parsed
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvmScheduledRow {
    pub operation_id: String,
    pub caller: String,
    pub nonce: u32,
    pub when: u64,
    pub target: String,
    pub data: String,
}

impl EvmScheduledRow {
    pub fn from_params(p: &Value) -> Option<Self> {
        Some(Self {
            operation_id: str_param(p, "operation_id")?,
            caller: str_param(p, "caller")?,
            nonce: num_param(p, "nonce")?,
            when: num_param(p, "when")?,
            target: str_param(p, "target")?,
            data: str_param(p, "data")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvmExecutedRow {
    pub operation_id: String,
    pub nonce: u32,
}

impl EvmExecutedRow {
    pub fn from_params(p: &Value) -> Option<Self> {
        Some(Self {
            operation_id: str_param(p, "operation_id")?,
            nonce: num_param(p, "nonce")?,
        })
    }
}

pub fn hash_operation(caller: Address, target: Address, data: &[u8]) -> [u8; 32] {
    keccak256((caller, target, Bytes::copy_from_slice(data)).abi_encode_params()).0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EvmTargets {
    pub loan_registry: Address,
    pub minter: Address,
    pub security_registry: Option<Address>,
    pub record_nft: Option<Address>,
}

sol! {
    #[sol(abi)]
    interface LoanRegistryAbi {
        struct ImmutableLoanData { bytes32 borrowerRef; uint256 originalFacilitySize; uint256 originalSeniorTranche; uint256 originalEquityTranche; uint256 originalOfftakerPrice; uint32 seniorInterestRate; uint64 originationDate; uint64 originalMaturityDate; }
        struct RepaymentData { uint256 offtakerReceived; uint256 seniorPrincipalRepaid; uint256 seniorInterest; uint256 equityDistributed; uint256 mgmtFee; uint256 perfFee; uint256 oetAlloc; }
        function adjustInterest(uint256 loanId, int256 delta, bytes32 reasonHash) external;
        function amendEconomics(uint256 loanId, uint32 newRate, uint64 newMaturityTimestamp) external;
        function closeDefaulted(uint256 loanId, uint8 reason) external;
        function closeLoan(uint256 loanId, uint8 reason) external;
        function cure(uint256 loanId) external;
        function disburse(uint256 loanId, uint256 amount) external;
        function drawLoan(string metadataURI, ImmutableLoanData economics) external;
        function pause() external;
        function recordPayment(uint256 loanId, RepaymentData repayment) external;
        function rollover(uint256 loanId, uint32 newRate, uint64 newMaturityTimestamp) external;
        function setAuthority(address newAuthority) external;
        function setCapitalWallet(address newCapitalWallet) external;
        function setDefault(uint256 loanId) external;
        function setMaxFeeBps(uint32 newMaxFeeBps) external;
        function setMaxResidual(uint256 newMaxResidual) external;
        function undisburse(uint256 loanId, uint256 amount) external;
        function unpause() external;
        function unrecordPayment(uint256 loanId, uint256 repaymentId) external;
        function updateMutable(uint256 loanId, uint8 newStatus, string metadataURI) external;
        function upgradeToAndCall(address newImplementation, bytes data) external;
        function writeDown(uint256 loanId, uint256 amount) external;
    }

    #[sol(abi)]
    interface MinterAbi {
        struct RepaymentData { uint256 offtakerReceived; uint256 seniorPrincipalRepaid; uint256 seniorInterest; uint256 equityDistributed; uint256 mgmtFee; uint256 perfFee; uint256 oetAlloc; }
        function assignWireIn(uint256 id, address receiver) external;
        function cancelWireOut(uint256 id) external;
        function cancelYield(uint256 amount, uint256 epoch, bytes32 refHash) external;
        function closeRamp(uint256 id, uint256 received, bytes32 refHash) external;
        function correctVaultMint(uint256 amount, bytes32 refHash) external;
        function decreaseTxLimit(uint256 newTxLimit) external;
        function decreaseWindowLimit(uint256 newWindowLimit) external;
        function disburse(uint256 loanId, uint256 amount, uint64 valueDate, bytes32 refHash) external;
        function increaseTxLimit(uint256 newTxLimit) external;
        function increaseWindowLimit(uint256 newWindowLimit) external;
        function openRamp(uint8 direction, uint256 amount, bytes32 refHash) external;
        function pause() external;
        function recordCorrection(int256 delta, bytes32 reasonHash, uint256 originalId) external;
        function recordExpense(uint256 delta, uint64 valueDate, bytes32 refHash) external;
        function recordIncome(uint256 delta, uint64 valueDate, bytes32 refHash) external;
        function recordWireIn(address receiver, uint256 amount, uint64 valueDate, bytes32 refHash) external;
        function releaseYield() external;
        function repay(uint256 loanId, RepaymentData repaymentData, uint64 valueDate, bytes32 refHash, uint256 saleId) external;
        function requestWireOut(uint256 amount) external;
        function returnWireIn(uint256 id, bytes32 refHash) external;
        function reverseDisburse(uint256 loanId, uint256 amount, bytes32 refHash, uint256 originalId) external;
        function reverseRepay(uint256 loanId, uint256 repaymentId, bytes32 refHash) external;
        function setAuthority(address newAuthority) external;
        function setCustodians(address[] newCustodians) external;
        function setTreasury(address newTreasury) external;
        function settleWireOut(uint256 id, uint256 amount, uint64 valueDate, bytes32 refHash) external;
        function unpause() external;
        function upgradeToAndCall(address newImplementation, bytes data) external;
    }

    #[sol(abi)]
    interface SecurityRegistryAbi {
        struct Control { uint8 kind; string ref; }
        struct Doc { uint8 kind; bytes32 hash; }
        struct RecordDetails { uint8 perfection; string commodity; string region; bytes32 siteHash; bytes32 releaseCondition; Control control; Doc[] docs; }
        struct NewRecord { uint8 protection; uint8 unit; uint256 referenceQuantity; uint256 referenceGrade; RecordDetails details; }
        struct Terms { uint32 advanceRatioBps; uint32 marginCallRatioBps; uint32 defaultRatioBps; uint64 curePeriod; uint64 priceStaleAfter; uint8 paymentTerm; uint64 gracePeriod; uint32 defaultRate; uint32 originatorFeeRate; uint64 attestationInterval; uint64 inspectionInterval; uint32 toleranceBps; uint32 gradeToleranceBps; uint64 marginCallAt; uint64 defaultBreachAt; }
        function applyInspection(uint256 recordId, uint256 inspectionId, uint64 inspectedAt, uint256 quantity, bool measuresQuantity, bool flagged) external;
        function attest(uint256 recordId) external;
        function checkCoverage(uint256 loanId) external;
        function handover(uint256 fromRecordId, uint256 toRecordId, bytes32 evidenceHash) external;
        function markEnforced(uint256 recordId, bytes32 proceedsHash) external;
        function pause() external;
        function perfect(uint256 recordId, bytes32 evidenceHash) external;
        function recordExtensionConsent(uint256 loanId, uint64 newMaturity, bytes32 consentHash) external;
        function register(uint256 loanId, uint256 lotId, NewRecord newRecord) external;
        function release(uint256 recordId, bytes32 reasonHash) external;
        function releaseWithConsent(uint256 recordId, bytes32 consentHash) external;
        function reportMandateBreach(uint256 loanId, bytes32 evidenceHash) external;
        function resolveFlag(uint256 recordId, uint8 outcome, bytes32 reasonHash) external;
        function revalue(uint256 recordId, uint256 valuePerUnit, bytes32 benchmark, bytes32 reportHash) external;
        function setAuthority(address newAuthority) external;
        function setLoanRegistry(address newLoanRegistry) external;
        function setTerms(uint256 loanId, Terms newTerms) external;
        function startEnforcement(uint256 recordId) external;
        function unpause() external;
        function upgradeToAndCall(address newImplementation, bytes data) external;
    }

    #[sol(abi)]
    interface RecordNftAbi {
        struct Control { uint8 kind; string ref; }
        struct Doc { uint8 kind; bytes32 hash; }
        struct RecordDetails { uint8 perfection; string commodity; string region; bytes32 siteHash; bytes32 releaseCondition; Control control; Doc[] docs; }
        struct NewInspection { address inspector; uint8 kind; uint64 inspectedAt; uint256 quantity; uint256 grade; bytes32 siteHash; bytes32 certificateHash; string region; string certificateNo; }
        function addDoc(uint256 recordId, uint8 kind, bytes32 hash) external;
        function addEvidence(uint256 recordId, uint8 kind, bytes32 hash) external;
        function approveInspection(uint256 inspectionId) external;
        function burn(uint256 recordId) external;
        function mint(address to, uint256 recordId, RecordDetails newDetails) external;
        function recordInspection(uint256 recordId, NewInspection newInspection) external;
        function setAuthority(address newAuthority) external;
        function setInspectors(address[] newInspectors) external;
        function setSecurityRegistry(address newSecurityRegistry) external;
        function upgradeToAndCall(address newImplementation, bytes data) external;
    }
}

type AbiTable = HashMap<[u8; 4], Function>;

struct AbiTables {
    loan_registry: AbiTable,
    minter: AbiTable,
    security_registry: AbiTable,
    record_nft: AbiTable,
}

fn build_table(abi: &JsonAbi) -> AbiTable {
    abi.functions()
        .map(|f| (f.selector().0, f.clone()))
        .collect()
}

fn abi_tables() -> &'static AbiTables {
    static TABLES: OnceLock<AbiTables> = OnceLock::new();
    TABLES.get_or_init(|| AbiTables {
        loan_registry: build_table(&LoanRegistryAbi::abi::contract()),
        minter: build_table(&MinterAbi::abi::contract()),
        security_registry: build_table(&SecurityRegistryAbi::abi::contract()),
        record_nft: build_table(&RecordNftAbi::abi::contract()),
    })
}

fn abi_for(target: Address, targets: &EvmTargets) -> Option<&'static AbiTable> {
    let tables = abi_tables();
    if target == targets.loan_registry {
        Some(&tables.loan_registry)
    } else if target == targets.minter {
        Some(&tables.minter)
    } else if Some(target) == targets.security_registry {
        Some(&tables.security_registry)
    } else if Some(target) == targets.record_nft {
        Some(&tables.record_nft)
    } else {
        None
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecodedCall {
    pub function: String,
    pub args: Option<Vec<DynSolValue>>,
    pub args_json: Option<Value>,
}

pub fn decode_call(target: Address, data: &[u8], targets: &EvmTargets) -> DecodedCall {
    let selector: [u8; 4] = data
        .get(..4)
        .and_then(|s| s.try_into().ok())
        .unwrap_or_default();
    let unknown = DecodedCall {
        function: hex_prefixed(&selector),
        args: None,
        args_json: None,
    };
    let Some(function) = abi_for(target, targets).and_then(|t| t.get(&selector)) else {
        return unknown;
    };
    match function.abi_decode_input(&data[4..], true) {
        Ok(values) => {
            let args_json = args_display_json(&values, &function.inputs);
            DecodedCall {
                function: function.name.clone(),
                args: Some(values),
                args_json: Some(args_json),
            }
        }
        Err(e) => {
            tracing::warn!(target = %target, function = %function.name, error = %e, "AccessManager calldata arguments did not decode; args not stored");
            DecodedCall {
                function: function.name.clone(),
                args: None,
                args_json: None,
            }
        }
    }
}

fn json_text(s: &str) -> String {
    s.replace('\0', "\u{FFFD}")
}

fn value_display_json(value: &DynSolValue, param: &Param) -> Value {
    match value {
        DynSolValue::Bool(b) => json!(b),
        DynSolValue::Int(n, bits) if *bits <= 32 => json!(n.as_i64()),
        DynSolValue::Int(n, _) => json!(n.to_string()),
        DynSolValue::Uint(n, bits) if *bits <= 32 => json!(n.to::<u64>()),
        DynSolValue::Uint(n, _) => json!(n.to_string()),
        DynSolValue::FixedBytes(word, size) => json!(hex::encode(&word[..*size])),
        DynSolValue::Address(a) => json!(a.to_checksum(None)),
        DynSolValue::Function(f) => json!(hex::encode(f.0)),
        DynSolValue::Bytes(b) => json!(hex::encode(b)),
        DynSolValue::String(s) => json!(json_text(s)),
        DynSolValue::Array(items) | DynSolValue::FixedArray(items) => Value::Array(
            items
                .iter()
                .map(|item| value_display_json(item, param))
                .collect(),
        ),
        DynSolValue::Tuple(items) if items.len() == param.components.len() => {
            let mut obj = Map::new();
            for (item, component) in items.iter().zip(&param.components) {
                obj.insert(
                    json_text(&component.name),
                    value_display_json(item, component),
                );
            }
            Value::Object(obj)
        }
        DynSolValue::Tuple(items) => Value::Array(
            items
                .iter()
                .map(|item| value_display_json(item, param))
                .collect(),
        ),
    }
}

pub fn args_display_json(values: &[DynSolValue], params: &[Param]) -> Value {
    Value::Array(
        values
            .iter()
            .zip(params)
            .map(|(v, p)| value_display_json(v, p))
            .collect(),
    )
}

const LOAN_REGISTRY_FUNCTIONS: [&str; 6] = [
    "setDefault",
    "cure",
    "amendEconomics",
    "adjustInterest",
    "writeDown",
    "closeDefaulted",
];

pub fn loan_ref(
    target: Address,
    function: &str,
    args: &[DynSolValue],
    targets: &EvmTargets,
) -> LoanRef {
    let loan_call = (target == targets.loan_registry
        && LOAN_REGISTRY_FUNCTIONS.contains(&function))
        || (target == targets.minter && function == "reverseRepay");
    let security_call = Some(target) == targets.security_registry;
    let record = security_call && matches!(function, "resolveFlag" | "releaseWithConsent");
    let loan = loan_call || (security_call && function == "setTerms");
    if !loan && !record {
        return LoanRef::None;
    }
    let first = match args.first() {
        Some(DynSolValue::Uint(n, 256)) => u32::try_from(*n).ok(),
        _ => None,
    };
    let Some(first) = first else {
        tracing::warn!(target = %target, function, "AccessManager first argument is not a u32 id; loan not resolved");
        return LoanRef::None;
    };
    if record {
        LoanRef::Record(first)
    } else {
        LoanRef::Loan(first)
    }
}

pub fn reject_access_manager_collision(
    chain_id: i64,
    access_manager: Address,
    roles: &[(&str, Address)],
) -> Result<()> {
    if let Some((role, _)) = roles.iter().find(|(_, addr)| *addr == access_manager) {
        let key = if *role == "ASSET_ADDRESS" {
            format!("JOB_INDEXER_EVM_{chain_id}_ASSET_ADDRESS")
        } else {
            format!("CHAIN_{chain_id}_EVM_INDEXER_{role}")
        };
        bail!(
            "CHAIN_{chain_id}_EVM_INDEXER_ACCESS_MANAGER_ADDRESS must not equal {key} ({access_manager})"
        );
    }
    Ok(())
}

pub fn register_access_manager_handler(
    builder: EvmEventPollerBuilder,
    chain_id: i64,
    access_manager: Address,
    repo: Arc<EventRepo>,
) -> EvmEventPollerBuilder {
    builder.add_event_handler(vec![access_manager], move |log| {
        parse_access_manager_log(log, access_manager).map(|ev| {
            Box::new(ContractLogMapper::new(ev, chain_id, repo.clone())) as Box<dyn LogMapper>
        })
    })
}
