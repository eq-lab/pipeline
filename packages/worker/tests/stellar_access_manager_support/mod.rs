// spec: docs/references/access-manager-events.md
#![allow(dead_code)]
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use pipeline_worker::indexer::stellar::access_manager_parsers::{hash_operation, TargetIds};
use pipeline_worker::indexer::stellar::access_manager_sync::{
    AmSyncConfig, AmSyncStore, TxEnvelopeSource, TxFetch,
};
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use serde_json::json;
use shared::access_manager_repo::{AmLogRow, NewScheduledOp, OpStatus, OpWrite};
use stellar_xdr::curr::{
    AccountId, BytesM, ContractId, FeeBumpTransaction, FeeBumpTransactionEnvelope,
    FeeBumpTransactionExt, FeeBumpTransactionInnerTx, Hash, HostFunction, InvokeContractArgs,
    InvokeHostFunctionOp, Limits, Memo, MuxedAccount, Operation, OperationBody, Preconditions,
    PublicKey, ScAddress, ScBytes, ScMap, ScMapEntry, ScSymbol, ScVal, ScVec, SequenceNumber,
    SorobanAuthorizationEntry, SorobanAuthorizedFunction, SorobanAuthorizedInvocation,
    SorobanCredentials, StringM, Transaction, TransactionEnvelope, TransactionExt,
    TransactionV1Envelope, Uint256, VecM, WriteXdr,
};

pub const AM: &str = "CDP7TUNBGIKDBGEUZCA6WEDVJ7BTJFXNIPQF6HWEDV7SAAS7VN75WHTW";
pub const LOAN_REGISTRY: &str = "CDWN5B3FFX25TSL6T2NEW5LPTW4VYFUXCXPMNIFRBMJYILEOAL5TVXZQ";
pub const SECURITY: &str = "CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX";
pub const MINTER: &str = "CBSMJS5QIFSSH5LPPYPZ23SMGJP5LK5GTKTFCTUVQNQECNMCNGG77PGS";
pub const CALLER: &str = "GAZFDDYKOOHWNMBAQWDURXBV3WNFQIT4UR2NWV5SGTKA4CCV7LIEZH6G";
pub const OTHER: &str = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

pub const AMEND_OPERATION_ID: &str =
    "a36a52bd16172a03793c93aa836b7a971e2849ab7411b01319f5eee0c8e9ef3e";
