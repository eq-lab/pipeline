//! Unit tests for the unified LoanEventMapper (Issue #442, genericised in #620).
//! Uses mock implementations of all resolver/fetcher traits — no DB, no RPC.
//!
//! Covers both EVM (`Address, U256`) and Stellar (`StellarAddress, u32`) instantiations
//! of the same generic `LoanEventMapper<A, Id>`. EVM tests are the regression gate for
//! the genericisation refactor.

use std::str::FromStr;
use std::sync::Arc;

use alloy::primitives::{address, Address, U256};
use async_trait::async_trait;
use bigdecimal::BigDecimal;

use pipeline_worker::indexer::{
    loan_mapper::{
        closure_reason_name, compose_drawn_snapshot, compose_lifecycle_snapshot, loan_status_name,
        maybe_fetch_refreshed_json, LoanEvent, LoanEventMapper,
    },
    loan_metadata::{
        BlockHint, ImmutableDataResolver, ImmutableLoanDataView, LoanAddress, LoanMetadataFetcher,
        LoanMetadataJson, LocationType, LocationUpdateView, MutableDataResolver,
        MutableLoanDataView, RepaymentDataView,
    },
    stellar::loan_registry_reader::StellarAddress,
};
use shared::{
    json_numeric::u256_to_bigdecimal,
    loan_snapshot::{LoanSnapshot, LocationUpdateSnapshot, RepaymentSnapshot},
    log_mapper::LogMapper,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTRACT: Address = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const STELLAR_CONTRACT: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";

// ---------------------------------------------------------------------------
// EVM mock resolver implementations
// ---------------------------------------------------------------------------

struct MockImmutableResolver;

#[async_trait]
impl ImmutableDataResolver<Address, U256> for MockImmutableResolver {
    async fn immutable_loan_data(
        &self,
        _contract: &Address,
        _loan_id: U256,
    ) -> anyhow::Result<ImmutableLoanDataView> {
        Ok(ImmutableLoanDataView {
            original_facility_size: U256::from(120_000_u64),
            original_senior_tranche: U256::from(100_000_u64),
            original_equity_tranche: U256::from(20_000_u64),
            original_offtaker_price: U256::from(120_000_u64),
            senior_interest_rate_bps: 1200_u32,
            origination_date: 1_000_000_u64,
            original_maturity_date: 2_000_000_u64,
        })
    }
}

fn mock_repayment() -> RepaymentDataView {
    RepaymentDataView {
        offtaker_received: U256::from(0_u64),
        senior_principal_repaid: U256::from(0_u64),
        senior_interest: U256::from(0_u64),
        equity_distributed: U256::from(0_u64),
        mgmt_fee: U256::from(0_u64),
        perf_fee: U256::from(0_u64),
        oet_alloc: U256::from(0_u64),
    }
}

fn mock_location() -> LocationUpdateView {
    LocationUpdateView {
        location_type: LocationType::Vessel,
        location_identifier: "LOC-001".to_owned(),
        tracking_url: "https://track.example.com/LOC-001".to_owned(),
        updated_at: 0,
    }
}

fn mock_mutable_view(block_number: u64) -> MutableLoanDataView {
    MutableLoanDataView {
        next_economics_epochs_id: alloy::primitives::U256::from(1_u64),
        next_repayment_id: alloy::primitives::U256::from(0_u64),
        status: 0, // Performing
        ccr_bps: 8000,
        last_reported_ccr_timestamp: block_number * 12,
        current_maturity_timestamp: block_number * 12,
        closure_reason: 0, // None
        current_location: mock_location(),
        metadata_uri: "ipfs://Qm_test".to_owned(),
    }
}

struct MockMutableResolver {
    /// Returns a view that embeds the block number so tests can verify block-pinning.
    expected_block_number: u64,
}

#[async_trait]
impl MutableDataResolver<Address, U256> for MockMutableResolver {
    async fn mutable_loan_data(
        &self,
        _contract: &Address,
        _loan_id: U256,
        block: BlockHint,
    ) -> anyhow::Result<MutableLoanDataView> {
        assert_eq!(
            block.0, self.expected_block_number,
            "block-pinning mismatch"
        );
        Ok(mock_mutable_view(self.expected_block_number))
    }

    async fn cumulative_repayment_data(
        &self,
        _contract: &Address,
        _loan_id: U256,
        block: BlockHint,
    ) -> anyhow::Result<RepaymentDataView> {
        assert_eq!(
            block.0, self.expected_block_number,
            "block-pinning mismatch"
        );
        Ok(mock_repayment())
    }
}

struct MockMetadataFetcher;

#[async_trait]
impl LoanMetadataFetcher for MockMetadataFetcher {
    async fn fetch_metadata(&self, _uri: &str) -> anyhow::Result<LoanMetadataJson> {
        Ok(LoanMetadataJson {
            originator: "TestOriginator".to_owned(),
            borrower_id: "BRW-001".to_owned(),
            commodity: "Cotton".to_owned(),
            corridor: "US-NG".to_owned(),
            governing_law: "EN".to_owned(),
            metadata_uri: Some("ipfs://Qm_secondary".to_owned()),
        })
    }
}

/// A fetcher mock that panics if invoked — used to assert that the fetcher is NOT
/// called when the on-chain URI is unchanged.
struct PanickingFetcher;

#[async_trait]
impl LoanMetadataFetcher for PanickingFetcher {
    async fn fetch_metadata(&self, _uri: &str) -> anyhow::Result<LoanMetadataJson> {
        panic!("fetcher should not be called");
    }
}

/// A fetcher mock that always returns an error — used to verify error propagation.
struct FailingFetcher;

#[async_trait]
impl LoanMetadataFetcher for FailingFetcher {
    async fn fetch_metadata(&self, _uri: &str) -> anyhow::Result<LoanMetadataJson> {
        anyhow::bail!("simulated IPFS fetch failure")
    }
}

// ---------------------------------------------------------------------------
// Stellar mock resolver implementations
// ---------------------------------------------------------------------------

struct MockStellarImmutableResolver;

#[async_trait]
impl ImmutableDataResolver<StellarAddress, u32> for MockStellarImmutableResolver {
    async fn immutable_loan_data(
        &self,
        _contract: &StellarAddress,
        _loan_id: u32,
    ) -> anyhow::Result<ImmutableLoanDataView> {
        Ok(ImmutableLoanDataView {
            original_facility_size: U256::from(500_000_u64),
            original_senior_tranche: U256::from(400_000_u64),
            original_equity_tranche: U256::from(100_000_u64),
            original_offtaker_price: U256::from(500_000_u64),
            senior_interest_rate_bps: 800_u32,
            origination_date: 1_700_000_000_u64,
            original_maturity_date: 1_800_000_000_u64,
        })
    }
}

struct MockStellarMutableResolver;

#[async_trait]
impl MutableDataResolver<StellarAddress, u32> for MockStellarMutableResolver {
    async fn mutable_loan_data(
        &self,
        _contract: &StellarAddress,
        _loan_id: u32,
        _block: BlockHint,
    ) -> anyhow::Result<MutableLoanDataView> {
        Ok(MutableLoanDataView {
            next_economics_epochs_id: U256::from(1_u64),
            next_repayment_id: U256::from(0_u64),
            status: 0, // Performing
            ccr_bps: 7500,
            last_reported_ccr_timestamp: 1_700_010_000_u64,
            current_maturity_timestamp: 1_800_000_000_u64,
            closure_reason: 0, // None
            current_location: mock_location(),
            metadata_uri: "ipfs://Qm_stellar_test".to_owned(),
        })
    }

    async fn cumulative_repayment_data(
        &self,
        _contract: &StellarAddress,
        _loan_id: u32,
        _block: BlockHint,
    ) -> anyhow::Result<RepaymentDataView> {
        Ok(mock_repayment())
    }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn loan_drawn_event_evm(loan_id: u64, block_number: u64) -> LoanEvent<Address> {
    LoanEvent {
        contract_address: CONTRACT,
        event_name: "LoanDrawn".to_owned(),
        block_number,
        tx_hash: format!("0x{:064x}", 0x1111_u64),
        log_index: 0,
        block_timestamp: block_number * 12,
        params: serde_json::json!({ "loan_id": loan_id.to_string() }),
    }
}

fn lifecycle_event_evm(
    event_name: &str,
    loan_id: u64,
    block_number: u64,
    log_index: u64,
) -> LoanEvent<Address> {
    LoanEvent {
        contract_address: CONTRACT,
        event_name: event_name.to_owned(),
        block_number,
        tx_hash: format!("0x{:064x}", 0x1111_u64),
        log_index,
        block_timestamp: block_number * 12,
        params: serde_json::json!({ "loan_id": loan_id.to_string() }),
    }
}

fn make_loan_event_mapper_evm(
    event: LoanEvent<Address>,
    block_number: u64,
    pool: sqlx::PgPool,
) -> LoanEventMapper<Address, U256> {
    let event_repo = Arc::new(shared::db::EventRepo::new(pool.clone()));
    let contract_logs_repo = Arc::new(shared::contract_logs_repo::ContractLogsRepo::new(pool));
    LoanEventMapper::<Address, U256>::new(
        event,
        1,
        event_repo,
        contract_logs_repo,
        Arc::new(MockMetadataFetcher),
        Arc::new(MockImmutableResolver),
        Arc::new(MockMutableResolver {
            expected_block_number: block_number,
        }),
    )
}

fn loan_drawn_event_stellar(loan_id: u32, block_number: u64) -> LoanEvent<StellarAddress> {
    LoanEvent {
        contract_address: StellarAddress(STELLAR_CONTRACT.to_owned()),
        event_name: "LoanDrawn".to_owned(),
        block_number,
        tx_hash: "abc123".to_owned(),
        log_index: 0,
        block_timestamp: block_number * 5,
        params: serde_json::json!({ "loan_id": loan_id.to_string() }),
    }
}

fn lifecycle_event_stellar(
    event_name: &str,
    loan_id: u32,
    block_number: u64,
    log_index: u64,
) -> LoanEvent<StellarAddress> {
    LoanEvent {
        contract_address: StellarAddress(STELLAR_CONTRACT.to_owned()),
        event_name: event_name.to_owned(),
        block_number,
        tx_hash: "def456".to_owned(),
        log_index,
        block_timestamp: block_number * 5,
        params: serde_json::json!({ "loan_id": loan_id.to_string() }),
    }
}

fn make_loan_event_mapper_stellar(
    event: LoanEvent<StellarAddress>,
    pool: sqlx::PgPool,
) -> LoanEventMapper<StellarAddress, u32> {
    let event_repo = Arc::new(shared::db::EventRepo::new(pool.clone()));
    let contract_logs_repo = Arc::new(shared::contract_logs_repo::ContractLogsRepo::new(pool));
    LoanEventMapper::<StellarAddress, u32>::new(
        event,
        99_000_001,
        event_repo,
        contract_logs_repo,
        Arc::new(MockMetadataFetcher),
        Arc::new(MockStellarImmutableResolver),
        Arc::new(MockStellarMutableResolver),
    )
}

/// Build a minimal `LoanSnapshot` for use as `prior` in lifecycle composer tests.
fn make_prior_snapshot() -> LoanSnapshot {
    LoanSnapshot {
        originator: "PriorOriginator".to_owned(),
        borrower_id: "BRW-PRIOR".to_owned(),
        commodity: "Coffee".to_owned(),
        corridor: "BR-US".to_owned(),
        governing_law: "NY".to_owned(),
        metadata_uri: Some("ipfs://Qm_prior_secondary".to_owned()),
        original_facility_size: BigDecimal::from_str("5000000").unwrap(),
        original_senior_tranche: BigDecimal::from_str("4000000").unwrap(),
        original_equity_tranche: BigDecimal::from_str("1000000").unwrap(),
        original_offtaker_price: BigDecimal::from_str("5000000").unwrap(),
        senior_interest_rate_bps: 950_u32,
        origination_date: 1_700_000_000_i64,
        original_maturity_date: 1_800_000_000_i64,
        next_economics_epochs_id: BigDecimal::from(2),
        next_repayment_id: BigDecimal::from(1),
        status: "Performing".to_owned(),
        ccr_bps: 7500_u32,
        last_reported_ccr_timestamp: 1_700_001_000_i64,
        current_maturity_timestamp: 1_800_001_000_i64,
        closure_reason: "None".to_owned(),
        current_location: LocationUpdateSnapshot {
            location_type: "Warehouse".to_owned(),
            location_identifier: "WH-001".to_owned(),
            tracking_url: "https://track.example.com/WH-001".to_owned(),
            updated_at: 1_700_000_500_i64,
        },
        metadata_uri_onchain: "ipfs://Qm_test".to_owned(),
        repayment: RepaymentSnapshot {
            offtaker_received: BigDecimal::from(0),
            senior_principal_repaid: BigDecimal::from(0),
            senior_interest: BigDecimal::from(0),
            equity_distributed: BigDecimal::from(0),
            mgmt_fee: BigDecimal::from(0),
            perf_fee: BigDecimal::from(0),
            oet_alloc: BigDecimal::from(0),
        },
    }
}

// ---------------------------------------------------------------------------
// 1. LoanDrawnMapper happy path: block_number + block_timestamp (EVM)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn loan_drawn_mapper_block_number_and_timestamp() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/nonexistent")
        .expect("connect_lazy should not fail");

    let mut mapper = make_loan_event_mapper_evm(loan_drawn_event_evm(1, 500), 500, pool);

    assert_eq!(mapper.block_number(), 500);
    mapper.set_block_timestamp(6000);
    assert_eq!(mapper.event.block_timestamp, 6000);
}

// ---------------------------------------------------------------------------
// 2. Lifecycle mapper: block_number and block_timestamp accessors (EVM)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn lifecycle_mapper_block_number_and_timestamp() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/nonexistent")
        .expect("connect_lazy should not fail");

    let mut mapper =
        make_loan_event_mapper_evm(lifecycle_event_evm("PaymentRecorded", 1, 600, 1), 600, pool);

    assert_eq!(mapper.block_number(), 600);
    mapper.set_block_timestamp(7200);
    assert_eq!(mapper.event.block_timestamp, 7200);
}

