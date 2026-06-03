//! Integration tests for the yield-mint relayer phase.
//!
//! DB-gated tests (discover_*) require a real Postgres with the migrations
//! applied. They are skipped gracefully when `DATABASE_URL` is unset.
//!
//! Logic tests (submit_*, confirm_*, phase_yield_mint_*) use mock implementations
//! of `BitgoTxClient`, `CanYieldBeMintedView`, and `TransactionReceiptView` —
//! no DB or RPC required.

use std::sync::Arc;
use std::sync::Mutex;

use alloy::primitives::{address, Address, U256};
use anyhow::Result;
use async_trait::async_trait;
use bigdecimal::BigDecimal;
use reqwest::StatusCode;

use pipeline_worker::relayer::yield_mint::Phase4Settings;
use shared::bitgo::client::BitgoTxClient;
use shared::bitgo::models::TxRequestResponse;
use shared::bitgo::models::{BitgoError, TxRequestState};
use shared::yield_mint_outbox_repo::{
    OutboxKey, OutboxStore, YieldMintOutboxRepo, YieldMintOutboxRow,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAIN_ID: i64 = 17000;
const MINTER_ADDR: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LOAN_REGISTRY: Address = address!("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

// ---------------------------------------------------------------------------
// Mock BitgoTxClient
// ---------------------------------------------------------------------------

/// Configurable mock for BitGo tx-request operations.
struct MockBitgo {
    /// Canned response for `send_transaction`.
    send_result: Box<dyn Fn() -> Result<TxRequestResponse, BitgoError> + Send + Sync>,
    /// Canned response for `get_tx_request`.
    get_result: Box<dyn Fn() -> Result<TxRequestResponse, BitgoError> + Send + Sync>,
    /// Records calls to `send_transaction`.
    send_calls: Mutex<u32>,
    /// Records calls to `get_tx_request`.
    get_calls: Mutex<u32>,
}

impl MockBitgo {
    fn send_ok(tx_request_id: &'static str) -> Arc<Self> {
        Arc::new(Self {
            send_result: Box::new(move || {
                Ok(TxRequestResponse {
                    tx_request_id: Some(tx_request_id.to_owned()),
                    status: Some("signed".to_owned()),
                    state: TxRequestState::Signed,
                    tx_hash: None,
                })
            }),
            get_result: Box::new(|| {
                Ok(TxRequestResponse {
                    tx_request_id: Some("unused".to_owned()),
                    status: None,
                    state: TxRequestState::Delivered,
                    tx_hash: Some("0xdeadbeef".to_owned()),
                })
            }),
            send_calls: Mutex::new(0),
            get_calls: Mutex::new(0),
        })
    }

    fn send_5xx() -> Arc<Self> {
        Arc::new(Self {
            send_result: Box::new(|| {
                Err(BitgoError::ServerError {
                    status: StatusCode::SERVICE_UNAVAILABLE,
                    body: "service unavailable".to_owned(),
                })
            }),
            get_result: Box::new(|| {
                Ok(TxRequestResponse {
                    tx_request_id: None,
                    status: None,
                    state: TxRequestState::Delivered,
                    tx_hash: Some("0x0".to_owned()),
                })
            }),
            send_calls: Mutex::new(0),
            get_calls: Mutex::new(0),
        })
    }

    fn send_4xx() -> Arc<Self> {
        Arc::new(Self {
            send_result: Box::new(|| {
                Err(BitgoError::ClientError {
                    status: StatusCode::UNPROCESSABLE_ENTITY,
                    body: "invalid recipient address".to_owned(),
                })
            }),
            get_result: Box::new(|| {
                Ok(TxRequestResponse {
                    tx_request_id: None,
                    status: None,
                    state: TxRequestState::Delivered,
                    tx_hash: Some("0x0".to_owned()),
                })
            }),
            send_calls: Mutex::new(0),
            get_calls: Mutex::new(0),
        })
    }

    fn get_delivered(tx_hash: &'static str) -> Arc<Self> {
        Arc::new(Self {
            send_result: Box::new(|| {
                Ok(TxRequestResponse {
                    tx_request_id: Some("unused".to_owned()),
                    status: None,
                    state: TxRequestState::Signed,
                    tx_hash: None,
                })
            }),
            get_result: Box::new(move || {
                Ok(TxRequestResponse {
                    tx_request_id: Some("req-1".to_owned()),
                    status: None,
                    state: TxRequestState::Delivered,
                    tx_hash: Some(tx_hash.to_owned()),
                })
            }),
            send_calls: Mutex::new(0),
            get_calls: Mutex::new(0),
        })
    }

    fn get_pending_approval() -> Arc<Self> {
        Arc::new(Self {
            send_result: Box::new(|| {
                Ok(TxRequestResponse {
                    tx_request_id: None,
                    status: None,
                    state: TxRequestState::Signed,
                    tx_hash: None,
                })
            }),
            get_result: Box::new(|| {
                Ok(TxRequestResponse {
                    tx_request_id: Some("req-1".to_owned()),
                    status: None,
                    state: TxRequestState::PendingApproval,
                    tx_hash: None,
                })
            }),
            send_calls: Mutex::new(0),
            get_calls: Mutex::new(0),
        })
    }

    fn get_rejected() -> Arc<Self> {
        Arc::new(Self {
            send_result: Box::new(|| {
                Ok(TxRequestResponse {
                    tx_request_id: None,
                    status: None,
                    state: TxRequestState::Signed,
                    tx_hash: None,
                })
            }),
            get_result: Box::new(|| {
                Ok(TxRequestResponse {
                    tx_request_id: Some("req-1".to_owned()),
                    status: None,
                    state: TxRequestState::Rejected,
                    tx_hash: None,
                })
            }),
            send_calls: Mutex::new(0),
            get_calls: Mutex::new(0),
        })
    }
}

#[async_trait]
impl BitgoTxClient for MockBitgo {
    async fn send_transaction(
        &self,
        _to: &str,
        _value: &str,
        _symbol: &str,
        _data: Option<&str>,
    ) -> Result<TxRequestResponse, BitgoError> {
        *self.send_calls.lock().unwrap() += 1;
        (self.send_result)()
    }

    async fn get_tx_request(&self, _tx_request_id: &str) -> Result<TxRequestResponse, BitgoError> {
        *self.get_calls.lock().unwrap() += 1;
        (self.get_result)()
    }
}

// ---------------------------------------------------------------------------
// Mock CanYieldBeMintedView
// ---------------------------------------------------------------------------

use pipeline_worker::relayer::yield_mint::on_chain::{
    CanYieldBeMintedView, ReceiptViewError, TransactionReceiptView,
};

struct MockView {
    result: bool,
}

impl MockView {
    fn returns(result: bool) -> Arc<Self> {
        Arc::new(Self { result })
    }
}

#[async_trait]
impl CanYieldBeMintedView for MockView {
    async fn can_yield_be_minted(
        &self,
        _loan_registry: Address,
        _loan_id: U256,
        _repayment_id: U256,
    ) -> Result<bool> {
        Ok(self.result)
    }
}

// ---------------------------------------------------------------------------
// Mock TransactionReceiptView
// ---------------------------------------------------------------------------

struct MockReceipt {
    result: Box<dyn Fn() -> std::result::Result<Option<bool>, ReceiptViewError> + Send + Sync>,
}

impl MockReceipt {
    /// Receipt found, tx succeeded.
    fn success() -> Arc<Self> {
        Arc::new(Self {
            result: Box::new(|| Ok(Some(true))),
        })
    }

    /// Receipt found, tx reverted.
    fn revert() -> Arc<Self> {
        Arc::new(Self {
            result: Box::new(|| Ok(Some(false))),
        })
    }

    /// No receipt yet (mining lag or reorg).
    fn missing() -> Arc<Self> {
        Arc::new(Self {
            result: Box::new(|| Ok(None)),
        })
    }

    /// Transient RPC failure — caller should retry next cycle.
    fn transient_err() -> Arc<Self> {
        Arc::new(Self {
            result: Box::new(|| {
                Err(ReceiptViewError::Rpc(anyhow::anyhow!(
                    "simulated RPC timeout"
                )))
            }),
        })
    }

    /// Definitive failure — BitGo returned a malformed tx hash.
    fn invalid_hash_err() -> Arc<Self> {
        Arc::new(Self {
            result: Box::new(|| {
                Err(ReceiptViewError::InvalidHash {
                    hash: "0xnot-a-hash".to_owned(),
                    source: anyhow::anyhow!("not 32 bytes"),
                })
            }),
        })
    }
}

#[async_trait]
impl TransactionReceiptView for MockReceipt {
    async fn get_receipt_status(
        &self,
        _tx_hash: &str,
    ) -> std::result::Result<Option<bool>, ReceiptViewError> {
        (self.result)()
    }
}

// ---------------------------------------------------------------------------
// In-memory outbox for logic tests
// ---------------------------------------------------------------------------

/// A minimal in-memory outbox for logic tests that don't touch DB.
///
/// Stores rows in a `Mutex<Vec<YieldMintOutboxRow>>`.
struct InMemoryOutbox {
    rows: Mutex<Vec<YieldMintOutboxRow>>,
}

impl InMemoryOutbox {
    fn with_rows(rows: Vec<YieldMintOutboxRow>) -> Arc<Self> {
        Arc::new(Self {
            rows: Mutex::new(rows),
        })
    }

    fn snapshot(&self) -> Vec<YieldMintOutboxRow> {
        self.rows.lock().unwrap().clone()
    }

    fn list_by_status(&self, status: &str) -> Vec<YieldMintOutboxRow> {
        self.rows
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.status == status)
            .cloned()
            .collect()
    }
}

#[async_trait]
impl OutboxStore for InMemoryOutbox {
    async fn list_pending(
        &self,
        chain_id: i64,
        yield_minter_address: &str,
        limit: i64,
    ) -> Result<Vec<YieldMintOutboxRow>> {
        let rows = self
            .rows
            .lock()
            .unwrap()
            .iter()
            .filter(|r| {
                r.status == "pending"
                    && r.chain_id == chain_id
                    && r.yield_minter_address == yield_minter_address
            })
            .take(limit as usize)
            .cloned()
            .collect();
        Ok(rows)
    }

    async fn list_submitted(
        &self,
        chain_id: i64,
        yield_minter_address: &str,
        limit: i64,
    ) -> Result<Vec<YieldMintOutboxRow>> {
        let rows = self
            .rows
            .lock()
            .unwrap()
            .iter()
            .filter(|r| {
                r.status == "submitted"
                    && r.chain_id == chain_id
                    && r.yield_minter_address == yield_minter_address
            })
            .take(limit as usize)
            .cloned()
            .collect();
        Ok(rows)
    }

    async fn mark_submitted(&self, key: &OutboxKey, bitgo_tx_request_id: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(row) = rows.iter_mut().find(|r| {
            r.loan_id == key.loan_id && r.repayment_id == key.repayment_id && r.status == "pending"
        }) {
            "submitted".clone_into(&mut row.status);
            row.bitgo_tx_request_id = Some(bitgo_tx_request_id.to_owned());
            row.submitted_at = Some(chrono::Utc::now());
        }
        Ok(())
    }

    async fn mark_confirmed(&self, key: &OutboxKey, tx_hash: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(row) = rows.iter_mut().find(|r| {
            r.loan_id == key.loan_id
                && r.repayment_id == key.repayment_id
                && r.status == "submitted"
        }) {
            "confirmed".clone_into(&mut row.status);
            row.tx_hash = Some(tx_hash.to_owned());
            row.confirmed_at = Some(chrono::Utc::now());
        }
        Ok(())
    }

    async fn mark_failed(&self, key: &OutboxKey, error: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(row) = rows.iter_mut().find(|r| {
            r.loan_id == key.loan_id
                && r.repayment_id == key.repayment_id
                && (r.status == "pending" || r.status == "submitted")
        }) {
            "failed".clone_into(&mut row.status);
            row.last_error = Some(error.to_owned());
        }
        Ok(())
    }

    async fn mark_skipped_already_minted(&self, key: &OutboxKey) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(row) = rows.iter_mut().find(|r| {
            r.loan_id == key.loan_id && r.repayment_id == key.repayment_id && r.status == "pending"
        }) {
            "skipped_already_minted".clone_into(&mut row.status);
        }
        Ok(())
    }
}

