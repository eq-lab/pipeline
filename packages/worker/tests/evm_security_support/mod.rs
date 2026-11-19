// spec: docs/references/security-registry-events.md#event-table
#![allow(dead_code, clippy::too_many_arguments)]
use alloy::primitives::{address, Address, LogData, B256, U256};
use alloy::rpc::types::Log;
use alloy::sol_types::SolEvent;
use pipeline_worker::indexer::security_registry_parsers::sr;
use shared::events::ContractLog;
use shared::security_registry::SecurityEventRow;

pub const REGISTRY: Address = address!("B51E7f13420D106946376A67Fe5921C63B09BE15");
pub const NFT: Address = address!("f64302337Ad1F5A66b5f023F8ffd26074a68bA09");
pub const READER: Address = address!("8e7078c73068F9F3d4e2210cfe5B4981eB7f1b6B");
pub const LOAN_REGISTRY: Address = address!("fB6916095ca1df60bB79Ce92cE3Ea74c37c5d359");
pub const OTHER: Address = address!("dAC17F958D2ee523a2206206994597C13D831ec7");
pub const INSPECTOR: Address = address!("5B38Da6a701c568545dCfcB03FcB875f56beddC4");
pub const APPROVER: Address = address!("Ab8483F64d9C6d1EcF9b849Ae677dD3315835cb2");
pub const INSPECTOR_TEXT: &str = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4";
pub const APPROVER_TEXT: &str = "0xAb8483F64d9C6d1EcF9b849Ae677dD3315835cb2";
pub const BASE_TS: i64 = 1_790_000_000;

pub struct Ev {
    pub log: Log,
    pub ts: i64,
}

pub fn hash(byte: u8) -> B256 {
    B256::repeat_byte(byte)
}

pub fn hex32(byte: u8) -> String {
    hex::encode([byte; 32])
}

pub fn u(v: u64) -> U256 {
    U256::from(v)
}

pub fn log_data(topics: Vec<B256>, data: Vec<u8>, emitter: Address, block: u64, seq: u64) -> Log {
    Log {
        inner: alloy::primitives::Log {
            address: emitter,
            data: LogData::new(topics, data.into()).unwrap(),
        },
        block_number: Some(block),
        transaction_hash: Some(B256::repeat_byte(seq as u8)),
        log_index: Some(seq),
        ..Default::default()
    }
}

pub fn log_of<E: SolEvent>(emitter: Address, event: &E, block: u64, seq: u64) -> Log {
    let data = event.encode_log_data();
    log_data(
        data.topics().to_vec(),
        data.data.to_vec(),
        emitter,
        block,
        seq,
    )
}

pub fn ev<E: SolEvent>(emitter: Address, event: &E, block: u64, ts: i64, seq: u64) -> Ev {
    Ev {
        log: log_of(emitter, event, block, seq),
        ts,
    }
}

pub fn row_from(log: ContractLog, id: i64, ts: i64) -> SecurityEventRow {
    SecurityEventRow {
        id,
        event_name: log.event_name,
        block_number: log.block_number as i64,
        log_index: log.log_index as i64,
        block_timestamp: ts,
        tx_hash: format!("{:#x}", log.tx_hash),
        params: log.params,
    }
}

pub fn terms(margin_call_at: u64, default_breach_at: u64, payment_term: u8) -> sr::Terms {
    sr::Terms {
        advanceRatioBps: 8000,
        marginCallRatioBps: 8500,
        defaultRatioBps: 9500,
        curePeriod: 604_800,
        priceStaleAfter: 172_800,
        paymentTerm: payment_term,
        gracePeriod: 86_400,
        defaultRate: 200_000,
        originatorFeeRate: 25_000,
        attestationInterval: 0,
        inspectionInterval: 0,
        toleranceBps: 50,
        gradeToleranceBps: 100,
        marginCallAt: margin_call_at,
        defaultBreachAt: default_breach_at,
    }
}

pub fn terms_set(loan: u64, margin_call_at: u64, block: u64, ts: i64, seq: u64) -> Ev {
    ev(
        REGISTRY,
        &sr::TermsSet {
            loanId: u(loan),
            terms: terms(margin_call_at, 0, 0),
        },
        block,
        ts,
        seq,
    )
}

pub fn registered(
    loan: u64,
    rec: u64,
    lot: u64,
    protection: u8,
    block: u64,
    ts: i64,
    seq: u64,
) -> Ev {
    ev(
        REGISTRY,
        &sr::RecordRegistered {
            loanId: u(loan),
            recordId: u(rec),
            lotId: u(lot),
            protection,
        },
        block,
        ts,
        seq,
    )
}

pub fn perfected(loan: u64, rec: u64, byte: u8, block: u64, ts: i64, seq: u64) -> Ev {
    ev(
        REGISTRY,
        &sr::RecordPerfected {
            loanId: u(loan),
            recordId: u(rec),
            evidenceHash: hash(byte),
        },
        block,
        ts,
        seq,
    )
}

pub fn handed_over(loan: u64, from: u64, to: u64, byte: u8, block: u64, ts: i64, seq: u64) -> Ev {
    ev(
        REGISTRY,
        &sr::RecordHandedOver {
            loanId: u(loan),
            fromRecordId: u(from),
            toRecordId: u(to),
            evidenceHash: hash(byte),
        },
        block,
        ts,
        seq,
    )
}

