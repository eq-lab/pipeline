//! Unit tests for the Stellar yield-mint relayer phase.
//!
//! Pure unit tests — no DB, no network. Orchestration is tested with a mock
//! `StellarYieldSubmitter` and an in-memory outbox; helpers are tested directly.

use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use bigdecimal::BigDecimal;
use chrono::Utc;
use stellar_strkey::Contract as ContractStrkey;
use stellar_xdr::curr::ScVal;

use pipeline_worker::relayer::stellar::yield_mint::map_get_transaction_status;
use pipeline_worker::relayer::stellar::yield_mint::{
    confirm_submitted_stellar, submit_pending_stellar, u32_from_bigdecimal, StellarPhase4Settings,
    StellarYieldSubmitter,
};
use pipeline_worker::stellar::tx::u32_val;
use shared::yield_mint_outbox_repo::{OutboxKey, OutboxStore, YieldMintOutboxRow};

#[test]
fn u32_val_builds_scval_u32() {
    assert_eq!(u32_val(7), ScVal::U32(7));
}

#[test]
fn get_transaction_status_maps_to_tristate() {
    assert_eq!(map_get_transaction_status("SUCCESS"), Some(true));
    assert_eq!(map_get_transaction_status("FAILED"), Some(false));
    assert_eq!(map_get_transaction_status("NOT_FOUND"), None);
    assert_eq!(map_get_transaction_status("PENDING"), None);
}

// ---------------------------------------------------------------------------
// Orchestration tests (Task 3)
// ---------------------------------------------------------------------------

const CHAIN_ID: i64 = 99_000_001;
// ContractStrkey([0u8; 32]).to_string() — verified at runtime.
const MINTER_C: &str = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

fn settings() -> StellarPhase4Settings {
    let id = ContractStrkey([0u8; 32]);
    StellarPhase4Settings {
        chain_id: CHAIN_ID,
        yield_minter_id: id,
        loan_registry_id: id,
        batch_size: 50,
    }
}

/// Mock submitter with canned, call-counting behavior.
struct MockSubmitter {
    can_mint: Box<dyn Fn() -> Result<bool> + Send + Sync>,
    submit: Box<dyn Fn() -> Result<String> + Send + Sync>,
    check: Box<dyn Fn() -> Result<Option<bool>> + Send + Sync>,
    submit_calls: Mutex<u32>,
}

impl MockSubmitter {
    fn new(
        can_mint: impl Fn() -> Result<bool> + Send + Sync + 'static,
        submit: impl Fn() -> Result<String> + Send + Sync + 'static,
        check: impl Fn() -> Result<Option<bool>> + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            can_mint: Box::new(can_mint),
            submit: Box::new(submit),
            check: Box::new(check),
            submit_calls: Mutex::new(0),
        })
    }
}

#[async_trait]
impl StellarYieldSubmitter for MockSubmitter {
    async fn can_yield_be_minted(&self, _loan_id: u32, _repayment_id: u32) -> Result<bool> {
        (self.can_mint)()
    }
    async fn submit_mint_yield(&self, _loan_id: u32, _repayment_id: u32) -> Result<String> {
        *self.submit_calls.lock().unwrap() += 1;
        (self.submit)()
    }
    async fn check_tx(&self, _tx_hash: &str) -> Result<Option<bool>> {
        (self.check)()
    }
}

struct InMemoryOutbox {
    rows: Mutex<Vec<YieldMintOutboxRow>>,
}

impl InMemoryOutbox {
    fn with_rows(rows: Vec<YieldMintOutboxRow>) -> Arc<Self> {
        Arc::new(Self {
            rows: Mutex::new(rows),
        })
    }
    fn status_of(&self, loan_id: u64) -> String {
        let ld = BigDecimal::from(loan_id);
        self.rows
            .lock()
            .unwrap()
            .iter()
            .find(|r| r.loan_id == ld)
            .unwrap()
            .status
            .clone()
    }
    fn tx_hash_of(&self, loan_id: u64) -> Option<String> {
        let ld = BigDecimal::from(loan_id);
        self.rows
            .lock()
            .unwrap()
            .iter()
            .find(|r| r.loan_id == ld)
            .unwrap()
            .tx_hash
            .clone()
    }
}