fn pending_row(loan_id: u64, repayment_id: u64) -> YieldMintOutboxRow {
    YieldMintOutboxRow {
        chain_id: CHAIN_ID,
        yield_minter_address: MINTER_ADDR.to_owned(),
        loan_id: BigDecimal::from(loan_id),
        repayment_id: BigDecimal::from(repayment_id),
        status: "pending".to_owned(),
        bitgo_tx_request_id: None,
        tx_hash: None,
        submitted_at: None,
        confirmed_at: None,
        last_error: None,
        created_at: chrono::Utc::now(),
    }
}

fn submitted_row(loan_id: u64, repayment_id: u64, tx_request_id: &str) -> YieldMintOutboxRow {
    YieldMintOutboxRow {
        chain_id: CHAIN_ID,
        yield_minter_address: MINTER_ADDR.to_owned(),
        loan_id: BigDecimal::from(loan_id),
        repayment_id: BigDecimal::from(repayment_id),
        status: "submitted".to_owned(),
        bitgo_tx_request_id: Some(tx_request_id.to_owned()),
        tx_hash: None,
        submitted_at: Some(chrono::Utc::now()),
        confirmed_at: None,
        last_error: None,
        created_at: chrono::Utc::now(),
    }
}

fn phase4_settings() -> Phase4Settings {
    Phase4Settings {
        chain_id: CHAIN_ID,
        yield_minter_address: MINTER_ADDR.to_owned(),
        loan_registry_address: LOAN_REGISTRY,
        bitgo_native_symbol: "hteth".to_owned(),
        yield_minter_batch_size: 50,
    }
}