// ---------------------------------------------------------------------------
// 3. Two consecutive PaymentRecorded events: block_number assertions (EVM)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn payment_recorded_mapper_block_number_pins_correctly_for_two_events() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/nonexistent")
        .expect("connect_lazy should not fail");

    {
        let mapper = make_loan_event_mapper_evm(
            lifecycle_event_evm("PaymentRecorded", 1, 700, 0),
            700,
            pool.clone(),
        );
        assert_eq!(mapper.block_number(), 700);
    }

    {
        let mapper = make_loan_event_mapper_evm(
            lifecycle_event_evm("PaymentRecorded", 1, 800, 1),
            800,
            pool,
        );
        assert_eq!(mapper.block_number(), 800);
    }
}

// ---------------------------------------------------------------------------
// 4. Other lifecycle mapper block_number checks (EVM)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn defaulted_mapper_block_number() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/nonexistent")
        .expect("connect_lazy should not fail");
    let mapper =
        make_loan_event_mapper_evm(lifecycle_event_evm("LoanDefaulted", 1, 570, 4), 570, pool);
    assert_eq!(mapper.block_number(), 570);
}

#[tokio::test]
async fn closed_mapper_block_number() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/nonexistent")
        .expect("connect_lazy should not fail");
    let mapper =
        make_loan_event_mapper_evm(lifecycle_event_evm("LoanClosed", 1, 580, 5), 580, pool);
    assert_eq!(mapper.block_number(), 580);
}

