/// Thin async wrapper around the Soroban JSON-RPC `getEvents` and `getLatestLedger` endpoints.
///
/// Uses `reqwest` directly (hand-rolled JSON-RPC over HTTP) instead of the `stellar-rpc-client`
/// crate to keep the dependency tree small. The Soroban RPC protocol is plain JSON-RPC 2.0.
use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};

pub struct StellarRpc {
    client: reqwest::Client,
    url: String,
}

/// A decoded Soroban contract event returned by `getEvents`.
#[derive(Debug)]
pub struct RawEvent {
    /// Strkey (C…) of the emitting contract.
    pub contract_id: String,
    /// Decoded first topic symbol — snake_case event name per `#[contractevent]` convention.
    pub event_name: String,
    /// Raw base64-encoded XDR `ScVal` topics (all topics, including index 0).
    pub topics_base64: Vec<String>,
    /// Raw base64-encoded XDR `ScVal` value.
    pub value_base64: String,
    /// Ledger sequence number.
    pub ledger: u32,
    /// Ledger close time as Unix seconds.
    pub ledger_closed_at_unix: u64,
    /// Transaction hash (hex, no 0x prefix).
    pub tx_hash: String,
    /// Transaction index within the ledger.
    pub tx_index: u32,
    /// Operation index within the transaction (Soroban = always 0 for contract calls).
    pub op_index: u32,
    /// Event index within the operation.
    pub event_index_in_op: u32,
}

/// Filter specification for `getEvents`.
pub struct EventFilter {
    /// Contract Strkey IDs (C…) to include in the filter.
    pub contract_ids: Vec<String>,
}