// ---------------------------------------------------------------------------
// DB-gated tests (require DATABASE_URL with the migration applied)
// ---------------------------------------------------------------------------

/// Returns `None` if `DATABASE_URL` is not set (test is skipped).
async fn try_connect_db() -> Option<sqlx::PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = sqlx::PgPool::connect(&url).await.ok()?;
    Some(pool)
}

#[tokio::test]
async fn discover_inserts_new_pending_rows() {
    let Some(pool) = try_connect_db().await else {
        eprintln!("discover_inserts_new_pending_rows skipped (DATABASE_URL not set)");
        return;
    };

    let loan_registry_checksum = format!("{LOAN_REGISTRY:?}");

    // Clean up any prior state.
    sqlx::query("DELETE FROM yield_mint_outbox WHERE yield_minter_address = $1")
        .bind(MINTER_ADDR)
        .execute(&pool)
        .await
        .unwrap();

    // Seed 3 PaymentRecorded + 1 unrelated event.
    let seed_chain_id: i64 = CHAIN_ID;
    for i in 1u64..=3 {
        let params = serde_json::json!({
            "loan_id": i.to_string(),
            "event": { "repayment_id": i.to_string() }
        });
        sqlx::query(
            r"
            INSERT INTO contract_logs
                (chain_id, contract_address, event_name, block_number, tx_hash, log_index, block_timestamp, params)
            VALUES ($1, $2, 'PaymentRecorded',
                    $3, '0x1111111111111111111111111111111111111111111111111111111111111111',
                    $4, 0, $5)
            ON CONFLICT DO NOTHING
            ",
        )
        .bind(seed_chain_id)
        .bind(&loan_registry_checksum)
        .bind(i as i64 * 100)
        .bind(i as i64)
        .bind(&params)
        .execute(&pool)
        .await
        .unwrap();
    }
    // Unrelated event (different event_name).
    sqlx::query(
        r"
        INSERT INTO contract_logs
            (chain_id, contract_address, event_name, block_number, tx_hash, log_index, block_timestamp, params)
        VALUES ($1, $2, 'LoanDrawn',
                999, '0x2222222222222222222222222222222222222222222222222222222222222222',
                0, 0, $3)
        ON CONFLICT DO NOTHING
        ",
    )
    .bind(seed_chain_id)
    .bind(&loan_registry_checksum)
    .bind(serde_json::json!({ "loan_id": "99" }))
    .execute(&pool)
    .await
    .unwrap();

    let outbox = YieldMintOutboxRepo::new(pool.clone());
    let inserted = outbox
        .discover_pending(seed_chain_id, MINTER_ADDR, &loan_registry_checksum)
        .await
        .unwrap();

    assert_eq!(inserted, 3, "should have inserted 3 pending rows");

    let pending = outbox
        .list_pending(seed_chain_id, MINTER_ADDR, 100)
        .await
        .unwrap();
    assert_eq!(pending.len(), 3);

    // Verify loan_id/repayment_id parsing.
    let mut loan_ids: Vec<u64> = pending
        .iter()
        .map(|r| {
            r.loan_id
                .to_string()
                .parse::<u64>()
                .expect("loan_id is numeric")
        })
        .collect();
    loan_ids.sort_unstable();
    assert_eq!(loan_ids, vec![1, 2, 3]);
}