// ---------------------------------------------------------------------------
// 5. block_number() is independent of resolver state (EVM)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn loan_drawn_mapper_block_number_independent_of_resolvers() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/nonexistent")
        .expect("connect_lazy should not fail");

    let mapper = make_loan_event_mapper_evm(loan_drawn_event_evm(99, 999), 999, pool);
    assert_eq!(mapper.block_number(), 999);
}

// ---------------------------------------------------------------------------
// 6. Params shape: loan_drawn_event has loan_id only in params (EVM)
// ---------------------------------------------------------------------------

#[test]
fn loan_drawn_event_params_has_loan_id_only() {
    let ev = loan_drawn_event_evm(42, 500);
    assert!(ev.params.get("loan_id").is_some());
    assert_eq!(ev.params.as_object().map(serde_json::Map::len), Some(1));
}

#[test]
fn lifecycle_event_params_has_loan_id_only() {
    let ev = lifecycle_event_evm("PaymentRecorded", 7, 600, 1);
    assert!(ev.params.get("loan_id").is_some());
    assert_eq!(ev.params.as_object().map(serde_json::Map::len), Some(1));
}

// ---------------------------------------------------------------------------
// 7. Pure composer: compose_drawn_snapshot_full_row
// ---------------------------------------------------------------------------

#[test]
fn compose_drawn_snapshot_full_row() {
    let json = LoanMetadataJson {
        originator: "Originator-A".to_owned(),
        borrower_id: "BRW-999".to_owned(),
        commodity: "Wheat".to_owned(),
        corridor: "UA-EG".to_owned(),
        governing_law: "EN".to_owned(),
        metadata_uri: Some("ipfs://Qm_secondary_doc".to_owned()),
    };

    let immutable = ImmutableLoanDataView {
        original_facility_size: U256::from(10_000_000_u64),
        original_senior_tranche: U256::from(8_000_000_u64),
        original_equity_tranche: U256::from(2_000_000_u64),
        original_offtaker_price: U256::from(9_500_000_u64),
        senior_interest_rate_bps: 850_u32,
        origination_date: 1_680_000_000_u64,
        original_maturity_date: 1_780_000_000_u64,
    };

    let mutable = MutableLoanDataView {
        next_economics_epochs_id: U256::from(3_u64),
        next_repayment_id: U256::from(5_u64),
        status: 1, // WatchList
        ccr_bps: 6_500_u32,
        last_reported_ccr_timestamp: 1_690_000_000_u64,
        current_maturity_timestamp: 1_780_500_000_u64,
        closure_reason: 0, // None
        current_location: LocationUpdateView {
            location_type: LocationType::TankFarm,
            location_identifier: "TF-007".to_owned(),
            tracking_url: "https://track.example.com/TF-007".to_owned(),
            updated_at: 1_690_100_000_u64,
        },
        metadata_uri: "ipfs://Qm_onchain_uri".to_owned(),
    };

    let cumulative = RepaymentDataView {
        offtaker_received: U256::from(250_000_u64),
        senior_principal_repaid: U256::from(200_000_u64),
        senior_interest: U256::from(17_000_u64),
        equity_distributed: U256::from(33_000_u64),
        mgmt_fee: U256::from(5_000_u64),
        perf_fee: U256::from(2_500_u64),
        oet_alloc: U256::from(1_000_u64),
    };

    let metadata_uri_onchain = "ipfs://Qm_onchain_uri".to_owned();

    let snap = compose_drawn_snapshot(
        json,
        &immutable,
        mutable,
        &cumulative,
        metadata_uri_onchain.clone(),
    );

    assert_eq!(snap.originator, "Originator-A");
    assert_eq!(snap.borrower_id, "BRW-999");
    assert_eq!(snap.commodity, "Wheat");
    assert_eq!(snap.corridor, "UA-EG");
    assert_eq!(snap.governing_law, "EN");
    assert_eq!(
        snap.metadata_uri,
        Some("ipfs://Qm_secondary_doc".to_owned())
    );

    assert_eq!(
        snap.original_facility_size,
        BigDecimal::from(10_000_000_u64)
    );
    assert_eq!(
        snap.original_senior_tranche,
        BigDecimal::from(8_000_000_u64)
    );
    assert_eq!(
        snap.original_equity_tranche,
        BigDecimal::from(2_000_000_u64)
    );
    assert_eq!(
        snap.original_offtaker_price,
        BigDecimal::from(9_500_000_u64)
    );
    assert_eq!(snap.senior_interest_rate_bps, 850_u32);
    assert_eq!(snap.origination_date, 1_680_000_000_i64);
    assert_eq!(snap.original_maturity_date, 1_780_000_000_i64);

    assert_eq!(snap.next_economics_epochs_id, BigDecimal::from(3));
    assert_eq!(snap.next_repayment_id, BigDecimal::from(5));
    assert_eq!(snap.status, "WatchList");
    assert_eq!(snap.ccr_bps, 6_500_u32);
    assert_eq!(snap.last_reported_ccr_timestamp, 1_690_000_000_i64);
    assert_eq!(snap.current_maturity_timestamp, 1_780_500_000_i64);
    assert_eq!(snap.closure_reason, "None");
    assert_eq!(snap.current_location.location_type, "TankFarm");
    assert_eq!(snap.current_location.location_identifier, "TF-007");
    assert_eq!(snap.metadata_uri_onchain, metadata_uri_onchain);
    assert_eq!(
        snap.repayment.offtaker_received,
        BigDecimal::from(250_000_u64)
    );
    assert_eq!(
        snap.repayment.senior_principal_repaid,
        BigDecimal::from(200_000_u64)
    );
    assert_eq!(snap.repayment.senior_interest, BigDecimal::from(17_000_u64));
    assert_eq!(
        snap.repayment.equity_distributed,
        BigDecimal::from(33_000_u64)
    );
    assert_eq!(snap.repayment.mgmt_fee, BigDecimal::from(5_000_u64));
    assert_eq!(snap.repayment.perf_fee, BigDecimal::from(2_500_u64));
    assert_eq!(snap.repayment.oet_alloc, BigDecimal::from(1_000_u64));
}