impl StellarRpc {
    pub fn new(url: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            url: url.to_owned(),
        }
    }

    /// Fetch the latest closed ledger sequence.
    pub async fn get_latest_ledger(&self) -> Result<u64> {
        let resp: Value = self.call("getLatestLedger", json!({})).await?;
        let seq = resp
            .get("sequence")
            .and_then(Value::as_u64)
            .context("getLatestLedger response missing 'sequence'")?;
        Ok(seq)
    }

    /// Fetch contract events in `[start_ledger, end_ledger]` (inclusive).
    ///
    /// Loops on the response cursor until the server returns fewer rows than the
    /// per-page limit (or no cursor) — paginates beyond the 10k server-side cap
    /// so high-volume ranges don't silently drop events.
    ///
    /// Returns `(events, latest_ledger_from_response)`.
    pub async fn get_events(
        &self,
        start_ledger: u64,
        end_ledger: u64,
        filter: &EventFilter,
    ) -> Result<(Vec<RawEvent>, u64)> {
        const PAGE_LIMIT: u64 = 10_000;

        let contract_ids_json: Vec<Value> = filter
            .contract_ids
            .iter()
            .map(|id| Value::String(id.clone()))
            .collect();

        let mut out = Vec::new();
        let mut latest_ledger = end_ledger;
        let mut cursor: Option<String> = None;

        loop {
            // First page uses `startLedger`; subsequent pages use `cursor` instead
            // (Soroban RPC requires exactly one of the two).
            let pagination = match &cursor {
                Some(c) => json!({ "limit": PAGE_LIMIT, "cursor": c }),
                None => json!({ "limit": PAGE_LIMIT }),
            };
            let mut params = json!({
                "filters": [
                    {
                        "type": "contract",
                        "contractIds": contract_ids_json,
                    }
                ],
                "pagination": pagination,
            });
            if cursor.is_none() {
                params["startLedger"] = json!(start_ledger);
            }

            let resp: Value = self.call("getEvents", params).await?;

            // Extract latestLedger from top-level response (avoids a second RPC call).
            latest_ledger = resp
                .get("latestLedger")
                .and_then(Value::as_u64)
                .unwrap_or(latest_ledger);

            let events_arr = resp
                .get("events")
                .and_then(Value::as_array)
                .context("getEvents response missing 'events' array")?;
            let page_size = events_arr.len();

            for ev in events_arr {
                if let Some(raw) = parse_event_json(ev, start_ledger, end_ledger) {
                    out.push(raw);
                }
            }

            // Done when the page didn't fill OR the server gave no cursor for next page.
            if (page_size as u64) < PAGE_LIMIT {
                break;
            }
            let next_cursor = resp
                .get("cursor")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }

        Ok((out, latest_ledger))
    }

    /// Fetch the current sequence number of a Stellar account.
    ///
    /// Uses Soroban RPC's `getLedgerEntries` with a `LedgerKey::Account` key.
    /// Returns `Ok(None)` if the account doesn't exist (response has no entries),
    /// or `Ok(Some(seq))` with the current sequence (caller must increment by 1
    /// before submitting a new transaction).
    pub async fn get_account_sequence(&self, account_pubkey: &[u8; 32]) -> Result<Option<i64>> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use stellar_xdr::curr::{
            AccountId, LedgerKey, LedgerKeyAccount, Limits, PublicKey as XdrPublicKey, ReadXdr,
            Uint256, WriteXdr,
        };

        let key = LedgerKey::Account(LedgerKeyAccount {
            account_id: AccountId(XdrPublicKey::PublicKeyTypeEd25519(Uint256(*account_pubkey))),
        });
        let key_bytes = key
            .to_xdr(Limits::none())
            .context("encode LedgerKey::Account")?;
        let key_b64 = STANDARD.encode(key_bytes);

        let resp: Value = self
            .call("getLedgerEntries", json!({ "keys": [key_b64] }))
            .await?;
        let entries = resp
            .get("entries")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let Some(first) = entries.first() else {
            return Ok(None);
        };
        let xdr_b64 = first
            .get("xdr")
            .and_then(Value::as_str)
            .context("getLedgerEntries: entry missing 'xdr'")?;
        let bytes = STANDARD
            .decode(xdr_b64)
            .context("decode LedgerEntryData base64")?;
        let entry = stellar_xdr::curr::LedgerEntryData::from_xdr(bytes.as_slice(), Limits::none())
            .context("decode LedgerEntryData XDR")?;
        match entry {
            stellar_xdr::curr::LedgerEntryData::Account(a) => Ok(Some(a.seq_num.0)),
            _ => Ok(None),
        }
    }

    /// Simulate a Soroban transaction.
    ///
    /// Used both as a view-call (for the `is_authorized` pre-check, no signing
    /// or submit) and as the prelude to a real submit (returns the
    /// `SorobanTransactionData` and auth entries the envelope must carry).
    ///
    /// `envelope_xdr_base64` is a base64-encoded `TransactionEnvelope::Tx(...)`.
    pub async fn simulate_transaction(
        &self,
        envelope_xdr_base64: &str,
    ) -> Result<SimulateResponse> {
        let resp: Value = self
            .call(
                "simulateTransaction",
                json!({ "transaction": envelope_xdr_base64 }),
            )
            .await?;

        let latest_ledger = resp
            .get("latestLedger")
            .and_then(Value::as_u64)
            .context("simulateTransaction: missing latestLedger")?;

        let error = resp.get("error").and_then(Value::as_str).map(str::to_owned);

        let transaction_data_b64 = resp
            .get("transactionData")
            .and_then(Value::as_str)
            .map(str::to_owned);

        let min_resource_fee = resp
            .get("minResourceFee")
            .and_then(Value::as_str)
            .and_then(|s| s.parse::<i64>().ok());

        let results: Vec<SimulateResult> = resp
            .get("results")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|r| {
                        let xdr = r.get("xdr").and_then(Value::as_str).map(str::to_owned)?;
                        let auth: Vec<String> = r
                            .get("auth")
                            .and_then(Value::as_array)
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(str::to_owned))
                                    .collect()
                            })
                            .unwrap_or_default();
                        Some(SimulateResult {
                            return_value_xdr_base64: xdr,
                            auth_xdr_base64: auth,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(SimulateResponse {
            latest_ledger,
            transaction_data_xdr_base64: transaction_data_b64,
            min_resource_fee,
            results,
            error,
        })
    }

    /// Submit a signed Stellar transaction (`sendTransaction` JSON-RPC method).
    pub async fn send_transaction(&self, envelope_xdr_base64: &str) -> Result<SendResponse> {
        let resp: Value = self
            .call(
                "sendTransaction",
                json!({ "transaction": envelope_xdr_base64 }),
            )
            .await?;
        let status = resp
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("UNKNOWN")
            .to_owned();
        let hash = resp
            .get("hash")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let error_result_xdr = resp
            .get("errorResultXdr")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let diagnostic_events_xdr: Vec<String> = resp
            .get("diagnosticEventsXdr")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();

        Ok(SendResponse {
            status,
            hash,
            error_result_xdr,
            diagnostic_events_xdr,
        })
    }

    /// Poll a Stellar transaction by hash (`getTransaction` JSON-RPC method).
    pub async fn get_transaction(&self, hash: &str) -> Result<GetTransactionResponse> {
        let resp: Value = self.call("getTransaction", json!({ "hash": hash })).await?;
        let status = resp
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("UNKNOWN")
            .to_owned();
        let return_value_xdr_base64 = resp
            .get("returnValue")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let result_xdr_base64 = resp
            .get("resultXdr")
            .and_then(Value::as_str)
            .map(str::to_owned);
        Ok(GetTransactionResponse {
            status,
            return_value_xdr_base64,
            result_xdr_base64,
        })
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        });

        let resp = self
            .client
            .post(&self.url)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("Soroban RPC call {method} failed"))?;

        let resp_json: SorobanRpcResponse = resp
            .json()
            .await
            .with_context(|| format!("Failed to parse Soroban RPC response for {method}"))?;

        if let Some(err) = resp_json.error {
            anyhow::bail!(
                "Soroban RPC error {method}: code={} msg={}",
                err.code,
                err.message
            );
        }

        resp_json
            .result
            .context("Soroban RPC response has no 'result' field")
    }
}