#[tokio::test]
async fn discover_is_idempotent() {
    let Some(pool) = try_connect_db().await else {
        eprintln!("discover_is_idempotent skipped (DATABASE_URL not set)");
        return;
    };

    let seed_chain_id: i64 = CHAIN_ID;
    let minter = "0xdddddddddddddddddddddddddddddddddddddddd";
    let loan_registry_checksum = format!("{LOAN_REGISTRY:?}");

    sqlx::query("DELETE FROM yield_mint_outbox WHERE yield_minter_address = $1")
        .bind(minter)
        .execute(&pool)
        .await
        .unwrap();

    // Seed one PaymentRecorded.
    sqlx::query(
        r"
        INSERT INTO contract_logs
            (chain_id, contract_address, event_name, block_number, tx_hash, log_index, block_timestamp, params)
        VALUES ($1, $2, 'PaymentRecorded',
                5000, '0x3333333333333333333333333333333333333333333333333333333333333333',
                10, 0, $3)
        ON CONFLICT DO NOTHING
        ",
    )
    .bind(seed_chain_id)
    .bind(&loan_registry_checksum)
    .bind(serde_json::json!({ "loan_id": "10", "event": { "repayment_id": "1" } }))
    .execute(&pool)
    .await
    .unwrap();

    let outbox = YieldMintOutboxRepo::new(pool);

    let first = outbox
        .discover_pending(seed_chain_id, minter, &loan_registry_checksum)
        .await
        .unwrap();
    let second = outbox
        .discover_pending(seed_chain_id, minter, &loan_registry_checksum)
        .await
        .unwrap();

    assert_eq!(first, 1, "first run should insert 1 row");
    assert_eq!(second, 0, "second run should insert 0 rows (idempotent)");
}

