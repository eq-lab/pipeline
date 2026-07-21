//! Off-chain loan-metadata document type shared across crates.
//!
//! `LoanMetadataJson` is the canonical shape of the JSON document pointed at by a
//! loan's on-chain `metadataURI`. The worker's indexer parses it during indexing;
//! the API validates a submission's `metadata_uri` against the *same* type so a
//! document that would fail indexing is rejected at submission time. Keeping the
//! type here (rather than in the worker) is what guarantees the two stay in lockstep.

use async_trait::async_trait;

use crate::loan_snapshot::LoanDocument;
use crate::metadata_fetcher::MetadataFetcher;

/// Off-chain JSON document pointed at by `tokenURI(loanId)`.
/// Contains only the fields that live off-chain; all other loan data
/// comes from the on-chain `immutableLoanData` / `mutableLoanData` views.
///
/// Note: `metadataURI` is a mutable field on-chain (stored in `MutableLoanData.metadataURI`).
/// The IPFS document shape is unchanged — this DTO deserialises the same fields.
/// The on-chain URI itself is tracked in `LoanSnapshot.metadata_uri_onchain`.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoanMetadataJson {
    pub originator: String,
    #[serde(rename = "borrowerId")]
    pub borrower_id: String,
    pub commodity: String,
    pub corridor: String,
    #[serde(rename = "governingLaw")]
    pub governing_law: String,
    /// Trade-finance protection instrument (e.g. "LC at sight", "Doc. coll.").
    /// `#[serde(default)]` keeps back-compat with legacy IPFS documents that omit
    /// the key (the struct is `deny_unknown_fields`) — empty string when absent.
    #[serde(default)]
    pub protection: String,
    // Optional secondary URI inside the JSON document. Empty/missing is a
    // normal value — stored as NULL in the snapshot's `metadata_uri` field, never a fetch failure.
    #[serde(default, rename = "metadataURI")]
    pub metadata_uri: Option<String>,
    /// Documents referenced in the metadata document (Agreement, License, T&Cs, …).
    /// `#[serde(default)]` keeps back-compat with legacy IPFS documents that omit the
    /// key (the struct is `deny_unknown_fields`) — empty vec when absent.
    #[serde(default)]
    pub documents: Vec<LoanDocument>,
}

// ── Metadata fetcher ──────────────────────────────────────────────────────────

/// Abstraction over the metadata fetch so tests can substitute a mock without spinning
/// up an HTTP server. The production implementation delegates to the shared
/// `MetadataFetcher::fetch_json::<LoanMetadataJson>`.
#[async_trait]
pub trait LoanMetadataFetcher: Send + Sync {
    async fn fetch_metadata(&self, uri: &str) -> anyhow::Result<LoanMetadataJson>;
}

pub struct HttpLoanMetadataFetcher {
    inner: MetadataFetcher,
}

impl HttpLoanMetadataFetcher {
    pub fn new(inner: MetadataFetcher) -> Self {
        Self { inner }
    }
}

#[async_trait]
impl LoanMetadataFetcher for HttpLoanMetadataFetcher {
    async fn fetch_metadata(&self, uri: &str) -> anyhow::Result<LoanMetadataJson> {
        self.inner.fetch_json::<LoanMetadataJson>(uri).await
    }
}