pub const AMEND_TOPIC_0: &str = "AAAADwAAABNvcGVyYXRpb25fc2NoZWR1bGVkAA==";
pub const AMEND_TOPIC_1: &str = "AAAADQAAACCjalK9FhcqA3k8k6qDa3qXHihJq3QRsBMZ9e7gyOnvPg==";
pub const AMEND_TOPIC_2: &str = "AAAAEgAAAAAAAAAAMlGPCnOPZrAghYdI3DXdmlgifKR021eyNNQOCFX60Ew=";
pub const AMEND_VALUE: &str = "AAAAEQAAAAEAAAAEAAAADwAAAAhmdW5jdGlvbgAAAA8AAAAPYW1lbmRfZWNvbm9taWNzAAAAAA8AAAAFbm9uY2UAAAAAAAADAAAAAQAAAA8AAAAGdGFyZ2V0AAAAAAASAAAAAezeh2Ut9dnJfp6aS3VvnblcFpcV3sagsQsThCyOAvs6AAAADwAAAAR3aGVuAAAABQAAAABq+God";
pub const AMEND_ENVELOPE: &str = "AAAAAgAAAAAyUY8Kc49msCCFh0jcNd2aWCJ8pHTbV7I01A4IVfrQTAAAZ1cAPLaDAAAAOQAAAAEAAAAAAAAAAAAAAABq9xi3AAAAAAAAAAEAAAAAAAAAGAAAAAAAAAAB3/nRoTIUMJiUyIHrEHVPwzSW7UPgXx7EHX8gAl+rf9sAAAAIc2NoZWR1bGUAAAAFAAAAEgAAAAHs3odlLfXZyX6emkt1b525XBaXFd7GoLELE4QsjgL7OgAAAA8AAAAPYW1lbmRfZWNvbm9taWNzAAAAABAAAAABAAAAAwAAAAMAAAAAAAAAAwACNmgAAAAFAAAAAGw/6gAAAAAFAAAAAAAAAAAAAAASAAAAAAAAAAAyUY8Kc49msCCFh0jcNd2aWCJ8pHTbV7I01A4IVfrQTAAAAAEAAAAAAAAAAAAAAAHf+dGhMhQwmJTIgesQdU/DNJbtQ+BfHsQdfyACX6t/2wAAAAhzY2hlZHVsZQAAAAUAAAASAAAAAezeh2Ut9dnJfp6aS3VvnblcFpcV3sagsQsThCyOAvs6AAAADwAAAA9hbWVuZF9lY29ub21pY3MAAAAAEAAAAAEAAAADAAAAAwAAAAAAAAADAAI2aAAAAAUAAAAAbD/qAAAAAAUAAAAAAAAAAAAAABIAAAAAAAAAADJRjwpzj2awIIWHSNw13ZpYInykdNtXsjTUDghV+tBMAAAAAAAAAAEAAAAAAAAABQAAAAYAAAAB3/nRoTIUMJiUyIHrEHVPwzSW7UPgXx7EHX8gAl+rf9sAAAAQAAAAAQAAAAMAAAAPAAAAClJvbGVNZW1iZXIAAAAAABIAAAAAAAAAADJRjwpzj2awIIWHSNw13ZpYInykdNtXsjTUDghV+tBMAAAADwAAAAxSSVNLX0NPVU5DSUwAAAABAAAABgAAAAHf+dGhMhQwmJTIgesQdU/DNJbtQ+BfHsQdfyACX6t/2wAAABAAAAABAAAAAgAAAA8AAAAMVGFyZ2V0Q2xvc2VkAAAAEgAAAAHs3odlLfXZyX6emkt1b525XBaXFd7GoLELE4QsjgL7OgAAAAEAAAAGAAAAAd/50aEyFDCYlMiB6xB1T8M0lu1D4F8exB1/IAJfq3/bAAAAEAAAAAEAAAADAAAADwAAABJUYXJnZXRGdW5jdGlvblJvbGUAAAAAABIAAAAB7N6HZS312cl+nppLdW+duVwWlxXexqCxCxOELI4C+zoAAAAPAAAAD2FtZW5kX2Vjb25vbWljcwAAAAABAAAABgAAAAHf+dGhMhQwmJTIgesQdU/DNJbtQ+BfHsQdfyACX6t/2wAAABQAAAABAAAABxGL/FZond5FcoJckJckuW0cEVLP+sXs1HabyBX7fIUuAAAAAQAAAAYAAAAB3/nRoTIUMJiUyIHrEHVPwzSW7UPgXx7EHX8gAl+rf9sAAAAQAAAAAQAAAAIAAAAPAAAAC1NjaGVkdWxlZE9wAAAAAA0AAAAgo2pSvRYXKgN5PJOqg2t6lx4oSat0EbATGfXu4Mjp7z4AAAAAAA5orwAAAAAAAADEAAAAAAAAZvMAAAABVfrQTAAAAEA0tk62eTiIPjuAIOD/tKjE5kkuSj2qDtlYpYnXVwSmBW6d1tQ+NG0YW7uzpy1p+cNB31zdAYUommAtH5Vu108C";

pub fn b64(v: &ScVal) -> String {
    v.to_xdr_base64(Limits::none()).unwrap()
}

pub fn sym(s: &str) -> ScVal {
    let s: StringM<32> = s.try_into().unwrap();
    ScVal::Symbol(ScSymbol(s))
}

pub fn vec_val(items: Vec<ScVal>) -> ScVal {
    let items: VecM<ScVal> = items.try_into().unwrap();
    ScVal::Vec(Some(ScVec(items)))
}

pub fn address_val(strkey: &str) -> ScVal {
    let addr = if strkey.starts_with('G') {
        let pk = stellar_strkey::ed25519::PublicKey::from_string(strkey).unwrap();
        ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(pk.0))))
    } else {
        let c = stellar_strkey::Contract::from_string(strkey).unwrap();
        ScAddress::Contract(ContractId(Hash(c.0)))
    };
    ScVal::Address(addr)
}

pub fn bytes_val(bytes: &[u8]) -> ScVal {
    let b: BytesM = bytes.to_vec().try_into().unwrap();
    ScVal::Bytes(ScBytes(b))
}

pub fn map_val(pairs: Vec<(&str, ScVal)>) -> ScVal {
    let mut sorted = pairs;
    sorted.sort_by_key(|(k, _)| *k);
    let entries: Vec<ScMapEntry> = sorted
        .into_iter()
        .map(|(k, val)| ScMapEntry { key: sym(k), val })
        .collect();
    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
}