#[async_trait]
impl OutboxStore for InMemoryOutbox {
    async fn list_pending(
        &self,
        chain_id: i64,
        addr: &str,
        limit: i64,
    ) -> Result<Vec<YieldMintOutboxRow>> {
        Ok(self
            .rows
            .lock()
            .unwrap()
            .iter()
            .filter(|r| {
                r.status == "pending" && r.chain_id == chain_id && r.yield_minter_address == addr
            })
            .take(limit as usize)
            .cloned()
            .collect())
    }
    async fn list_submitted(
        &self,
        chain_id: i64,
        addr: &str,
        limit: i64,
    ) -> Result<Vec<YieldMintOutboxRow>> {
        Ok(self
            .rows
            .lock()
            .unwrap()
            .iter()
            .filter(|r| {
                r.status == "submitted" && r.chain_id == chain_id && r.yield_minter_address == addr
            })
            .take(limit as usize)
            .cloned()
            .collect())
    }
    async fn mark_submitted(&self, key: &OutboxKey, bitgo_tx_request_id: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(r) = rows.iter_mut().find(|r| {
            r.loan_id == key.loan_id && r.repayment_id == key.repayment_id && r.status == "pending"
        }) {
            "submitted".clone_into(&mut r.status);
            r.bitgo_tx_request_id = Some(bitgo_tx_request_id.to_owned());
            r.submitted_at = Some(Utc::now());
        }
        Ok(())
    }
    async fn mark_submitted_stellar(&self, key: &OutboxKey, tx_hash: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(r) = rows.iter_mut().find(|r| {
            r.loan_id == key.loan_id && r.repayment_id == key.repayment_id && r.status == "pending"
        }) {
            "submitted".clone_into(&mut r.status);
            r.tx_hash = Some(tx_hash.to_owned());
            r.submitted_at = Some(Utc::now());
        }
        Ok(())
    }
    async fn mark_confirmed(&self, key: &OutboxKey, tx_hash: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(r) = rows.iter_mut().find(|r| {
            r.loan_id == key.loan_id
                && r.repayment_id == key.repayment_id
                && r.status == "submitted"
        }) {
            "confirmed".clone_into(&mut r.status);
            r.tx_hash = Some(tx_hash.to_owned());
            r.confirmed_at = Some(Utc::now());
        }
        Ok(())
    }
    async fn mark_failed(&self, key: &OutboxKey, error: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(r) = rows.iter_mut().find(|r| {
            r.loan_id == key.loan_id
                && r.repayment_id == key.repayment_id
                && (r.status == "pending" || r.status == "submitted")
        }) {
            "failed".clone_into(&mut r.status);
            r.last_error = Some(error.to_owned());
        }
        Ok(())
    }
    async fn mark_skipped_already_minted(&self, key: &OutboxKey) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(r) = rows.iter_mut().find(|r| {
            r.loan_id == key.loan_id && r.repayment_id == key.repayment_id && r.status == "pending"
        }) {
            "skipped_already_minted".clone_into(&mut r.status);
        }
        Ok(())
    }
}

fn row(loan_id: u64, repayment_id: u64, status: &str) -> YieldMintOutboxRow {
    YieldMintOutboxRow {
        chain_id: CHAIN_ID,
        yield_minter_address: MINTER_C.to_owned(),
        loan_id: BigDecimal::from(loan_id),
        repayment_id: BigDecimal::from(repayment_id),
        status: status.to_owned(),
        bitgo_tx_request_id: None,
        tx_hash: if status == "submitted" {
            Some("abc123".to_owned())
        } else {
            None
        },
        submitted_at: None,
        confirmed_at: None,
        last_error: None,
        created_at: Utc::now(),
    }
}

