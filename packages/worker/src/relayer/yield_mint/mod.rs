pub mod calldata;
pub mod on_chain;

use alloy::primitives::Address;
use alloy::transports::http::Http;
use anyhow::Result;
use reqwest::Client;

use shared::bitgo::client::BitgoTxClient;
use shared::bitgo::models::TxRequestState;
use shared::json_numeric::bigdecimal_to_u256;
use shared::yield_mint_outbox_repo::{OutboxKey, OutboxStore, YieldMintOutboxRepo};

use self::calldata::encode_mint_yield;
use self::on_chain::{CanYieldBeMintedView, TransactionReceiptView};

/// Type alias matching `LoanRegistryReader`'s pattern.
pub type HttpProvider = alloy::providers::RootProvider<Http<Client>>;

/// Settings consumed exclusively by Phase 4.
pub struct Phase4Settings {
    pub chain_id: i64,
    pub yield_minter_address: String,
    pub loan_registry_address: Address,
    pub bitgo_native_symbol: String,
    /// Maximum rows processed per cycle (default 50).
    pub yield_minter_batch_size: usize,
}

/// Run one yield-mint phase cycle: discover → submit → confirm.
///
/// Errors inside individual row processing are logged and skipped rather than
/// propagated (per spec § "Phase isolation"). A DB error that prevents reading
/// the outbox aborts the phase for this cycle and returns `Err`.
pub async fn phase_yield_mint(
    settings: &Phase4Settings,
    bitgo: &dyn BitgoTxClient,
    outbox: &YieldMintOutboxRepo,
    view: &dyn CanYieldBeMintedView,
    receipt_view: &dyn TransactionReceiptView,
) -> Result<()> {
    // Step A — Discover new PaymentRecorded events.
    discover(settings, outbox).await?;

    // Step B — Submit pending rows to BitGo.
    submit_pending(settings, bitgo, outbox, view).await?;

    // Step C — Confirm submitted rows.
    confirm_submitted(settings, bitgo, outbox, receipt_view).await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Step A
// ---------------------------------------------------------------------------

async fn discover(settings: &Phase4Settings, outbox: &YieldMintOutboxRepo) -> Result<()> {
    let loan_registry_checksum = settings.loan_registry_address.to_checksum(None);
    let inserted = outbox
        .discover_pending(
            settings.chain_id,
            &settings.yield_minter_address,
            &loan_registry_checksum,
        )
        .await?;

    if inserted > 0 {
        tracing::info!(count = inserted, "yield_mint: discovered new pending rows");
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Step B
// ---------------------------------------------------------------------------

pub async fn submit_pending(
    settings: &Phase4Settings,
    bitgo: &dyn BitgoTxClient,
    outbox: &dyn OutboxStore,
    view: &dyn CanYieldBeMintedView,
) -> Result<()> {
    let limit = settings.yield_minter_batch_size as i64;
    let pending = outbox
        .list_pending(settings.chain_id, &settings.yield_minter_address, limit)
        .await?;

    for row in pending {
        let loan_id_u256 = bigdecimal_to_u256(&row.loan_id);
        let repayment_id_u256 = bigdecimal_to_u256(&row.repayment_id);
        let loan_id_display = row.loan_id.to_string();
        let repayment_id_display = row.repayment_id.to_string();

        let key = OutboxKey {
            chain_id: row.chain_id,
            yield_minter_address: row.yield_minter_address.clone(),
            loan_id: row.loan_id.clone(),
            repayment_id: row.repayment_id.clone(),
        };

        // 1. Guard: check if yield can still be minted.
        let can_mint = match view
            .can_yield_be_minted(
                settings.loan_registry_address,
                loan_id_u256,
                repayment_id_u256,
            )
            .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(
                    loan_id = loan_id_display,
                    repayment_id = repayment_id_display,
                    error = %e,
                    "yield_mint: transient RPC failure checking canYieldBeMinted, retrying next cycle"
                );
                continue;
            }
        };

        if !can_mint {
            tracing::info!(
                loan_id = loan_id_display,
                repayment_id = repayment_id_display,
                "yield_mint: canYieldBeMinted=false, marking skipped_already_minted"
            );
            if let Err(e) = outbox.mark_skipped_already_minted(&key).await {
                tracing::error!(
                    loan_id = loan_id_display,
                    repayment_id = repayment_id_display,
                    error = %e,
                    "yield_mint: DB error marking skipped_already_minted"
                );
            }
            continue;
        }

        // 2. Encode calldata.
        // alloy's sol! ABI encoding is infallible for well-typed inputs.
        let calldata = encode_mint_yield(loan_id_u256, repayment_id_u256);

        // 3. Submit to BitGo.
        let tx_result = bitgo
            .send_transaction(
                &settings.yield_minter_address,
                "0",
                &settings.bitgo_native_symbol,
                Some(&calldata),
            )
            .await;

        match tx_result {
            Ok(response) => {
                // Fix #5: if BitGo returns 200 without txRequestId, mark failed
                // rather than storing "unknown" as a placeholder.
                let Some(tx_request_id) = response.tx_request_id else {
                    tracing::error!(
                        loan_id = loan_id_display,
                        repayment_id = repayment_id_display,
                        "yield_mint: BitGo returned 200 without txRequestId"
                    );
                    if let Err(e) = outbox
                        .mark_failed(&key, "bitgo returned 200 without txRequestId")
                        .await
                    {
                        tracing::error!(
                            loan_id = loan_id_display,
                            repayment_id = repayment_id_display,
                            error = %e,
                            "yield_mint: DB error marking failed (missing txRequestId)"
                        );
                    }
                    continue;
                };
                tracing::info!(
                    loan_id = loan_id_display,
                    repayment_id = repayment_id_display,
                    tx_request_id = tx_request_id,
                    "yield_mint: pending -> submitted"
                );
                if let Err(e) = outbox.mark_submitted(&key, &tx_request_id).await {
                    tracing::error!(
                        loan_id = loan_id_display,
                        repayment_id = repayment_id_display,
                        error = %e,
                        "yield_mint: DB error marking submitted"
                    );
                }
            }
            Err(e) => {
                // Fix #3c: pattern-match on typed BitgoError variant.
                if e.is_definitive() {
                    let error_msg = format!("bitgo submit 4xx: {e}");
                    // Fix #10: log message reworded — transition to `failed` is
                    // documented terminal state, not an unexpected system error.
                    tracing::error!(
                        loan_id = loan_id_display,
                        repayment_id = repayment_id_display,
                        error = %e,
                        "yield_mint: row terminated with status=failed (operator review required)"
                    );
                    if let Err(db_err) = outbox.mark_failed(&key, &error_msg).await {
                        tracing::error!(
                            loan_id = loan_id_display,
                            repayment_id = repayment_id_display,
                            error = %db_err,
                            "yield_mint: DB error marking failed after 4xx"
                        );
                    }
                } else {
                    tracing::warn!(
                        loan_id = loan_id_display,
                        repayment_id = repayment_id_display,
                        error = %e,
                        "yield_mint: transient failure, retrying next cycle"
                    );
                }
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Step C
// ---------------------------------------------------------------------------

pub async fn confirm_submitted(
    settings: &Phase4Settings,
    bitgo: &dyn BitgoTxClient,
    outbox: &dyn OutboxStore,
    receipt_view: &dyn TransactionReceiptView,
) -> Result<()> {
    let limit = settings.yield_minter_batch_size as i64;
    let submitted = outbox
        .list_submitted(settings.chain_id, &settings.yield_minter_address, limit)
        .await?;

    for row in submitted {
        let loan_id_display = row.loan_id.to_string();
        let repayment_id_display = row.repayment_id.to_string();

        let key = OutboxKey {
            chain_id: row.chain_id,
            yield_minter_address: row.yield_minter_address.clone(),
            loan_id: row.loan_id.clone(),
            repayment_id: row.repayment_id.clone(),
        };

        let tx_request_id = if let Some(id) = &row.bitgo_tx_request_id {
            id.clone()
        } else {
            tracing::error!(
                loan_id = loan_id_display,
                repayment_id = repayment_id_display,
                "yield_mint: submitted row has no bitgo_tx_request_id"
            );
            continue;
        };

        let get_result = bitgo.get_tx_request(&tx_request_id).await;

        match get_result {
            Ok(response) => {
                match response.state {
                    TxRequestState::Delivered => {
                        // Fix #5: if BitGo state=Delivered but no tx_hash,
                        // mark failed rather than storing "unknown".
                        let Some(tx_hash) = response.tx_hash else {
                            tracing::error!(
                                loan_id = loan_id_display,
                                repayment_id = repayment_id_display,
                                "yield_mint: BitGo state=Delivered without txHash"
                            );
                            if let Err(e) = outbox
                                .mark_failed(&key, "bitgo state=Delivered without txHash")
                                .await
                            {
                                tracing::error!(
                                    loan_id = loan_id_display,
                                    repayment_id = repayment_id_display,
                                    error = %e,
                                    "yield_mint: DB error marking failed (missing txHash)"
                                );
                            }
                            continue;
                        };

                        // BitGo `delivered` only means "broadcast" — verify on
                        // chain before flipping to confirmed. A missing receipt
                        // is treated as in-flight (BitGo can race the RPC's
                        // indexer or the tx can be reorged out); only an
                        // explicit revert is terminal.
                        match receipt_view.get_receipt_status(&tx_hash).await {
                            Ok(Some(true)) => {
                                tracing::info!(
                                    loan_id = loan_id_display,
                                    repayment_id = repayment_id_display,
                                    tx_hash = tx_hash,
                                    "yield_mint: submitted -> confirmed"
                                );
                                if let Err(e) = outbox.mark_confirmed(&key, &tx_hash).await {
                                    tracing::error!(
                                        loan_id = loan_id_display,
                                        repayment_id = repayment_id_display,
                                        error = %e,
                                        "yield_mint: DB error marking confirmed"
                                    );
                                }
                            }
                            Ok(Some(false)) => {
                                let error_msg =
                                    format!("yield_mint tx reverted on-chain: {tx_hash}");
                                tracing::error!(
                                    loan_id = loan_id_display,
                                    repayment_id = repayment_id_display,
                                    tx_hash = tx_hash,
                                    "yield_mint: tx reverted on-chain — row terminated with status=failed"
                                );
                                if let Err(e) = outbox.mark_failed(&key, &error_msg).await {
                                    tracing::error!(
                                        loan_id = loan_id_display,
                                        repayment_id = repayment_id_display,
                                        error = %e,
                                        "yield_mint: DB error marking failed after on-chain revert"
                                    );
                                }
                            }
                            Ok(None) => {
                                tracing::info!(
                                    loan_id = loan_id_display,
                                    repayment_id = repayment_id_display,
                                    tx_hash = tx_hash,
                                    "yield_mint: BitGo delivered but receipt not yet visible, retrying next cycle"
                                );
                            }
                            Err(e) => {
                                // Split on `is_definitive()` inside a single
                                // arm (rather than two guarded arms) so a
                                // future editor can't reorder them into a
                                // catch-all that silently shadows the
                                // definitive case.
                                if e.is_definitive() {
                                    let error_msg = format!("yield_mint receipt fetch failed: {e}");
                                    tracing::error!(
                                        loan_id = loan_id_display,
                                        repayment_id = repayment_id_display,
                                        tx_hash = tx_hash,
                                        error = %e,
                                        "yield_mint: definitive receipt failure — row terminated with status=failed"
                                    );
                                    if let Err(db_err) = outbox.mark_failed(&key, &error_msg).await
                                    {
                                        tracing::error!(
                                            loan_id = loan_id_display,
                                            repayment_id = repayment_id_display,
                                            error = %db_err,
                                            "yield_mint: DB error marking failed after definitive receipt error"
                                        );
                                    }
                                } else {
                                    tracing::warn!(
                                        loan_id = loan_id_display,
                                        repayment_id = repayment_id_display,
                                        tx_hash = tx_hash,
                                        error = %e,
                                        "yield_mint: transient RPC failure fetching receipt, retrying next cycle"
                                    );
                                }
                            }
                        }
                    }
                    TxRequestState::Rejected
                    | TxRequestState::Canceled
                    | TxRequestState::Failed => {
                        let state_str = format!("{:?}", response.state);
                        let error_msg = format!("bitgo state: {state_str}");
                        // Fix #10: reworded log message for terminal state transition.
                        tracing::error!(
                            loan_id = loan_id_display,
                            repayment_id = repayment_id_display,
                            state = state_str,
                            "yield_mint: row terminated with status=failed (operator review required)"
                        );
                        if let Err(e) = outbox.mark_failed(&key, &error_msg).await {
                            tracing::error!(
                                loan_id = loan_id_display,
                                repayment_id = repayment_id_display,
                                error = %e,
                                "yield_mint: DB error marking failed after terminal state"
                            );
                        }
                    }
                    // In-flight states: leave row alone, retry next cycle.
                    TxRequestState::Initialized
                    | TxRequestState::PendingApproval
                    | TxRequestState::PendingDelivery
                    | TxRequestState::PendingUserSignature
                    | TxRequestState::PendingUserCommitment
                    | TxRequestState::PendingUserRShare
                    | TxRequestState::PendingUserGShare
                    | TxRequestState::ReadyToSend
                    | TxRequestState::Signed
                    | TxRequestState::Unknown => {
                        tracing::info!(
                            loan_id = loan_id_display,
                            repayment_id = repayment_id_display,
                            state = ?response.state,
                            "yield_mint: tx still in-flight, retrying next cycle"
                        );
                    }
                }
            }
            Err(e) => {
                // Mirror the submit path: definitive errors (4xx, Parse,
                // UnexpectedStatus) mark the row failed; only true transients
                // (network / 5xx) leave it submitted for the next cycle. Without
                // this, a 404 on an unknown tx_request_id or a BitGo API shape
                // change would retry forever.
                if e.is_definitive() {
                    let error_msg = format!("bitgo get_tx_request error: {e}");
                    tracing::error!(
                        loan_id = loan_id_display,
                        repayment_id = repayment_id_display,
                        error = %e,
                        "yield_mint: row terminated with status=failed (operator review required)"
                    );
                    if let Err(db_err) = outbox.mark_failed(&key, &error_msg).await {
                        tracing::error!(
                            loan_id = loan_id_display,
                            repayment_id = repayment_id_display,
                            error = %db_err,
                            "yield_mint: DB error marking failed after definitive get_tx_request error"
                        );
                    }
                } else {
                    tracing::warn!(
                        loan_id = loan_id_display,
                        repayment_id = repayment_id_display,
                        error = %e,
                        "yield_mint: transient failure polling tx request, retrying next cycle"
                    );
                }
            }
        }
    }

    Ok(())
}