pub fn revalued(loan: u64, rec: u64, value: u64, block: u64, ts: i64, seq: u64) -> Ev {
    let mut benchmark = [0u8; 32];
    benchmark[..3].copy_from_slice(b"LME");
    ev(
        REGISTRY,
        &sr::Revalued {
            loanId: u(loan),
            recordId: u(rec),
            valuePerUnit: u(value),
            benchmark: B256::from(benchmark),
            reportHash: hash(0x64),
        },
        block,
        ts,
        seq,
    )
}

pub fn doc_added(loan: u64, rec: u64, kind: u8, byte: u8, block: u64, ts: i64, seq: u64) -> Ev {
    ev(
        NFT,
        &sr::DocAdded {
            loanId: u(loan),
            recordId: u(rec),
            kind,
            hash: hash(byte),
        },
        block,
        ts,
        seq,
    )
}

pub fn margin_call(loan: u64, ltv: u32, cure_by: u64, block: u64, ts: i64, seq: u64) -> Ev {
    ev(
        REGISTRY,
        &sr::MarginCall {
            loanId: u(loan),
            ltvBps: ltv,
            marginCallRatioBps: 8500,
            cureBy: u(cure_by),
        },
        block,
        ts,
        seq,
    )
}

pub fn cured(loan: u64, ltv: u32, block: u64, ts: i64, seq: u64) -> Ev {
    ev(
        REGISTRY,
        &sr::MarginCallCured {
            loanId: u(loan),
            ltvBps: ltv,
        },
        block,
        ts,
        seq,
    )
}

pub fn price_stale(loan: u64, ltv: u32, block: u64, ts: i64, seq: u64) -> Ev {
    ev(
        REGISTRY,
        &sr::PriceStale {
            loanId: u(loan),
            ltvBps: ltv,
            marginCallRatioBps: 8500,
        },
        block,
        ts,
        seq,
    )
}

pub fn default_breach(loan: u64, ltv: u32, block: u64, ts: i64, seq: u64) -> Ev {
    ev(
        REGISTRY,
        &sr::DefaultBreach {
            loanId: u(loan),
            ltvBps: ltv,
            defaultRatioBps: 9500,
        },
        block,
        ts,
        seq,
    )
}

pub fn default_breach_price_stale(loan: u64, ltv: u32, block: u64, ts: i64, seq: u64) -> Ev {
    ev(
        REGISTRY,
        &sr::DefaultBreachPriceStale {
            loanId: u(loan),
            ltvBps: ltv,
            defaultRatioBps: 9500,
        },
        block,
        ts,
        seq,
    )
}

pub fn default_breach_cleared(loan: u64, ltv: u32, block: u64, ts: i64, seq: u64) -> Ev {
    ev(
        REGISTRY,
        &sr::DefaultBreachCleared {
            loanId: u(loan),
            ltvBps: ltv,
        },
        block,
        ts,
        seq,
    )
}

pub fn inspection_recorded(
    loan: u64,
    rec: u64,
    insp: u64,
    lot: u64,
    kind: u8,
    block: u64,
    ts: i64,
    seq: u64,
) -> Ev {
    ev(
        NFT,
        &sr::InspectionRecorded {
            loanId: u(loan),
            recordId: u(rec),
            inspectionId: u(insp),
            lotId: u(lot),
            inspector: INSPECTOR,
            kind,
        },
        block,
        ts,
        seq,
    )
}

pub fn inspection_approved(
    loan: u64,
    rec: u64,
    insp: u64,
    flagged: bool,
    block: u64,
    ts: i64,
    seq: u64,
) -> Ev {
    ev(
        NFT,
        &sr::InspectionApproved {
            loanId: u(loan),
            recordId: u(rec),
            inspectionId: u(insp),
            approvedBy: APPROVER,
            varianceReferenceBps: -250,
            variancePreviousBps: 0,
            varianceGradeBps: 0,
            flagged,
        },
        block,
        ts,
        seq,
    )
}

pub fn flag_resolved(
    loan: u64,
    rec: u64,
    insp: u64,
    outcome: u8,
    block: u64,
    ts: i64,
    seq: u64,
) -> Ev {
    ev(
        REGISTRY,
        &sr::FlagResolved {
            loanId: u(loan),
            recordId: u(rec),
            inspectionId: u(insp),
            outcome,
            reasonHash: hash(0x77),
        },
        block,
        ts,
        seq,
    )
}

pub fn released(
    loan: u64,
    rec: u64,
    byte: u8,
    by_consent: bool,
    block: u64,
    ts: i64,
    seq: u64,
) -> Ev {
    ev(
        REGISTRY,
        &sr::RecordReleased {
            loanId: u(loan),
            recordId: u(rec),
            reasonHash: hash(byte),
            byConsent: by_consent,
        },
        block,
        ts,
        seq,
    )
}

pub fn extension_consent(loan: u64, maturity: u64, byte: u8, block: u64, ts: i64, seq: u64) -> Ev {
    ev(
        REGISTRY,
        &sr::ExtensionConsent {
            loanId: u(loan),
            newMaturity: maturity,
            consentHash: hash(byte),
        },
        block,
        ts,
        seq,
    )
}