// ---------------------------------------------------------------------------
// 8. Pure composer: compose_lifecycle_snapshot — carry-forward when URI unchanged
// ---------------------------------------------------------------------------

#[test]
fn compose_lifecycle_snapshot_carry_forward_when_uri_unchanged() {
    let prior = make_prior_snapshot();

    let mutable = MutableLoanDataView {
        next_economics_epochs_id: U256::from(5_u64),
        next_repayment_id: U256::from(3_u64),
        status: 0, // Performing
        ccr_bps: 8500_u32,
        last_reported_ccr_timestamp: 1_750_000_000_u64,
        current_maturity_timestamp: 1_800_000_500_u64,
        closure_reason: 0, // None
        current_location: LocationUpdateView {
            location_type: LocationType::Vessel,
            location_identifier: "VES-042".to_owned(),
            tracking_url: "https://track.example.com/VES-042".to_owned(),
            updated_at: 1_750_000_100_u64,
        },
        metadata_uri: "ipfs://Qm_test".to_owned(), // same as prior.metadata_uri_onchain
    };

    let cumulative = RepaymentDataView {
        offtaker_received: U256::from(500_000_u64),
        senior_principal_repaid: U256::from(400_000_u64),
        senior_interest: U256::from(34_000_u64),
        equity_distributed: U256::from(66_000_u64),
        mgmt_fee: U256::from(10_000_u64),
        perf_fee: U256::from(5_000_u64),
        oet_alloc: U256::from(2_000_u64),
    };

    let snap = compose_lifecycle_snapshot(prior.clone(), mutable, &cumulative, None);

    assert_eq!(snap.originator, prior.originator);
    assert_eq!(snap.borrower_id, prior.borrower_id);
    assert_eq!(snap.commodity, prior.commodity);
    assert_eq!(snap.corridor, prior.corridor);
    assert_eq!(snap.governing_law, prior.governing_law);
    assert_eq!(snap.metadata_uri, prior.metadata_uri);
    assert_eq!(snap.original_facility_size, prior.original_facility_size);
    assert_eq!(snap.original_senior_tranche, prior.original_senior_tranche);
    assert_eq!(snap.ccr_bps, 8500_u32);
    assert_eq!(snap.last_reported_ccr_timestamp, 1_750_000_000_i64);
    assert_eq!(snap.current_maturity_timestamp, 1_800_000_500_i64);
    assert_eq!(snap.status, "Performing");
    assert_eq!(snap.closure_reason, "None");
    assert_eq!(snap.current_location.location_type, "Vessel");
    assert_eq!(snap.current_location.location_identifier, "VES-042");
    assert_eq!(snap.metadata_uri_onchain, "ipfs://Qm_test");
    assert_eq!(
        snap.repayment.offtaker_received,
        BigDecimal::from(500_000_u64)
    );
    assert_eq!(
        snap.repayment.senior_principal_repaid,
        BigDecimal::from(400_000_u64)
    );
}

