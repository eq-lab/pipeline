use bigdecimal::BigDecimal;
use sqlx::{PgConnection, PgPool};

/// Materialised row in the `loan_details` table. Mirrors the immutable fields of the
/// off-chain `ImmutableLoanData` JSON fetched from each `LoanMinted` event's metadata URI.
///
/// Lifecycle (status / closed_at / closure_reason) and `holder` are not stored here —
/// downstream APIs derive them from `contract_logs` (LoanMinted carries the holder;
/// LoanStatusUpdated / LoanClosed / LoanDefaulted carry the lifecycle).
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct LoanDetailsRow {
    pub chain_id: i64,
    pub loan_id: BigDecimal,
    pub originator: String,
    pub borrower_id: String,
    pub commodity: String,
    pub corridor: String,
    pub original_facility_size: BigDecimal,
    pub original_senior_tranche: BigDecimal,
    pub original_equity_tranche: BigDecimal,
    pub original_offtaker_price: BigDecimal,
    pub senior_interest_rate_bps: i32,
    pub origination_date: i64,
    pub original_maturity_date: i64,
    pub governing_law: String,
    pub metadata_uri: Option<String>,
}

pub struct LoanDetailsRepo {
    pub pool: PgPool,
}

impl LoanDetailsRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Insert or update the immutable details of a loan. Idempotent for re-indexing —
    /// every field is overwritten on conflict so a partially-corrupt prior row (e.g. from
    /// an interrupted upsert) is healed by the next successful fetch.
    pub async fn upsert_loan_details(
        &self,
        conn: &mut PgConnection,
        row: &LoanDetailsRow,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO loan_details (
                chain_id, loan_id, originator, borrower_id,
                commodity, corridor,
                original_facility_size, original_senior_tranche, original_equity_tranche,
                original_offtaker_price, senior_interest_rate_bps,
                origination_date, original_maturity_date,
                governing_law, metadata_uri
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT (chain_id, loan_id) DO UPDATE SET
                originator               = EXCLUDED.originator,
                borrower_id              = EXCLUDED.borrower_id,
                commodity                = EXCLUDED.commodity,
                corridor                 = EXCLUDED.corridor,
                original_facility_size   = EXCLUDED.original_facility_size,
                original_senior_tranche  = EXCLUDED.original_senior_tranche,
                original_equity_tranche  = EXCLUDED.original_equity_tranche,
                original_offtaker_price  = EXCLUDED.original_offtaker_price,
                senior_interest_rate_bps = EXCLUDED.senior_interest_rate_bps,
                origination_date         = EXCLUDED.origination_date,
                original_maturity_date   = EXCLUDED.original_maturity_date,
                governing_law            = EXCLUDED.governing_law,
                metadata_uri             = EXCLUDED.metadata_uri",
        )
        .bind(row.chain_id)
        .bind(&row.loan_id)
        .bind(&row.originator)
        .bind(&row.borrower_id)
        .bind(&row.commodity)
        .bind(&row.corridor)
        .bind(&row.original_facility_size)
        .bind(&row.original_senior_tranche)
        .bind(&row.original_equity_tranche)
        .bind(&row.original_offtaker_price)
        .bind(row.senior_interest_rate_bps)
        .bind(row.origination_date)
        .bind(row.original_maturity_date)
        .bind(&row.governing_law)
        .bind(row.metadata_uri.as_ref())
        .execute(conn)
        .await?;
        Ok(())
    }

    pub async fn get_loan_details(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> anyhow::Result<Option<LoanDetailsRow>> {
        let row = sqlx::query_as::<_, LoanDetailsRow>(
            "SELECT chain_id, loan_id, originator, borrower_id,
                    commodity, corridor,
                    original_facility_size, original_senior_tranche, original_equity_tranche,
                    original_offtaker_price, senior_interest_rate_bps,
                    origination_date, original_maturity_date,
                    governing_law, metadata_uri
             FROM loan_details
             WHERE chain_id = $1 AND loan_id = $2",
        )
        .bind(chain_id)
        .bind(loan_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }
}
