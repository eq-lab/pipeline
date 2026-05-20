use std::sync::Arc;

use alloy::primitives::{Address, U256};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

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
        (name = "Vouchers", description = "Deposit/withdrawal voucher signing")
    )
)]
pub struct VouchersDoc;

#[derive(Deserialize, ToSchema)]
pub struct WalletQuery {
    pub wallet: String,
}

#[derive(Serialize, ToSchema)]
pub struct VoucherResponse {
    pub request_id: String,
    pub amount: String,
    pub user: String,
    pub signature: String,
}

#[utoipa::path(
    get,
    path = "/v1/deposits/{request_id}/voucher",
    params(
        ("request_id" = String, Path, description = "Deposit request ID"),
        ("wallet" = String, Query, description = "Wallet address"),
    ),
    responses(
        (status = 200, description = "Voucher with signature", body = VoucherResponse),
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
    let (Some(signer), Some(domain)) = (&state.voucher_signer, &state.dm_domain) else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "voucher signing not configured"})),
        )
            .into_response();
    };

    let wallet = query.wallet.to_lowercase();

    let req = match state
        .kyc_repo
        .get_deposit_request(&request_id, &wallet)
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
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response();
        }
    };

    // Check KYT status is clear (skip if Crystal is disabled)
    if state.crystal_enabled && req.crystal_kyt_status != Some(1) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "KYT screening not passed"})),
        )
            .into_response();
    }

    // Check profile is on-chain allowed
    match state.kyc_repo.is_on_chain_allowed(&wallet).await {
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
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response();
        }
    }

    // Check not already claimed
    let dm_address = domain.verifying_contract.to_checksum(None);
    match state
        .kyc_repo
        .is_request_claimed("RequestClaimed", &request_id, &dm_address)
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
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response();
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
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "invalid request_id format"})),
        )
            .into_response();
    };
    let Ok(amount) = amount_str.parse::<U256>() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "invalid amount format"})),
        )
            .into_response();
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
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "signing failed"})),
            )
                .into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/v1/withdrawals/{request_id}/voucher",
    params(
        ("request_id" = String, Path, description = "Withdrawal request ID"),
        ("wallet" = String, Query, description = "Wallet address"),
    ),
    responses(
        (status = 200, description = "Voucher with signature", body = VoucherResponse),
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
    let (Some(signer), Some(domain)) = (&state.voucher_signer, &state.wq_domain) else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "voucher signing not configured"})),
        )
            .into_response();
    };

    let wallet = query.wallet.to_lowercase();

    let req = match state
        .kyc_repo
        .get_withdrawal_request(&request_id, &wallet)
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
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response();
        }
    };

    // Check KYT status is clear (skip if Crystal is disabled)
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
        .is_request_claimed("RequestClaimed", &request_id, &wq_address)
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
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response();
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
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "invalid request_id format"})),
        )
            .into_response();
    };
    let Ok(amount) = amount_str.parse::<U256>() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "invalid amount format"})),
        )
            .into_response();
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
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "signing failed"})),
            )
                .into_response()
        }
    }
}
