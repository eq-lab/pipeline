use std::str::FromStr;
use std::sync::Arc;

use alloy::primitives::U256;
use anyhow::Context;
use async_trait::async_trait;
use bigdecimal::BigDecimal;
use sqlx::PgConnection;

use shared::{
    db::EventRepo,
    events::ContractLog,
    json_numeric::{parse_i32, parse_i64, parse_numeric},
    loan_details_repo::{LoanDetailsRepo, LoanDetailsRow},
    log_mapper::LogMapper,
};

use super::loan_metadata::{ImmutableLoanData, LoanMetadataFetcher, MetadataUriResolver};

/// Mapper for `LoanMinted` events: writes the `contract_logs` row and the materialised
/// `loan_details` row atomically. The metadata URI is recovered via `tokenURI(loanId)`
/// and the off-chain JSON is fetched + parsed.
///
/// Failure policy: any failure (URI recovery, fetch, numeric parse, DB) propagates out
/// of `insert(...)`, which causes the indexer's outer transaction to roll back. The
/// batch is re-pulled on the next polling cycle and retried — `loan_details` is never
/// skipped. While the URI source is unavailable the indexer does not advance past the
/// affected block range; see TD-8 for the long-term move to an async backfill worker.
///
/// Non-LoanMinted LoanRegistry events use the plain `ContractLogMapper`; they do not
/// touch `loan_details`. The API derives lifecycle state from `contract_logs`.
pub struct LoanMintedMapper {
    pub event: ContractLog,
    chain_id: i64,
    event_repo: Arc<EventRepo>,
    details_repo: Arc<LoanDetailsRepo>,
    fetcher: Arc<dyn LoanMetadataFetcher>,
    resolver: Arc<dyn MetadataUriResolver>,
}

impl LoanMintedMapper {
    pub fn new(
        event: ContractLog,
        chain_id: i64,
        event_repo: Arc<EventRepo>,
        details_repo: Arc<LoanDetailsRepo>,
        fetcher: Arc<dyn LoanMetadataFetcher>,
        resolver: Arc<dyn MetadataUriResolver>,
    ) -> Self {
        Self {
            event,
            chain_id,
            event_repo,
            details_repo,
            fetcher,
            resolver,
        }
    }

    async fn populate_details(
        &self,
        conn: &mut PgConnection,
        loan_id: &BigDecimal,
    ) -> anyhow::Result<()> {
        // The `LoanMinted` event declares `string indexed metadataURI`, so the topic value
        // is the keccak256 hash of the URI rather than the URI itself. Recover the URI via
        // the standard ERC-721 `tokenURI(loan_id)` reader, then fetch + parse the JSON.
        // Any failure here propagates out of `insert` and rolls back the indexer's
        // transaction so the batch is retried next cycle — loan_details is never skipped.
        let loan_id_u256 = U256::from_str(&loan_id.to_string())
            .map_err(|e| anyhow::anyhow!("loan_id `{loan_id}` is not a valid U256: {e}"))?;

        let uri = self
            .resolver
            .metadata_uri(self.event.contract_address, loan_id_u256)
            .await
            .with_context(|| format!("LoanMinted: tokenURI(loan_id={loan_id}) recovery failed"))?;

        let data: ImmutableLoanData = self
            .fetcher
            .fetch_metadata(&uri)
            .await
            .with_context(|| format!("LoanMinted: metadata fetch failed (uri={uri})"))?;

        let row = build_loan_details_row(self.chain_id, loan_id.clone(), &data)
            .with_context(|| format!("LoanMinted: numeric field parse failed (uri={uri})"))?;

        self.details_repo.upsert_loan_details(conn, &row).await?;
        Ok(())
    }
}

#[async_trait]
impl LogMapper for LoanMintedMapper {
    async fn is_duplicate(&self, conn: &mut PgConnection) -> anyhow::Result<bool> {
        self.event_repo
            .is_duplicate(
                conn,
                self.chain_id,
                &self.event.contract_address.to_checksum(None),
                self.event.block_number,
                self.event.log_index,
            )
            .await
    }

    async fn insert(&self, conn: &mut PgConnection) -> anyhow::Result<()> {
        // Write the contract_logs row and the loan_details row in the same outer
        // transaction. If `populate_details` fails (URI recovery, fetch, parse, or DB),
        // the error propagates and the indexer rolls back BOTH rows — the batch is
        // retried on the next polling cycle. We never commit a partial state.
        self.event_repo
            .insert_log(conn, &self.event, self.chain_id)
            .await?;

        let loan_id = self
            .event
            .params
            .get("loan_id")
            .and_then(|v| v.as_str())
            .and_then(|s| BigDecimal::from_str(s).ok())
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "LoanMinted: missing or unparseable loan_id in params (event={})",
                    self.event.event_name
                )
            })?;

        self.populate_details(conn, &loan_id).await
    }

    fn block_number(&self) -> u64 {
        self.event.block_number
    }

    fn set_block_timestamp(&mut self, ts: u64) {
        self.event.block_timestamp = ts;
    }
}

fn build_loan_details_row(
    chain_id: i64,
    loan_id: BigDecimal,
    data: &ImmutableLoanData,
) -> anyhow::Result<LoanDetailsRow> {
    Ok(LoanDetailsRow {
        chain_id,
        loan_id,
        originator: data.originator.clone(),
        borrower_id: data.borrower_id.clone(),
        commodity: data.commodity.clone(),
        corridor: data.corridor.clone(),
        original_facility_size: parse_numeric(
            "originalFacilitySize",
            &data.original_facility_size,
        )?,
        original_senior_tranche: parse_numeric(
            "originalSeniorTranche",
            &data.original_senior_tranche,
        )?,
        original_equity_tranche: parse_numeric(
            "originalEquityTranche",
            &data.original_equity_tranche,
        )?,
        original_offtaker_price: parse_numeric(
            "originalOfftakerPrice",
            &data.original_offtaker_price,
        )?,
        senior_interest_rate_bps: parse_i32(
            "seniorInterestRateBps",
            &data.senior_interest_rate_bps,
        )?,
        origination_date: parse_i64("originationDate", &data.origination_date)?,
        original_maturity_date: parse_i64("originalMaturityDate", &data.original_maturity_date)?,
        governing_law: data.governing_law.clone(),
        metadata_uri: data.metadata_uri.clone(),
    })
}