#[tokio::test]
async fn submit_skips_when_guard_false() {
    let outbox = InMemoryOutbox::with_rows(vec![row(1, 1, "pending")]);
    let sub = MockSubmitter::new(|| Ok(false), || Ok("h".into()), || Ok(None));
    submit_pending_stellar(&settings(), sub.as_ref(), outbox.as_ref())
        .await
        .unwrap();
    assert_eq!(outbox.status_of(1), "skipped_already_minted");
    assert_eq!(*sub.submit_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn submit_retries_on_guard_transient_error() {
    let outbox = InMemoryOutbox::with_rows(vec![row(2, 1, "pending")]);
    let sub = MockSubmitter::new(|| Err(anyhow!("rpc down")), || Ok("h".into()), || Ok(None));
    submit_pending_stellar(&settings(), sub.as_ref(), outbox.as_ref())
        .await
        .unwrap();
    assert_eq!(outbox.status_of(2), "pending");
    assert_eq!(*sub.submit_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn submit_marks_submitted_with_tx_hash() {
    let outbox = InMemoryOutbox::with_rows(vec![row(3, 1, "pending")]);
    let sub = MockSubmitter::new(|| Ok(true), || Ok("deadbeefhash".into()), || Ok(None));
    submit_pending_stellar(&settings(), sub.as_ref(), outbox.as_ref())
        .await
        .unwrap();
    assert_eq!(outbox.status_of(3), "submitted");
    assert_eq!(outbox.tx_hash_of(3).as_deref(), Some("deadbeefhash"));
}

#[tokio::test]
async fn submit_leaves_pending_on_submit_error() {
    let outbox = InMemoryOutbox::with_rows(vec![row(4, 1, "pending")]);
    let sub = MockSubmitter::new(|| Ok(true), || Err(anyhow!("send failed")), || Ok(None));
    submit_pending_stellar(&settings(), sub.as_ref(), outbox.as_ref())
        .await
        .unwrap();
    assert_eq!(outbox.status_of(4), "pending");
    assert_eq!(*sub.submit_calls.lock().unwrap(), 1);
}

#[tokio::test]
async fn submit_fails_row_when_id_out_of_u32_range() {
    // loan_id = u32::MAX + 1
    let mut bad = row(0, 1, "pending");
    bad.loan_id = BigDecimal::from(u64::from(u32::MAX) + 1);
    let outbox = InMemoryOutbox::with_rows(vec![bad]);
    let sub = MockSubmitter::new(|| Ok(true), || Ok("h".into()), || Ok(None));
    submit_pending_stellar(&settings(), sub.as_ref(), outbox.as_ref())
        .await
        .unwrap();
    // loan_id key for status lookup is the oversized value
    let st = outbox.rows.lock().unwrap()[0].status.clone();
    assert_eq!(st, "failed");
    assert_eq!(*sub.submit_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn confirm_marks_confirmed_on_success() {
    let outbox = InMemoryOutbox::with_rows(vec![row(5, 1, "submitted")]);
    let sub = MockSubmitter::new(|| Ok(true), || Ok("h".into()), || Ok(Some(true)));
    confirm_submitted_stellar(&settings(), sub.as_ref(), outbox.as_ref())
        .await
        .unwrap();
    assert_eq!(outbox.status_of(5), "confirmed");
}

#[tokio::test]
async fn confirm_marks_failed_on_failed() {
    let outbox = InMemoryOutbox::with_rows(vec![row(6, 1, "submitted")]);
    let sub = MockSubmitter::new(|| Ok(true), || Ok("h".into()), || Ok(Some(false)));
    confirm_submitted_stellar(&settings(), sub.as_ref(), outbox.as_ref())
        .await
        .unwrap();
    assert_eq!(outbox.status_of(6), "failed");
}

#[tokio::test]
async fn confirm_leaves_submitted_when_in_flight() {
    let outbox = InMemoryOutbox::with_rows(vec![row(7, 1, "submitted")]);
    let sub = MockSubmitter::new(|| Ok(true), || Ok("h".into()), || Ok(None));
    confirm_submitted_stellar(&settings(), sub.as_ref(), outbox.as_ref())
        .await
        .unwrap();
    assert_eq!(outbox.status_of(7), "submitted");
}

#[tokio::test]
async fn confirm_leaves_submitted_on_check_tx_error() {
    let outbox = InMemoryOutbox::with_rows(vec![row(8, 1, "submitted")]);
    let sub = MockSubmitter::new(|| Ok(true), || Ok("h".into()), || Err(anyhow!("rpc err")));
    confirm_submitted_stellar(&settings(), sub.as_ref(), outbox.as_ref())
        .await
        .unwrap();
    assert_eq!(outbox.status_of(8), "submitted");
}

#[test]
fn u32_from_bigdecimal_rejects_out_of_range() {
    assert_eq!(u32_from_bigdecimal(&BigDecimal::from(42u64)), Some(42));
    assert_eq!(
        u32_from_bigdecimal(&BigDecimal::from(u64::from(u32::MAX) + 1)),
        None
    );
    assert_eq!(u32_from_bigdecimal(&BigDecimal::from(-1i64)), None);
}