// ---------------------------------------------------------------------------
// 9. Pure composer: compose_lifecycle_snapshot — re-fetch when URI changed
// ---------------------------------------------------------------------------

#[test]
fn compose_lifecycle_snapshot_refetches_ipfs_when_uri_changed() {
    let prior = make_prior_snapshot();

    let new_uri = "ipfs://Qm_new_uri".to_owned();
    let mutable = MutableLoanDataView {
        next_economics_epochs_id: U256::from(6_u64),
        next_repayment_id: U256::from(4_u64),
        status: 0,
        ccr_bps: 8000_u32,
        last_reported_ccr_timestamp: 1_760_000_000_u64,
        current_maturity_timestamp: 1_800_002_000_u64,
        closure_reason: 0,
        current_location: LocationUpdateView {
            location_type: LocationType::Warehouse,
            location_identifier: "WH-099".to_owned(),
            tracking_url: "https://track.example.com/WH-099".to_owned(),
            updated_at: 1_760_000_100_u64,
        },
        metadata_uri: new_uri.clone(),
    };

    let cumulative = mock_repayment_data_view(1_000_000_u64);

    let refreshed_json = LoanMetadataJson {
        originator: "NewOriginator".to_owned(),
        borrower_id: "BRW-NEW".to_owned(),
        commodity: "Cocoa".to_owned(),
        corridor: "GH-US".to_owned(),
        governing_law: "DE".to_owned(),
        metadata_uri: Some("ipfs://Qm_new_secondary".to_owned()),
    };

    let snap =
        compose_lifecycle_snapshot(prior.clone(), mutable, &cumulative, Some(refreshed_json));

    assert_eq!(snap.originator, "NewOriginator");
    assert_eq!(snap.borrower_id, "BRW-NEW");
    assert_eq!(snap.commodity, "Cocoa");
    assert_eq!(snap.corridor, "GH-US");
    assert_eq!(snap.governing_law, "DE");
    assert_eq!(
        snap.metadata_uri,
        Some("ipfs://Qm_new_secondary".to_owned())
    );
    assert_eq!(snap.original_facility_size, prior.original_facility_size);
    assert_eq!(
        snap.senior_interest_rate_bps,
        prior.senior_interest_rate_bps
    );
    assert_eq!(snap.origination_date, prior.origination_date);
    assert_eq!(snap.original_maturity_date, prior.original_maturity_date);
    assert_eq!(snap.metadata_uri_onchain, new_uri);
    assert_eq!(snap.current_location.location_type, "Warehouse");
    assert_eq!(snap.current_location.location_identifier, "WH-099");
}

