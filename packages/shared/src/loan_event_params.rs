// spec: docs/exec-plans/active/issue-1523-loanbook-readers-params-event.md#implementation-steps
use bigdecimal::BigDecimal;

use crate::loan_snapshot::LoanSnapshot;

pub fn build_loan_event_params(
    loan_id: &BigDecimal,
    parser_params: &serde_json::Value,
    snapshot: &LoanSnapshot,
) -> serde_json::Value {
    let event_fields: serde_json::Map<String, serde_json::Value> = parser_params
        .as_object()
        .map(|m| {
            m.iter()
                .filter(|(k, _)| k.as_str() != "loan_id")
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        })
        .unwrap_or_default();

    serde_json::json!({
        "loan_id": loan_id.to_string(),
        "event": event_fields,
        "snapshot": snapshot,
    })
}

pub fn event_field<'a>(params: &'a serde_json::Value, key: &str) -> Option<&'a serde_json::Value> {
    params.get("event")?.get(key)
}

pub fn json_i64(v: &serde_json::Value) -> Option<i64> {
    match v {
        serde_json::Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_u64().and_then(|u| i64::try_from(u).ok())),
        serde_json::Value::String(s) => s.parse::<i64>().ok(),
        _ => None,
    }
}