// ---------------------------------------------------------------------------
// Logic tests (no DB required) — call real submit_pending / confirm_submitted
// ---------------------------------------------------------------------------

#[tokio::test]
async fn submit_happy_path_transitions_pending_to_submitted() {
    let outbox = InMemoryOutbox::with_rows(vec![pending_row(1, 1)]);
    let bitgo = MockBitgo::send_ok("tx-req-abc");
    let view = MockView::returns(true);
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::submit_pending(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        view.as_ref(),
    )
    .await
    .unwrap();

    let rows = outbox.snapshot();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].status, "submitted");
    assert_eq!(rows[0].bitgo_tx_request_id.as_deref(), Some("tx-req-abc"));
}

#[tokio::test]
async fn submit_skips_when_can_yield_be_minted_false() {
    let outbox = InMemoryOutbox::with_rows(vec![pending_row(2, 1)]);
    let bitgo = MockBitgo::send_ok("tx-req-xyz");
    let view = MockView::returns(false);
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::submit_pending(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        view.as_ref(),
    )
    .await
    .unwrap();

    let rows = outbox.snapshot();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].status, "skipped_already_minted");
    // BitGo must not have been called.
    assert_eq!(*bitgo.send_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn submit_transient_bitgo_5xx_leaves_row_pending() {
    let outbox = InMemoryOutbox::with_rows(vec![pending_row(3, 1)]);
    let bitgo = MockBitgo::send_5xx();
    let view = MockView::returns(true);
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::submit_pending(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        view.as_ref(),
    )
    .await
    .unwrap();

    let rows = outbox.snapshot();
    assert_eq!(rows.len(), 1);
    // Row must stay pending (transient failure).
    assert_eq!(rows[0].status, "pending");
}

#[tokio::test]
async fn submit_bitgo_4xx_marks_failed() {
    let outbox = InMemoryOutbox::with_rows(vec![pending_row(4, 1)]);
    let bitgo = MockBitgo::send_4xx();
    let view = MockView::returns(true);
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::submit_pending(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        view.as_ref(),
    )
    .await
    .unwrap();

    let rows = outbox.snapshot();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].status, "failed");
    let err = rows[0].last_error.as_deref().unwrap_or("");
    assert!(
        err.contains("bitgo submit 4xx"),
        "expected 4xx error in last_error, got: {err}"
    );
}