fn mock_repayment_data_view(amount: u64) -> RepaymentDataView {
    RepaymentDataView {
        offtaker_received: U256::from(amount),
        senior_principal_repaid: U256::from(amount / 2),
        senior_interest: U256::from(amount / 10),
        equity_distributed: U256::from(amount / 20),
        mgmt_fee: U256::from(amount / 100),
        perf_fee: U256::from(amount / 200),
        oet_alloc: U256::from(amount / 500),
    }
}

// ---------------------------------------------------------------------------
// 10. Status string mapping
// ---------------------------------------------------------------------------

#[test]
fn compose_lifecycle_snapshot_status_strings_mapping() {
    let prior = make_prior_snapshot();
    let cumulative = mock_repayment();

    let status_cases: &[(u8, &str)] = &[
        (0, "Performing"),
        (1, "WatchList"),
        (2, "Default"),
        (3, "Closed"),
        (255, "Unknown"),
    ];

    for &(ordinal, expected) in status_cases {
        let mutable = MutableLoanDataView {
            next_economics_epochs_id: U256::from(1_u64),
            next_repayment_id: U256::from(0_u64),
            status: ordinal,
            ccr_bps: 8000_u32,
            last_reported_ccr_timestamp: 0_u64,
            current_maturity_timestamp: 0_u64,
            closure_reason: 0,
            current_location: mock_location(),
            metadata_uri: prior.metadata_uri_onchain.clone(),
        };
        let snap = compose_lifecycle_snapshot(prior.clone(), mutable, &cumulative, None);
        assert_eq!(
            snap.status, expected,
            "status ordinal {ordinal} should map to {expected}"
        );
    }
}

#[test]
fn loan_status_name_all_variants() {
    assert_eq!(loan_status_name(0), "Performing");
    assert_eq!(loan_status_name(1), "WatchList");
    assert_eq!(loan_status_name(2), "Default");
    assert_eq!(loan_status_name(3), "Closed");
    assert_eq!(loan_status_name(4), "Unknown");
    assert_eq!(loan_status_name(100), "Unknown");
    assert_eq!(loan_status_name(255), "Unknown");
}

// ---------------------------------------------------------------------------
// 11. Closure reason mapping
// ---------------------------------------------------------------------------

#[test]
fn compose_lifecycle_snapshot_closure_reason_mapping() {
    let prior = make_prior_snapshot();
    let cumulative = mock_repayment();

    let cases: &[(u8, &str)] = &[
        (0, "None"),
        (1, "ScheduledMaturity"),
        (2, "EarlyRepayment"),
        (3, "Default"),
        (4, "OtherWriteDown"),
        (5, "Unknown"),
    ];

    for &(ordinal, expected) in cases {
        let mutable = MutableLoanDataView {
            next_economics_epochs_id: U256::from(1_u64),
            next_repayment_id: U256::from(0_u64),
            status: 0,
            ccr_bps: 0_u32,
            last_reported_ccr_timestamp: 0_u64,
            current_maturity_timestamp: 0_u64,
            closure_reason: ordinal,
            current_location: mock_location(),
            metadata_uri: prior.metadata_uri_onchain.clone(),
        };
        let snap = compose_lifecycle_snapshot(prior.clone(), mutable, &cumulative, None);
        assert_eq!(
            snap.closure_reason, expected,
            "closure_reason ordinal {ordinal} should map to {expected}"
        );
    }
}