pub fn raw_event(name: &str, topics: Vec<String>, value: String) -> RawEvent {
    RawEvent {
        contract_id: AM.to_owned(),
        event_name: name.to_owned(),
        topics_base64: topics,
        value_base64: value,
        ledger: 5_710_989,
        ledger_closed_at_unix: 1_794_000_000,
        tx_hash: "b535457d".to_owned(),
        tx_index: 2,
        op_index: 0,
        event_index_in_op: 1,
    }
}

pub fn amend_event() -> RawEvent {
    raw_event(
        "operation_scheduled",
        vec![
            AMEND_TOPIC_0.to_owned(),
            AMEND_TOPIC_1.to_owned(),
            AMEND_TOPIC_2.to_owned(),
        ],
        AMEND_VALUE.to_owned(),
    )
}

pub fn scheduled_event(op_id: &[u8; 32], caller: &str, nonce: u32, when: u64) -> RawEvent {
    raw_event(
        "operation_scheduled",
        vec![
            b64(&sym("operation_scheduled")),
            b64(&bytes_val(op_id)),
            b64(&address_val(caller)),
        ],
        b64(&map_val(vec![
            ("function", sym("amend_economics")),
            ("nonce", ScVal::U32(nonce)),
            ("target", address_val(LOAN_REGISTRY)),
            ("when", ScVal::U64(when)),
        ])),
    )
}

pub fn canceled_event(op_id: &[u8; 32], nonce: u32) -> RawEvent {
    raw_event(
        "operation_canceled",
        vec![b64(&sym("operation_canceled")), b64(&bytes_val(op_id))],
        b64(&map_val(vec![("nonce", ScVal::U32(nonce))])),
    )
}

pub fn executed_event(target: &str, function: &str, caller: &str) -> RawEvent {
    raw_event(
        "operation_executed",
        vec![
            b64(&sym("operation_executed")),
            b64(&address_val(target)),
            b64(&sym(function)),
            b64(&address_val(caller)),
        ],
        b64(&ScVal::Void),
    )
}

pub fn invoke_args(contract: &str, function: &str, args: Vec<ScVal>) -> InvokeContractArgs {
    let name: StringM<32> = function.try_into().unwrap();
    InvokeContractArgs {
        contract_address: match address_val(contract) {
            ScVal::Address(a) => a,
            _ => unreachable!(),
        },
        function_name: ScSymbol(name),
        args: args.try_into().unwrap(),
    }
}

pub fn invocation(
    contract: &str,
    function: &str,
    args: Vec<ScVal>,
    subs: Vec<SorobanAuthorizedInvocation>,
) -> SorobanAuthorizedInvocation {
    SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(invoke_args(contract, function, args)),
        sub_invocations: subs.try_into().unwrap(),
    }
}

pub fn auth_entry(root: SorobanAuthorizedInvocation) -> SorobanAuthorizationEntry {
    SorobanAuthorizationEntry {
        credentials: SorobanCredentials::SourceAccount,
        root_invocation: root,
    }
}

pub fn invoke_op(
    contract: &str,
    function: &str,
    args: Vec<ScVal>,
    auth: Vec<SorobanAuthorizationEntry>,
) -> Operation {
    Operation {
        source_account: None,
        body: OperationBody::InvokeHostFunction(InvokeHostFunctionOp {
            host_function: HostFunction::InvokeContract(invoke_args(contract, function, args)),
            auth: auth.try_into().unwrap(),
        }),
    }
}

pub fn inner_envelope(ops: Vec<Operation>) -> TransactionV1Envelope {
    TransactionV1Envelope {
        tx: Transaction {
            source_account: MuxedAccount::Ed25519(Uint256([7; 32])),
            fee: 100,
            seq_num: SequenceNumber(1),
            cond: Preconditions::None,
            memo: Memo::None,
            operations: ops.try_into().unwrap(),
            ext: TransactionExt::V0,
        },
        signatures: VecM::default(),
    }
}

