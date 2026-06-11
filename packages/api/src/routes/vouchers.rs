//! Voucher signing endpoints — supports both EVM EIP-712 secp256k1 and
//! Stellar Soroban ed25519 depending on the `chain_id` query parameter.
//!
//! EVM: signs a `VerifiedRequests` struct via EIP-712.
//! Stellar: reproduces the on-chain `request-queue::crypto::digest` and signs
//!          it with ed25519 using the configured `STELLAR_VERIFIER_SECRET`.

use std::sync::Arc;

use alloy::primitives::{Address, U256};
use alloy::signers::local::PrivateKeySigner;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use shared::chains::{parse_chain_type, ChainKind};
use shared::eip712::Eip712Domain;

use crate::config::StellarVoucherChainConfig;
use crate::routes::common::resolve_chain;
use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/deposits/{request_id}/voucher", get(deposit_voucher))
        .route("/withdrawals/{request_id}/voucher", get(withdrawal_voucher))
}

#[derive(OpenApi)]
#[openapi(
    paths(deposit_voucher, withdrawal_voucher),
    components(schemas(WalletQuery, VoucherResponse)),
    tags(
        (name = "Vouchers", description = "Deposit/withdrawal voucher signing — EVM EIP-712 secp256k1 or Stellar Soroban ed25519 depending on chain_id")
    )
)]
pub struct VouchersDoc;

#[derive(Deserialize, ToSchema)]
pub struct WalletQuery {
    pub wallet: String,
    /// Chain ID (optional — defaults to DEFAULT_CHAIN_ID).
    pub chain_id: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct VoucherResponse {
    pub request_id: String,
    pub amount: String,
    pub user: String,
    pub signature: String,
}

/// Error returned when voucher signing resolution fails.
#[derive(Debug)]
pub enum VoucherError {
    /// The chain has no signer configured.
    ChainNotConfigured(i64),
}

/// Resolve EVM voucher signing config for the given chain_id.
///
/// This is a pure function (no DB access) testable without a database connection.
pub fn resolve_evm_voucher_signing(
    state: &AppState,
    chain_id: i64,
    use_dm: bool,
) -> Result<(&PrivateKeySigner, &Eip712Domain), VoucherError> {
    let signer = state
        .voucher_signers
        .get(&chain_id)
        .ok_or(VoucherError::ChainNotConfigured(chain_id))?;
    let domain = if use_dm {
        state
            .dm_domains
            .get(&chain_id)
            .ok_or(VoucherError::ChainNotConfigured(chain_id))?
    } else {
        state
            .wq_domains
            .get(&chain_id)
            .ok_or(VoucherError::ChainNotConfigured(chain_id))?
    };
    Ok((signer, domain))
}

/// Resolve Stellar voucher signing config for the given chain_id.
pub fn resolve_stellar_voucher_signing(
    state: &AppState,
    chain_id: i64,
) -> Result<&StellarVoucherChainConfig, VoucherError> {
    state
        .stellar_voucher_signers
        .get(&chain_id)
        .ok_or(VoucherError::ChainNotConfigured(chain_id))
}

/// Dispatch-aware wallet normalisation.
///
/// - EVM: lowercase the address (existing behaviour — EVM addresses are stored
///   lowercased in the DB and compared case-insensitively via `LOWER()`).
/// - Stellar: return the wallet verbatim after validating it is a 56-char `G…`
///   ed25519 Strkey. Returns `Err` with an HTTP-400 message on invalid input.
pub fn normalise_wallet(
    chain_kind: ChainKind,
    wallet: &str,
) -> Result<String, (StatusCode, String)> {
    match chain_kind {
        ChainKind::Evm => Ok(wallet.to_lowercase()),
        ChainKind::Stellar => {
            stellar_strkey::ed25519::PublicKey::from_string(wallet)
                .map(|_| wallet.to_owned())
                .map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("invalid Stellar wallet address: {e}"),
                    )
                })
        }
    }
}

// ─── Shared response helpers ──────────────────────────────────────────────────