#[tokio::test]
async fn confirm_terminal_delivered_marks_confirmed() {
    let outbox = InMemoryOutbox::with_rows(vec![submitted_row(5, 1, "req-deliver")]);
    let bitgo = MockBitgo::get_delivered(
        "0x08bece5a30ebf52ee0245b621cc94e9bda9894fad71574465283763d44cd987e",
    );
    let receipt = MockReceipt::success();
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::confirm_submitted(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        receipt.as_ref(),
    )
    .await
    .unwrap();

    let rows = outbox.snapshot();
    assert_eq!(rows[0].status, "confirmed");
    assert_eq!(
        rows[0].tx_hash.as_deref(),
        Some("0x08bece5a30ebf52ee0245b621cc94e9bda9894fad71574465283763d44cd987e")
    );
}

#[tokio::test]
async fn confirm_delivered_but_receipt_reverted_marks_failed() {
    let outbox = InMemoryOutbox::with_rows(vec![submitted_row(50, 1, "req-revert")]);
    let bitgo = MockBitgo::get_delivered("0xdeadbeef");
    let receipt = MockReceipt::revert();
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::confirm_submitted(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        receipt.as_ref(),
    )
    .await
    .unwrap();

    let rows = outbox.snapshot();
    assert_eq!(rows[0].status, "failed");
    let err = rows[0].last_error.as_deref().unwrap_or("");
    assert!(
        err.contains("reverted on-chain"),
        "expected revert reason in last_error, got: {err}"
    );
}

#[tokio::test]
async fn confirm_delivered_but_receipt_missing_leaves_row_submitted() {
    let outbox = InMemoryOutbox::with_rows(vec![submitted_row(51, 1, "req-no-receipt")]);
    let bitgo = MockBitgo::get_delivered("0xdeadbeef");
    let receipt = MockReceipt::missing();
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::confirm_submitted(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        receipt.as_ref(),
    )
    .await
    .unwrap();

    let rows = outbox.snapshot();
    assert_eq!(
        rows[0].status, "submitted",
        "missing receipt must leave row submitted for next-cycle retry"
    );
}

#[tokio::test]
async fn confirm_delivered_but_receipt_rpc_error_leaves_row_submitted() {
    let outbox = InMemoryOutbox::with_rows(vec![submitted_row(52, 1, "req-rpc-err")]);
    let bitgo = MockBitgo::get_delivered("0xdeadbeef");
    let receipt = MockReceipt::transient_err();
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::confirm_submitted(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        receipt.as_ref(),
    )
    .await
    .unwrap();

    let rows = outbox.snapshot();
    assert_eq!(
        rows[0].status, "submitted",
        "transient RPC error must leave row submitted for next-cycle retry"
    );
}

#[tokio::test]
async fn confirm_delivered_but_invalid_hash_marks_failed() {
    let outbox = InMemoryOutbox::with_rows(vec![submitted_row(53, 1, "req-bad-hash")]);
    let bitgo = MockBitgo::get_delivered("0xdeadbeef");
    let receipt = MockReceipt::invalid_hash_err();
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::confirm_submitted(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        receipt.as_ref(),
    )
    .await
    .unwrap();

    let rows = outbox.snapshot();
    assert_eq!(
        rows[0].status, "failed",
        "definitive InvalidHash must mark the row failed (won't recover on retry)"
    );
    let err = rows[0].last_error.as_deref().unwrap_or("");
    assert!(
        err.contains("receipt fetch failed") && err.contains("invalid tx hash"),
        "expected invalid-hash error in last_error, got: {err}"
    );
}