pub fn envelope_b64(ops: Vec<Operation>) -> String {
    TransactionEnvelope::Tx(inner_envelope(ops))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

pub fn fee_bump_b64(ops: Vec<Operation>) -> String {
    TransactionEnvelope::TxFeeBump(FeeBumpTransactionEnvelope {
        tx: FeeBumpTransaction {
            fee_source: MuxedAccount::Ed25519(Uint256([8; 32])),
            fee: 200,
            inner_tx: FeeBumpTransactionInnerTx::Tx(inner_envelope(ops)),
            ext: FeeBumpTransactionExt::V0,
        },
        signatures: VecM::default(),
    })
    .to_xdr_base64(Limits::none())
    .unwrap()
}

pub fn schedule_call(
    target: &str,
    function: &str,
    args: ScVal,
    when: u64,
    caller: &str,
) -> Vec<ScVal> {
    vec![
        address_val(target),
        sym(function),
        args,
        ScVal::U64(when),
        address_val(caller),
    ]
}

pub fn execute_call(target: &str, function: &str, args: ScVal, caller: &str) -> Vec<ScVal> {
    vec![
        address_val(target),
        sym(function),
        args,
        address_val(caller),
    ]
}

pub fn schedule_envelope(
    target: &str,
    function: &str,
    args: ScVal,
    when: u64,
    caller: &str,
) -> String {
    envelope_b64(vec![invoke_op(
        AM,
        "schedule",
        schedule_call(target, function, args, when, caller),
        vec![],
    )])
}

pub fn execute_envelope(target: &str, function: &str, args: ScVal, caller: &str) -> String {
    envelope_b64(vec![invoke_op(
        AM,
        "execute",
        execute_call(target, function, args, caller),
        vec![],
    )])
}

pub fn op_id(target: &str, function: &str, args: &ScVal, caller: &str) -> [u8; 32] {
    hash_operation(
        &address_val(caller),
        &address_val(target),
        &sym(function),
        args,
    )
}

pub fn amend_args() -> ScVal {
    vec_val(vec![
        ScVal::U32(0),
        ScVal::U32(145_000),
        ScVal::U64(1_816_128_000),
    ])
}

pub fn scheduled_row(
    id: i64,
    tx: &str,
    op_id_hex: &str,
    target: &str,
    function: &str,
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
            "operation_id": op_id_hex,
            "caller": CALLER,
            "nonce": nonce.to_string(),
            "when": when.to_string(),
            "target": target,
            "function": function,
        }),
    }
}

pub fn canceled_row(id: i64, tx: &str, op_id_hex: &str, nonce: u32) -> AmLogRow {
    AmLogRow {
        id,
        event_name: "AccessManagerOperationCanceled".to_owned(),
        block_number: 5_710_000 + id,
        tx_hash: tx.to_owned(),
        log_index: 2000,
        block_timestamp: 1_794_000_000 + id,
        params: json!({ "operation_id": op_id_hex, "nonce": nonce.to_string() }),
    }
}

pub fn executed_row(id: i64, tx: &str, target: &str, function: &str) -> AmLogRow {
    AmLogRow {
        id,
        event_name: "AccessManagerOperationExecuted".to_owned(),
        block_number: 5_710_000 + id,
        tx_hash: tx.to_owned(),
        log_index: 2000,
        block_timestamp: 1_794_000_000 + id,
        params: json!({ "target": target, "function": function, "caller": CALLER }),
    }
}