fn chain_not_configured_response(chain_id: i64) -> axum::response::Response {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
            "error": format!("voucher signing not configured for chain {chain_id}")
        })),
    )
        .into_response()
}

fn internal_error_response(msg: &str) -> axum::response::Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": msg })),
    )
        .into_response()
}

// ─── Route handlers ───────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/deposits/{request_id}/voucher",
    params(
        ("request_id" = String, Path, description = "Deposit request ID"),
        ("wallet" = String, Query, description = "Wallet address (0x… for EVM, G… for Stellar)"),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Voucher with signature", body = VoucherResponse),
        (status = 400, description = "Voucher signing not configured for the requested chain or invalid wallet"),
        (status = 404, description = "Deposit request not found"),
        (status = 403, description = "KYT screening not passed or profile not allowed"),
        (status = 409, description = "Already claimed"),
    ),
    tag = "Vouchers"
)]
async fn deposit_voucher(
    State(state): State<Arc<AppState>>,
    Path(request_id): Path<String>,
    Query(query): Query<WalletQuery>,
) -> impl IntoResponse {
    let chain_id = resolve_chain(&state, query.chain_id);

    let chain_kind = match parse_chain_type(chain_id) {
        Ok(k) => k,
        Err(e) => {
            tracing::error!(error = %e, chain_id, "failed to determine chain type");
            return internal_error_response("invalid chain type configuration");
        }
    };

    let wallet = match normalise_wallet(chain_kind, &query.wallet) {
        Ok(w) => w,
        Err((status, msg)) => {
            return (status, Json(serde_json::json!({ "error": msg }))).into_response();
        }
    };

    match chain_kind {
        ChainKind::Evm => {
            deposit_voucher_evm(&state, chain_id, &request_id, &wallet).await
        }
        ChainKind::Stellar => {
            deposit_voucher_stellar(&state, chain_id, &request_id, &wallet).await
        }
    }
}

#[utoipa::path(
    get,
    path = "/v1/withdrawals/{request_id}/voucher",
    params(
        ("request_id" = String, Path, description = "Withdrawal request ID"),
        ("wallet" = String, Query, description = "Wallet address (0x… for EVM, G… for Stellar)"),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Voucher with signature", body = VoucherResponse),
        (status = 400, description = "Voucher signing not configured for the requested chain or invalid wallet"),
        (status = 404, description = "Withdrawal request not found"),
        (status = 403, description = "KYT screening not passed"),
        (status = 409, description = "Already claimed"),
    ),
    tag = "Vouchers"
)]
async fn withdrawal_voucher(
    State(state): State<Arc<AppState>>,
    Path(request_id): Path<String>,
    Query(query): Query<WalletQuery>,
) -> impl IntoResponse {
    let chain_id = resolve_chain(&state, query.chain_id);

    let chain_kind = match parse_chain_type(chain_id) {
        Ok(k) => k,
        Err(e) => {
            tracing::error!(error = %e, chain_id, "failed to determine chain type");
            return internal_error_response("invalid chain type configuration");
        }
    };

    let wallet = match normalise_wallet(chain_kind, &query.wallet) {
        Ok(w) => w,
        Err((status, msg)) => {
            return (status, Json(serde_json::json!({ "error": msg }))).into_response();
        }
    };

    match chain_kind {
        ChainKind::Evm => {
            withdrawal_voucher_evm(&state, chain_id, &request_id, &wallet).await
        }
        ChainKind::Stellar => {
            withdrawal_voucher_stellar(&state, chain_id, &request_id, &wallet).await
        }
    }
}

// ─── EVM paths ────────────────────────────────────────────────────────────────