#[test]
fn closure_reason_name_all_variants() {
    assert_eq!(closure_reason_name(0), "None");
    assert_eq!(closure_reason_name(1), "ScheduledMaturity");
    assert_eq!(closure_reason_name(2), "EarlyRepayment");
    assert_eq!(closure_reason_name(3), "Default");
    assert_eq!(closure_reason_name(4), "OtherWriteDown");
    assert_eq!(closure_reason_name(5), "Unknown");
    assert_eq!(closure_reason_name(100), "Unknown");
    assert_eq!(closure_reason_name(255), "Unknown");
}

// ---------------------------------------------------------------------------
// 12. LocationType::from_ordinal clamps out-of-range values
// ---------------------------------------------------------------------------

#[test]
fn location_type_from_ordinal_clamps_out_of_range() {
    assert_eq!(LocationType::from_ordinal(0), LocationType::Vessel);
    assert_eq!(LocationType::from_ordinal(1), LocationType::Warehouse);
    assert_eq!(LocationType::from_ordinal(2), LocationType::TankFarm);
    assert_eq!(LocationType::from_ordinal(3), LocationType::Other);
    assert_eq!(LocationType::from_ordinal(4), LocationType::Other);
    assert_eq!(LocationType::from_ordinal(10), LocationType::Other);
    assert_eq!(LocationType::from_ordinal(255), LocationType::Other);
    assert_eq!(LocationType::Vessel.as_str(), "Vessel");
    assert_eq!(LocationType::Warehouse.as_str(), "Warehouse");
    assert_eq!(LocationType::TankFarm.as_str(), "TankFarm");
    assert_eq!(LocationType::Other.as_str(), "Other");
}

// ---------------------------------------------------------------------------
// 13. LoanSnapshot serde round-trip
// ---------------------------------------------------------------------------

#[test]
fn loan_snapshot_serde_round_trip() {
    let snap = LoanSnapshot {
        originator: "Serde Originator".to_owned(),
        borrower_id: "BRW-SERDE-001".to_owned(),
        commodity: "Soybeans".to_owned(),
        corridor: "BR-CN".to_owned(),
        governing_law: "BR".to_owned(),
        metadata_uri: Some("ipfs://Qm_serde_secondary".to_owned()),
        original_facility_size: BigDecimal::from_str("12345678901234567890").unwrap(),
        original_senior_tranche: BigDecimal::from_str("9876543210987654321").unwrap(),
        original_equity_tranche: BigDecimal::from_str("2469135690246913569").unwrap(),
        original_offtaker_price: BigDecimal::from_str("11111111111111111111").unwrap(),
        senior_interest_rate_bps: 1125_u32,
        origination_date: 1_700_000_001_i64,
        original_maturity_date: 1_800_000_001_i64,
        next_economics_epochs_id: BigDecimal::from_str("7").unwrap(),
        next_repayment_id: BigDecimal::from_str("3").unwrap(),
        status: "WatchList".to_owned(),
        ccr_bps: 7200_u32,
        last_reported_ccr_timestamp: 1_710_000_000_i64,
        current_maturity_timestamp: 1_800_500_000_i64,
        closure_reason: "None".to_owned(),
        current_location: LocationUpdateSnapshot {
            location_type: "TankFarm".to_owned(),
            location_identifier: "TF-SERDE".to_owned(),
            tracking_url: "https://track.example.com/TF-SERDE".to_owned(),
            updated_at: 1_710_100_000_i64,
        },
        metadata_uri_onchain: "ipfs://Qm_onchain_serde".to_owned(),
        repayment: RepaymentSnapshot {
            offtaker_received: BigDecimal::from_str("999999999999999999").unwrap(),
            senior_principal_repaid: BigDecimal::from_str("888888888888888888").unwrap(),
            senior_interest: BigDecimal::from_str("111111111111111111").unwrap(),
            equity_distributed: BigDecimal::from_str("77777777777777777").unwrap(),
            mgmt_fee: BigDecimal::from_str("5555555555555555").unwrap(),
            perf_fee: BigDecimal::from_str("333333333333333").unwrap(),
            oet_alloc: BigDecimal::from_str("11111111111111").unwrap(),
        },
    };

    let value = serde_json::to_value(&snap).expect("LoanSnapshot should serialize");
    assert!(
        value.get("originator").is_some(),
        "originator field missing"
    );
    assert!(
        value.get("borrower_id").is_some(),
        "borrower_id field missing"
    );
    assert!(
        value.get("metadata_uri_onchain").is_some(),
        "metadata_uri_onchain field missing"
    );
    assert!(value.get("repayment").is_some(), "repayment field missing");
    let repayment = &value["repayment"];
    assert!(
        repayment.get("offtaker_received").is_some(),
        "offtaker_received missing"
    );
    assert!(
        repayment.get("senior_principal_repaid").is_some(),
        "senior_principal_repaid missing"
    );

    let restored: LoanSnapshot =
        serde_json::from_value(value).expect("LoanSnapshot should deserialize");
    assert_eq!(restored, snap);
}