pub fn config() -> AmSyncConfig {
    AmSyncConfig {
        contract_id: AM.to_owned(),
        ids: TargetIds {
            loan_registry: Some(LOAN_REGISTRY.to_owned()),
            minter: Some(MINTER.to_owned()),
            security_registry: Some(SECURITY.to_owned()),
        },
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Op {
    pub new: NewScheduledOp,
    pub expires_at: i64,
    pub status: OpStatus,
    pub closed_tx_hash: Option<String>,
}

#[derive(Default)]
pub struct StoreState {
    pub rows: Vec<AmLogRow>,
    pub watermark: i64,
    pub ops: Vec<Op>,
    pub records: HashMap<i64, i64>,
    pub fail_apply: bool,
}

#[derive(Default)]
pub struct MemStore {
    pub state: Mutex<StoreState>,
}

impl MemStore {
    pub fn with_rows(rows: Vec<AmLogRow>) -> Self {
        let store = Self::default();
        store.state.lock().unwrap().rows = rows;
        store
    }

    pub fn ops(&self) -> Vec<Op> {
        self.state.lock().unwrap().ops.clone()
    }

    pub fn watermark_now(&self) -> i64 {
        self.state.lock().unwrap().watermark
    }

    pub fn reset_watermark(&self) {
        self.state.lock().unwrap().watermark = 0;
    }
}

#[async_trait]
impl AmSyncStore for MemStore {
    async fn watermark(&self) -> Result<i64> {
        Ok(self.state.lock().unwrap().watermark)
    }

    async fn rows_after(&self, after_id: i64, limit: i64) -> Result<Vec<AmLogRow>> {
        let s = self.state.lock().unwrap();
        let mut rows: Vec<AmLogRow> = s.rows.iter().filter(|r| r.id > after_id).cloned().collect();
        rows.sort_by_key(|r| r.id);
        rows.truncate(limit as usize);
        Ok(rows)
    }

    async fn has_pending_call(&self, target: &str, function: &str, caller: &str) -> Result<bool> {
        let s = self.state.lock().unwrap();
        Ok(s.ops.iter().any(|o| {
            o.status == OpStatus::Pending
                && o.new.target == target
                && o.new.function == function
                && o.new.caller == caller
        }))
    }

    async fn record_loan(&self, _security_contract: &str, record_id: i64) -> Result<Option<i64>> {
        Ok(self.state.lock().unwrap().records.get(&record_id).copied())
    }

    async fn apply(&self, log_id: i64, write: &OpWrite) -> Result<u64> {
        let mut s = self.state.lock().unwrap();
        if s.fail_apply {
            return Err(anyhow!("db down"));
        }
        let mut affected = 0;
        match write {
            OpWrite::Schedule(new) => {
                let exists = s
                    .ops
                    .iter()
                    .any(|o| o.new.operation_id == new.operation_id && o.new.nonce == new.nonce);
                if !exists {
                    s.ops.push(Op {
                        expires_at: new.expires_at(),
                        new: new.clone(),
                        status: OpStatus::Pending,
                        closed_tx_hash: None,
                    });
                    affected = 1;
                }
            }
            OpWrite::Cancel {
                operation_id,
                nonce,
                tx_hash,
                ..
            } => {
                for o in &mut s.ops {
                    if o.new.operation_id == *operation_id
                        && o.new.nonce == *nonce
                        && o.status == OpStatus::Pending
                    {
                        o.status = OpStatus::Canceled;
                        o.closed_tx_hash = Some(tx_hash.clone());
                        affected += 1;
                    }
                }
            }
            OpWrite::Execute { ids, tx_hash, .. } => {
                for id in ids {
                    let best = s
                        .ops
                        .iter_mut()
                        .filter(|o| o.new.operation_id == *id && o.status == OpStatus::Pending)
                        .max_by_key(|o| o.new.nonce);
                    if let Some(o) = best {
                        o.status = OpStatus::Executed;
                        o.closed_tx_hash = Some(tx_hash.clone());
                        affected += 1;
                    }
                }
            }
            OpWrite::Skip => {}
        }
        s.watermark = s.watermark.max(log_id);
        Ok(affected)
    }
}

#[derive(Clone)]
pub enum Scripted {
    Found(String),
    BeyondRetention,
    NotYet,
    Fail,
}

#[derive(Default)]
pub struct FakeTx {
    pub scripts: Mutex<HashMap<String, Scripted>>,
    pub calls: Mutex<VecDeque<String>>,
}

impl FakeTx {
    pub fn set(&self, hash: &str, s: Scripted) {
        self.scripts.lock().unwrap().insert(hash.to_owned(), s);
    }

    pub fn found(hash: &str, envelope: String) -> Self {
        let f = Self::default();
        f.set(hash, Scripted::Found(envelope));
        f
    }

    pub fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

#[async_trait]
impl TxEnvelopeSource for FakeTx {
    async fn fetch(&self, tx_hash: &str, _row_ledger: i64) -> Result<TxFetch> {
        self.calls.lock().unwrap().push_back(tx_hash.to_owned());
        match self.scripts.lock().unwrap().get(tx_hash) {
            Some(Scripted::Found(e)) => Ok(TxFetch::Found(e.clone())),
            Some(Scripted::BeyondRetention) => Ok(TxFetch::BeyondRetention),
            Some(Scripted::NotYet) => Ok(TxFetch::NotYet),
            Some(Scripted::Fail) | None => Err(anyhow!("rpc unreachable")),
        }
    }
}

pub fn hex_id(id: &[u8; 32]) -> String {
    hex::encode(id)
}