async fn deposit_voucher_evm(
    state: &AppState,
    chain_id: i64,
    request_id: &str,
    wallet: &str,
) -> axum::response::Response {
    let (signer, domain) = match resolve_evm_voucher_signing(state, chain_id, true) {
        Ok(pair) => pair,
        Err(VoucherError::ChainNotConfigured(cid)) => {
            return chain_not_configured_response(cid);
        }
    };

    let req = match state
        .kyc_repo
        .get_deposit_request(chain_id, request_id, wallet)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "deposit request not found"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to lookup deposit request");
            return internal_error_response("internal error");
        }
    };

    if state.crystal_enabled && req.crystal_kyt_status != Some(1) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "KYT screening not passed"})),
        )
            .into_response();
    }

    match state.kyc_repo.is_on_chain_allowed(chain_id, wallet).await {
        Ok(true) => {}
        Ok(false) => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "profile not yet allowed on-chain"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to check on_chain_allowed");
            return internal_error_response("internal error");
        }
    }

    let dm_address = domain.verifying_contract.to_checksum(None);
    match state
        .kyc_repo
        .is_request_claimed(chain_id, "RequestClaimed", request_id, &dm_address)
        .await
    {
        Ok(true) => {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "deposit already claimed"})),
            )
                .into_response();
        }
        Ok(false) => {}
        Err(e) => {
            tracing::error!(error = %e, "failed to check claimed status");
            return internal_error_response("internal error");
        }
    }

    let amount_str = req
        .amount
        .as_ref()
        .map(std::string::ToString::to_string)
        .unwrap_or_default();
    let rid_str = req
        .request_id
        .as_ref()
        .map(std::string::ToString::to_string)
        .unwrap_or_default();

    let Ok(rid) = rid_str.parse::<U256>() else {
        return internal_error_response("invalid request_id format");
    };
    let Ok(amount) = amount_str.parse::<U256>() else {
        return internal_error_response("invalid amount format");
    };
    let Ok(user): Result<Address, _> = wallet.parse() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid wallet address"})),
        )
            .into_response();
    };

    match shared::eip712::sign_verified_request(signer, domain, rid, amount, user).await {
        Ok(sig_bytes) => Json(VoucherResponse {
            request_id: rid_str,
            amount: amount_str,
            user: format!("{user:#x}"),
            signature: format!("0x{}", hex::encode(&sig_bytes)),
        })
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to sign deposit voucher");
            internal_error_response("signing failed")
        }
    }
}

async fn withdrawal_voucher_evm(
    state: &AppState,
    chain_id: i64,
    request_id: &str,
    wallet: &str,
) -> axum::response::Response {
    let (signer, domain) = match resolve_evm_voucher_signing(state, chain_id, false) {
        Ok(pair) => pair,
        Err(VoucherError::ChainNotConfigured(cid)) => {
            return chain_not_configured_response(cid);
        }
    };

    let req = match state
        .kyc_repo
        .get_withdrawal_request(chain_id, request_id, wallet)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "withdrawal request not found"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to lookup withdrawal request");
            return internal_error_response("internal error");
        }
    };

    if state.crystal_enabled && req.crystal_kyt_status != Some(1) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "KYT screening not passed"})),
        )
            .into_response();
    }

    let wq_address = domain.verifying_contract.to_checksum(None);
    match state
        .kyc_repo
        .is_request_claimed(chain_id, "RequestClaimed", request_id, &wq_address)
        .await
    {
        Ok(true) => {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "withdrawal already claimed"})),
            )
                .into_response();
        }
        Ok(false) => {}
        Err(e) => {
            tracing::error!(error = %e, "failed to check claimed status");
            return internal_error_response("internal error");
        }
    }

    let amount_str = req
        .amount
        .as_ref()
        .map(std::string::ToString::to_string)
        .unwrap_or_default();
    let rid_str = req
        .request_id
        .as_ref()
        .map(std::string::ToString::to_string)
        .unwrap_or_default();

    let Ok(rid) = rid_str.parse::<U256>() else {
        return internal_error_response("invalid request_id format");
    };
    let Ok(amount) = amount_str.parse::<U256>() else {
        return internal_error_response("invalid amount format");
    };
    let Ok(user): Result<Address, _> = wallet.parse() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid wallet address"})),
        )
            .into_response();
    };

    match shared::eip712::sign_verified_request(signer, domain, rid, amount, user).await {
        Ok(sig_bytes) => Json(VoucherResponse {
            request_id: rid_str,
            amount: amount_str,
            user: format!("{user:#x}"),
            signature: format!("0x{}", hex::encode(&sig_bytes)),
        })
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to sign withdrawal voucher");
            internal_error_response("signing failed")
        }
    }
}