/// Response from `simulateTransaction`.
#[derive(Debug, Clone)]
pub struct SimulateResponse {
    pub latest_ledger: u64,
    /// Base64-encoded `SorobanTransactionData`. Absent when simulate errored.
    pub transaction_data_xdr_base64: Option<String>,
    /// Recommended minimum `resourceFee`; absent when simulate errored.
    pub min_resource_fee: Option<i64>,
    /// One entry per top-level host-function invocation.
    pub results: Vec<SimulateResult>,
    /// Error message returned by simulate (e.g., unsupported function, contract trap).
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SimulateResult {
    /// Base64-encoded `ScVal` — the function's return value.
    pub return_value_xdr_base64: String,
    /// Base64-encoded `SorobanAuthorizationEntry` records the envelope must carry.
    pub auth_xdr_base64: Vec<String>,
}

/// Response from `sendTransaction`.
#[derive(Debug, Clone)]
pub struct SendResponse {
    /// One of `PENDING`, `DUPLICATE`, `TRY_AGAIN_LATER`, `ERROR`.
    pub status: String,
    /// 64-hex transaction hash.
    pub hash: String,
    /// Base64-encoded `TransactionResult` when `status = "ERROR"`.
    pub error_result_xdr: Option<String>,
    /// Base64-encoded diagnostic events for debugging.
    pub diagnostic_events_xdr: Vec<String>,
}

/// Response from `getTransaction`.
#[derive(Debug, Clone)]
pub struct GetTransactionResponse {
    /// One of `NOT_FOUND`, `SUCCESS`, `FAILED`.
    pub status: String,
    /// Base64-encoded `ScVal` — return value on `SUCCESS`.
    pub return_value_xdr_base64: Option<String>,
    /// Base64-encoded `TransactionResult` — useful diagnostic on `FAILED`.
    pub result_xdr_base64: Option<String>,
}

#[derive(Deserialize)]
struct SorobanRpcResponse {
    result: Option<Value>,
    error: Option<SorobanRpcError>,
}

#[derive(Deserialize)]
struct SorobanRpcError {
    code: i64,
    message: String,
}

/// JSON shape returned by `getLatestLedger`.
#[allow(dead_code)]
#[derive(Deserialize)]
struct LatestLedgerResult {
    sequence: u32,
}

/// JSON shape of a single event in `getEvents.events[]`.
#[allow(dead_code)]
#[derive(Deserialize, Debug)]
struct SorobanEventJson {
    #[serde(rename = "type")]
    event_type: String,
    ledger: u32,
    #[serde(rename = "ledgerClosedAt")]
    ledger_closed_at: String,
    #[serde(rename = "contractId")]
    contract_id: Option<String>,
    id: String,
    #[serde(rename = "pagingToken")]
    paging_token: Option<String>,
    topic: Vec<String>,
    value: String,
    #[serde(rename = "inSuccessfulContractCall")]
    in_successful_contract_call: bool,
    #[serde(rename = "txHash")]
    tx_hash: Option<String>,
}

/// Parse a single JSON event object into a `RawEvent`.
/// Returns `None` for events outside `[start_ledger, end_ledger]` or with missing fields.
fn parse_event_json(ev: &Value, start_ledger: u64, end_ledger: u64) -> Option<RawEvent> {
    let ledger = ev.get("ledger")?.as_u64()? as u32;
    if (ledger as u64) < start_ledger || (ledger as u64) > end_ledger {
        return None;
    }

    let contract_id = ev.get("contractId")?.as_str()?;
    let ledger_closed_at_str = ev.get("ledgerClosedAt")?.as_str()?;
    let tx_hash = ev.get("txHash").and_then(Value::as_str).unwrap_or("");
    let id_str = ev.get("id")?.as_str()?;

    let topics = ev.get("topic")?.as_array()?;
    let value_b64 = ev.get("value")?.as_str()?;

    if topics.is_empty() {
        return None;
    }

    let topics_base64: Vec<String> = topics
        .iter()
        .filter_map(|t| t.as_str().map(str::to_owned))
        .collect();

    // Decode first topic to get the event name symbol.
    let event_name = decode_symbol_topic(topics_base64.first()?)?;

    // Parse ledger close time as Unix seconds.
    let ledger_closed_at_unix = chrono::DateTime::parse_from_rfc3339(ledger_closed_at_str)
        .ok()?
        .timestamp() as u64;

    // The Soroban event `id` is `{ledger_sequence}:{tx_index}:{op_index}:{event_index}`.
    // Example: `0000001234-0000000001-0000000000-0000000000`
    let (tx_index, op_index, event_index_in_op) = parse_event_id(id_str);

    Some(RawEvent {
        contract_id: contract_id.to_owned(),
        event_name,
        topics_base64,
        value_base64: value_b64.to_owned(),
        ledger,
        ledger_closed_at_unix,
        tx_hash: tx_hash.to_owned(),
        tx_index,
        op_index,
        event_index_in_op,
    })
}

/// Decode the first topic ScVal as a Symbol string.
fn decode_symbol_topic(b64: &str) -> Option<String> {
    use stellar_xdr::curr::{Limits, ReadXdr, ScVal};

    let val = ScVal::from_xdr_base64(b64, Limits::none()).ok()?;
    match val {
        ScVal::Symbol(sym) => Some(sym.0.to_utf8_string_lossy().clone()),
        _ => None,
    }
}

/// Parse the Soroban event `id` field — format is `{TOID}-{event_index_in_op}` (2 parts).
///
/// The TOID (Total-Order ID) is a single u64 that packs `(ledger, tx_index, op_index)` per
/// Stellar Horizon's convention:
/// - bits 32-63: `ledger_sequence` (u32)
/// - bits 12-31: `tx_application_order` (1-indexed within ledger, ~20 bits)
/// - bits 0-11:  `op_index` (0-indexed within tx, ~12 bits)
///
/// The second part is the event index within the operation (0-indexed).
///
/// Example: `"0000005304768018944-0000000001"` → TOID 5304768018944 → ledger=1234,
/// tx_index=1, op_index=0 → returned as `(tx_index=1, op_index=0, event_index_in_op=1)`.
pub(crate) fn parse_event_id(id: &str) -> (u32, u32, u32) {
    let mut split = id.splitn(2, '-');
    let toid_str = split.next().unwrap_or("");
    let event_str = split.next().unwrap_or("");

    let toid: u64 = toid_str.trim_start_matches('0').parse().unwrap_or(0);
    let event_index_in_op: u32 = event_str.trim_start_matches('0').parse().unwrap_or(0);

    // TOID layout: bits 12-31 = tx_index (1-indexed, 20 bits), bits 0-11 = op_index (12 bits).
    let tx_index = ((toid >> 12) & 0x000F_FFFF) as u32;
    let op_index = (toid & 0x0000_0FFF) as u32;

    (tx_index, op_index, event_index_in_op)
}