// ---------------------------------------------------------------------------
// 14. u256_to_bigdecimal round-trip
// ---------------------------------------------------------------------------

#[test]
fn u256_to_bigdecimal_converts_correctly() {
    assert_eq!(u256_to_bigdecimal(U256::ZERO), BigDecimal::from(0));
    assert_eq!(u256_to_bigdecimal(U256::from(1_u64)), BigDecimal::from(1));
    assert_eq!(
        u256_to_bigdecimal(U256::from(1_000_000_000_u64)),
        BigDecimal::from(1_000_000_000_u64)
    );

    let large = U256::MAX;
    let bd = u256_to_bigdecimal(large);
    let expected =
        BigDecimal::from_str(&large.to_string()).expect("U256::MAX has a valid decimal string");
    assert_eq!(bd, expected);
}

// ---------------------------------------------------------------------------
// 15. maybe_fetch_refreshed_json helper tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn maybe_fetch_refreshed_json_returns_none_when_uri_unchanged() {
    let result = maybe_fetch_refreshed_json(
        &PanickingFetcher,
        "ipfs://Qm_same_uri",
        "ipfs://Qm_same_uri",
    )
    .await
    .expect("equal-URI path should never fail");

    assert!(
        result.is_none(),
        "expected None when URIs are identical, got Some"
    );
}

#[tokio::test]
async fn maybe_fetch_refreshed_json_returns_some_when_uri_changed() {
    let result = maybe_fetch_refreshed_json(
        &MockMetadataFetcher,
        "ipfs://Qm_old_uri",
        "ipfs://Qm_new_uri",
    )
    .await
    .expect("changed-URI path should not fail with MockMetadataFetcher");

    let json = result.expect("expected Some(json) when URIs differ");
    assert_eq!(json.originator, "TestOriginator");
    assert_eq!(json.borrower_id, "BRW-001");
    assert_eq!(json.commodity, "Cotton");
}

#[tokio::test]
async fn maybe_fetch_refreshed_json_propagates_fetcher_error() {
    let err = maybe_fetch_refreshed_json(&FailingFetcher, "ipfs://Qm_old_uri", "ipfs://Qm_new_uri")
        .await
        .expect_err("should fail when fetcher errors");

    let msg = format!("{err:#}");
    assert!(
        msg.contains("IPFS re-fetch failed"),
        "error message should contain 'IPFS re-fetch failed', got: {msg}"
    );
    assert!(
        msg.contains("ipfs://Qm_new_uri"),
        "error message should contain the URI, got: {msg}"
    );
}

// ---------------------------------------------------------------------------
// Stellar mapper tests (Step 5b)
// ---------------------------------------------------------------------------

/// Stellar LoanDrawn: block_number() and set_block_timestamp() work with StellarAddress.
#[tokio::test]
async fn stellar_loan_drawn_mapper_block_number_and_timestamp() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/nonexistent")
        .expect("connect_lazy should not fail");

    let mut mapper = make_loan_event_mapper_stellar(loan_drawn_event_stellar(42, 1_234_567), pool);
    assert_eq!(mapper.block_number(), 1_234_567);
    mapper.set_block_timestamp(9_999_999);
    assert_eq!(mapper.event.block_timestamp, 9_999_999);
}

/// Stellar lifecycle event: block_number and block_timestamp accessors.
#[tokio::test]
async fn stellar_lifecycle_event_mapper_block_number_and_timestamp() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/nonexistent")
        .expect("connect_lazy should not fail");

    let mut mapper = make_loan_event_mapper_stellar(
        lifecycle_event_stellar("LoanStatusUpdated", 7, 2_000_000, 3),
        pool,
    );
    assert_eq!(mapper.block_number(), 2_000_000);
    mapper.set_block_timestamp(10_000_000);
    assert_eq!(mapper.event.block_timestamp, 10_000_000);
}

/// Stellar loan_id is serialised as a decimal string (u32 = 42 → "42").
#[test]
fn stellar_loan_id_serialised_as_decimal_string() {
    let ev = loan_drawn_event_stellar(42, 1_000_000);
    let loan_id_str = ev
        .params
        .get("loan_id")
        .and_then(|v| v.as_str())
        .expect("loan_id must be a string in params");
    assert_eq!(
        loan_id_str, "42",
        "Stellar u32 loan_id must be serialised as \"42\""
    );
}

/// Stellar contract_address.as_db_string() returns the raw Strkey form.
#[test]
fn stellar_address_as_db_string_returns_strkey() {
    let addr = StellarAddress(STELLAR_CONTRACT.to_owned());
    assert_eq!(addr.as_db_string(), STELLAR_CONTRACT);
}