// ─── Stellar paths ────────────────────────────────────────────────────────────

async fn deposit_voucher_stellar(
    state: &AppState,
    chain_id: i64,
    request_id: &str,
    wallet: &str,
) -> axum::response::Response {
    let cfg = match resolve_stellar_voucher_signing(state, chain_id) {
        Ok(c) => c,
        Err(VoucherError::ChainNotConfigured(cid)) => {
            return chain_not_configured_response(cid);
        }
    };

    let req = match state
        .kyc_repo
        .get_deposit_request_case_sensitive(chain_id, request_id, wallet)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "deposit request not found"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to lookup Stellar deposit request");
            return internal_error_response("internal error");
        }
    };

    // Crystal KYT: skip for Stellar — Crystal does not return kyt_status for
    // Stellar addresses. Fall through as "screened-as-clean" per the plan.
    // (The `crystal_kyt_status` column stays NULL for Stellar rows from the indexer.)

    // is_on_chain_allowed: same SQL as EVM (Decision #4 in the exec plan).
    // Stellar voucher requests return 403 until lp_profiles rows exist.
    match state.kyc_repo.is_on_chain_allowed(chain_id, wallet).await {
        Ok(true) => {}
        Ok(false) => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "profile not yet allowed on-chain"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to check on_chain_allowed");
            return internal_error_response("internal error");
        }
    }

    // Derive the DM contract Strkey from the domain for the claimed-check.
    let dm_contract_str = stellar_contract_strkey(&cfg.domain_dm);
    match state
        .kyc_repo
        .is_request_claimed(chain_id, "RequestClaimed", request_id, &dm_contract_str)
        .await
    {
        Ok(true) => {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "deposit already claimed"})),
            )
                .into_response();
        }
        Ok(false) => {}
        Err(e) => {
            tracing::error!(error = %e, "failed to check Stellar claimed status");
            return internal_error_response("internal error");
        }
    }

    sign_and_respond_stellar(cfg, true, request_id, &req, wallet)
}

async fn withdrawal_voucher_stellar(
    state: &AppState,
    chain_id: i64,
    request_id: &str,
    wallet: &str,
) -> axum::response::Response {
    let cfg = match resolve_stellar_voucher_signing(state, chain_id) {
        Ok(c) => c,
        Err(VoucherError::ChainNotConfigured(cid)) => {
            return chain_not_configured_response(cid);
        }
    };

    let req = match state
        .kyc_repo
        .get_withdrawal_request_case_sensitive(chain_id, request_id, wallet)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "withdrawal request not found"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to lookup Stellar withdrawal request");
            return internal_error_response("internal error");
        }
    };

    // Crystal KYT: skip for Stellar (see deposit_voucher_stellar comment).

    // is_on_chain_allowed: same SQL as EVM (Decision #4).
    match state.kyc_repo.is_on_chain_allowed(chain_id, wallet).await {
        Ok(true) => {}
        Ok(false) => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "profile not yet allowed on-chain"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to check on_chain_allowed");
            return internal_error_response("internal error");
        }
    }

    let wq_contract_str = stellar_contract_strkey(&cfg.domain_wq);
    match state
        .kyc_repo
        .is_request_claimed(chain_id, "RequestClaimed", request_id, &wq_contract_str)
        .await
    {
        Ok(true) => {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "withdrawal already claimed"})),
            )
                .into_response();
        }
        Ok(false) => {}
        Err(e) => {
            tracing::error!(error = %e, "failed to check Stellar claimed status");
            return internal_error_response("internal error");
        }
    }

    sign_and_respond_stellar(cfg, false, request_id, &req, wallet)
}