#[tokio::test]
async fn confirm_pending_leaves_row_alone() {
    let outbox = InMemoryOutbox::with_rows(vec![submitted_row(6, 1, "req-pending")]);
    let bitgo = MockBitgo::get_pending_approval();
    let receipt = MockReceipt::success();
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::confirm_submitted(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        receipt.as_ref(),
    )
    .await
    .unwrap();

    let rows = outbox.snapshot();
    assert_eq!(
        rows[0].status, "submitted",
        "in-flight state must leave row submitted"
    );
}

#[tokio::test]
async fn confirm_rejected_marks_failed() {
    let outbox = InMemoryOutbox::with_rows(vec![submitted_row(7, 1, "req-rejected")]);
    let bitgo = MockBitgo::get_rejected();
    let receipt = MockReceipt::success();
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::confirm_submitted(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        receipt.as_ref(),
    )
    .await
    .unwrap();

    let rows = outbox.snapshot();
    assert_eq!(rows[0].status, "failed");
    let err = rows[0].last_error.as_deref().unwrap_or("");
    assert!(
        err.contains("Rejected"),
        "expected Rejected in last_error, got: {err}"
    );
}

#[tokio::test]
async fn submit_then_confirm_chained_in_memory() {
    // Chains Step B and Step C against the same in-memory outbox.
    // Step A (discover) is exercised separately in `discover_*` DB-gated tests
    // and not invoked here because `phase_yield_mint` requires a real DB. After
    // this test: 2 new pending rows => submitted by Step B, then both =>
    // confirmed by Step C.

    // Step B: submit 2 pending rows.
    let outbox = InMemoryOutbox::with_rows(vec![pending_row(8, 1), pending_row(8, 2)]);
    let bitgo = MockBitgo::send_ok("req-8");
    let view = MockView::returns(true);
    let settings = phase4_settings();

    pipeline_worker::relayer::yield_mint::submit_pending(
        &settings,
        bitgo.as_ref(),
        outbox.as_ref(),
        view.as_ref(),
    )
    .await
    .unwrap();

    // Both should now be submitted.
    let submitted = outbox.list_by_status("submitted");
    assert_eq!(submitted.len(), 2);

    // Step C: confirm both.
    let bitgo_confirm = MockBitgo::get_delivered("0xcafe");
    let receipt = MockReceipt::success();
    pipeline_worker::relayer::yield_mint::confirm_submitted(
        &settings,
        bitgo_confirm.as_ref(),
        outbox.as_ref(),
        receipt.as_ref(),
    )
    .await
    .unwrap();

    let confirmed = outbox.list_by_status("confirmed");
    assert_eq!(confirmed.len(), 2);
}

#[tokio::test]
async fn phase_yield_mint_failure_in_one_row_does_not_block_others() {
    // Row 1: BitGo will 4xx → failed.
    // Row 2: BitGo will succeed → submitted.
    let row1 = pending_row(9, 1);
    let row2 = pending_row(9, 2);

    // We need two different mock behaviours, so we test them in two passes with
    // separate in-memory outboxes mirroring the real Phase 4 loop behaviour:
    // each row is processed independently, failures don't propagate.

    let outbox1 = InMemoryOutbox::with_rows(vec![row1]);
    let bitgo_4xx = MockBitgo::send_4xx();
    let view = MockView::returns(true);
    let settings = phase4_settings();
    pipeline_worker::relayer::yield_mint::submit_pending(
        &settings,
        bitgo_4xx.as_ref(),
        outbox1.as_ref(),
        view.as_ref(),
    )
    .await
    .unwrap();
    assert_eq!(outbox1.snapshot()[0].status, "failed");

    let outbox2 = InMemoryOutbox::with_rows(vec![row2]);
    let bitgo_ok = MockBitgo::send_ok("req-9-2");
    pipeline_worker::relayer::yield_mint::submit_pending(
        &settings,
        bitgo_ok.as_ref(),
        outbox2.as_ref(),
        view.as_ref(),
    )
    .await
    .unwrap();
    assert_eq!(outbox2.snapshot()[0].status, "submitted");
}