/// Build and return the VoucherResponse for a Stellar signing request.
fn sign_and_respond_stellar(
    cfg: &StellarVoucherChainConfig,
    use_dm: bool,
    _request_id_path: &str,
    req: &shared::kyc_repo::RequestInfo,
    wallet: &str,
) -> axum::response::Response {
    let amount_str = req
        .amount
        .as_ref()
        .map(std::string::ToString::to_string)
        .unwrap_or_default();
    let rid_str = req
        .request_id
        .as_ref()
        .map(std::string::ToString::to_string)
        .unwrap_or_default();

    // Parse request_id as u128 (Soroban u128).
    let rid: u128 = match rid_str.parse() {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(rid = %rid_str, error = %e, "Stellar request_id overflows u128");
            return internal_error_response("invalid request_id format");
        }
    };

    // Parse amount as i128 (Soroban i128).
    let amount: i128 = match amount_str.parse() {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(amount = %amount_str, error = %e, "Stellar amount overflows i128");
            return internal_error_response("invalid amount format");
        }
    };

    // Parse sender Strkey.
    let sender_pk = match stellar_strkey::ed25519::PublicKey::from_string(wallet) {
        Ok(pk) => pk,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("invalid Stellar wallet address: {e}")
                })),
            )
                .into_response();
        }
    };

    let domain = if use_dm { &cfg.domain_dm } else { &cfg.domain_wq };
    let sig_bytes = shared::stellar_voucher::sign_voucher(&cfg.signer, domain, rid, &sender_pk, amount);

    Json(VoucherResponse {
        request_id: rid_str,
        amount: amount_str,
        user: wallet.to_owned(),
        // Keep `0x` prefix for response-shape consistency with EVM path.
        // The chain context (caller knows chain_id) disambiguates how to decode.
        signature: format!("0x{}", hex::encode(sig_bytes)),
    })
    .into_response()
}

/// Derive the `C…` Strkey from a `StellarVoucherDomain` for the `is_request_claimed` lookup.
fn stellar_contract_strkey(domain: &shared::stellar_voucher::StellarVoucherDomain) -> String {
    domain.contract_strkey()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    // ── Wallet normalisation ──────────────────────────────────────────────────

    #[test]
    fn evm_wallet_lowercased() {
        let result = normalise_wallet(ChainKind::Evm, "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12");
        assert_eq!(
            result.unwrap(),
            "0xabcdef1234567890abcdef1234567890abcdef12"
        );
    }

    #[test]
    fn stellar_wallet_passthrough_valid() {
        let valid = "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM";
        let result = normalise_wallet(ChainKind::Stellar, valid);
        assert_eq!(result.unwrap(), valid);
    }

    #[test]
    fn stellar_wallet_lowercase_rejected() {
        // lowercase g… is not a valid G… Strkey
        let result = normalise_wallet(ChainKind::Stellar, "gc5suaxmrok67lie3ddmjg3ahhevsfdaz55a4ws655xyskin46rg7acm");
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn stellar_wallet_wrong_length_rejected() {
        let result = normalise_wallet(ChainKind::Stellar, "GABC");
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    // ── request_id / amount parse helpers ────────────────────────────────────

    #[test]
    fn u128_parse_from_indexer_string() {
        let s = "1234567890";
        let v: u128 = s.parse().unwrap();
        assert_eq!(v, 1_234_567_890_u128);
    }

    #[test]
    fn u128_overflow_is_detected() {
        // 2^128 overflows u128
        let big = "340282366920938463463374607431768211456"; // 2^128
        let result: Result<u128, _> = big.parse();
        assert!(result.is_err(), "2^128 must not parse as u128");
    }

    #[test]
    fn i128_parse_negative() {
        let s = "-1000000";
        let v: i128 = s.parse().unwrap();
        assert_eq!(v, -1_000_000_i128);
    }

    #[test]
    fn i128_parse_positive() {
        let s = "1000000";
        let v: i128 = s.parse().unwrap();
        assert_eq!(v, 1_000_000_i128);
    }
}
