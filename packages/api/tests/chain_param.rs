// spec: docs/exec-plans/completed/issue-1528-loanbook-chain-param.md
use axum::http::{StatusCode, Uri};
use axum::response::IntoResponse;
use pipeline_api::config::ConfiguredChain;
use pipeline_api::error::ApiError;
use pipeline_api::routes::common::{
    parse_chain_filter, parse_chain_scope, parse_required_chain, ChainFilter, ChainScope,
    LenientChainFilter, RequiredChain,
};
use pipeline_api::routes::loan_book::LoanBookDoc;
use shared::chains::ChainKind;
use utoipa::{IntoParams, OpenApi};

const EVM: ConfiguredChain = ConfiguredChain {
    chain_id: 1,
    kind: ChainKind::Evm,
};
const STELLAR: ConfiguredChain = ConfiguredChain {
    chain_id: 99_000_001,
    kind: ChainKind::Stellar,
};

fn chains() -> [ConfiguredChain; 2] {
    [EVM, STELLAR]
}

fn uri(s: &'static str) -> Uri {
    Uri::from_static(s)
}

fn bad_request_message(err: ApiError) -> String {
    match err {
        ApiError::BadRequest(m) => m,
        _ => panic!("expected BadRequest"),
    }
}

#[test]
fn filter_without_chain_id_is_none() {
    assert_eq!(
        parse_chain_filter(&uri("/v1/loan-book"), &chains()).unwrap(),
        None
    );
    assert_eq!(
        parse_chain_filter(&uri("/v1/loan-book?other=x"), &chains()).unwrap(),
        None
    );
}

#[test]
fn filter_carries_kind_through() {
    assert_eq!(
        parse_chain_filter(&uri("/p?chain_id=1"), &chains()).unwrap(),
        Some(EVM)
    );
    assert_eq!(
        parse_chain_filter(&uri("/p?chain_id=99000001"), &chains()).unwrap(),
        Some(STELLAR)
    );
}

#[test]
fn filter_trims_whitespace() {
    assert_eq!(
        parse_chain_filter(&uri("/p?chain_id=%201%20"), &chains()).unwrap(),
        Some(EVM)
    );
}

#[test]
fn filter_unknown_chain_lists_configured() {
    let err = parse_chain_filter(&uri("/p?chain_id=5"), &chains()).unwrap_err();
    assert_eq!(
        bad_request_message(err),
        "unknown chain_id: 5 (configured: 1, 99000001)"
    );
}

#[test]
fn filter_malformed_is_invalid() {
    let err = parse_chain_filter(&uri("/p?chain_id=abc"), &chains()).unwrap_err();
    assert_eq!(bad_request_message(err), "invalid chain_id: abc");
    let err = parse_chain_filter(&uri("/p?chain_id="), &chains()).unwrap_err();
    assert_eq!(bad_request_message(err), "invalid chain_id: ");
}

#[test]
fn filter_repeated_chain_id_is_invalid() {
    let err = parse_chain_filter(&uri("/p?chain_id=1&chain_id=2"), &chains()).unwrap_err();
    assert_eq!(
        bad_request_message(err),
        "invalid chain_id: must appear at most once"
    );
}

#[test]
fn filter_coexists_with_other_params() {
    assert_eq!(
        parse_chain_filter(&uri("/p?chain_id=1&status=InReview"), &chains()).unwrap(),
        Some(EVM)
    );
}

#[test]
fn required_missing_is_400_message() {
    let err = parse_required_chain(&uri("/p"), &chains()).unwrap_err();
    assert_eq!(bad_request_message(err), "chain_id is required");
}

#[test]
fn required_valid_and_unknown() {
    assert_eq!(
        parse_required_chain(&uri("/p?chain_id=99000001"), &chains()).unwrap(),
        STELLAR
    );
    let err = parse_required_chain(&uri("/p?chain_id=5"), &chains()).unwrap_err();
    assert_eq!(
        bad_request_message(err),
        "unknown chain_id: 5 (configured: 1, 99000001)"
    );
}

#[tokio::test]
async fn error_body_is_json_error_object() {
    let err = parse_required_chain(&uri("/p?chain_id=abc"), &chains()).unwrap_err();
    let resp = err.into_response();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body, serde_json::json!({"error": "invalid chain_id: abc"}));
}

#[test]
fn chain_filter_resolve_and_chain_id() {
    let all = chains();
    let some = ChainFilter(Some(STELLAR));
    assert_eq!(some.resolve(&all), &[STELLAR]);
    assert_eq!(some.chain_id(), Some(99_000_001));
    let none = ChainFilter(None);
    assert_eq!(none.resolve(&all), &all);
    assert_eq!(none.chain_id(), None);
}

#[test]
fn openapi_params_have_expected_required_flag() {
    let optional = serde_json::to_value(ChainFilter::into_params(|| None)).unwrap();
    let required = serde_json::to_value(RequiredChain::into_params(|| None)).unwrap();
    for (v, expect_required) in [(optional, false), (required, true)] {
        let params = v.as_array().unwrap();
        assert_eq!(params.len(), 1);
        let p = &params[0];
        assert_eq!(p["name"], "chain_id");
        assert_eq!(p["in"], "query");
        assert_eq!(p["required"], expect_required);
        assert_eq!(p["schema"]["type"], "integer");
        assert_eq!(p["schema"]["format"], "int64");
    }
}

#[test]
fn scope_absent_is_all() {
    assert_eq!(
        parse_chain_scope(&uri("/v1/loan-book"), &chains()).unwrap(),
        ChainScope::All
    );
}

#[test]
fn scope_configured_is_one_with_kind_and_trims() {
    assert_eq!(
        parse_chain_scope(&uri("/p?chain_id=1"), &chains()).unwrap(),
        ChainScope::One(EVM)
    );
    assert_eq!(
        parse_chain_scope(&uri("/p?chain_id=%201%20"), &chains()).unwrap(),
        ChainScope::One(EVM)
    );
    assert_eq!(
        parse_chain_scope(&uri("/p?chain_id=99000001"), &chains()).unwrap(),
        ChainScope::One(STELLAR)
    );
}

#[test]
fn scope_unconfigured_is_not_an_error() {
    assert_eq!(
        parse_chain_scope(&uri("/p?chain_id=560048"), &chains()).unwrap(),
        ChainScope::Unconfigured(560_048)
    );
}

#[test]
fn scope_malformed_or_repeated_is_400() {
    for q in ["/p?chain_id=abc", "/p?chain_id="] {
        let err = parse_chain_scope(&uri(q), &chains()).unwrap_err();
        assert!(bad_request_message(err).starts_with("invalid chain_id: "));
    }
    let err = parse_chain_scope(&uri("/p?chain_id=1&chain_id=2"), &chains()).unwrap_err();
    assert_eq!(
        bad_request_message(err),
        "invalid chain_id: must appear at most once"
    );
}

#[test]
fn lenient_chain_ids_per_variant() {
    let all = chains();
    assert_eq!(
        LenientChainFilter(ChainScope::All).chain_ids(&all),
        [1, 99_000_001]
    );
    assert_eq!(
        LenientChainFilter(ChainScope::One(STELLAR)).chain_ids(&all),
        [99_000_001]
    );
    assert_eq!(
        LenientChainFilter(ChainScope::Unconfigured(7)).chain_ids(&all),
        [7]
    );
}

#[test]
fn lenient_openapi_param_is_optional_int64() {
    let v = serde_json::to_value(LenientChainFilter::into_params(|| None)).unwrap();
    let params = v.as_array().unwrap();
    assert_eq!(params.len(), 1);
    assert_eq!(params[0]["name"], "chain_id");
    assert_eq!(params[0]["in"], "query");
    assert_eq!(params[0]["required"], false);
    assert_eq!(params[0]["schema"]["type"], "integer");
    assert_eq!(params[0]["schema"]["format"], "int64");
}

#[test]
fn loan_book_openapi_declares_chain_param() {
    let doc = serde_json::to_value(LoanBookDoc::openapi()).unwrap();
    let get = &doc["paths"]["/v1/loan-book"]["get"];
    let params = get["parameters"].as_array().unwrap();
    let chain: Vec<_> = params.iter().filter(|p| p["name"] == "chain_id").collect();
    assert_eq!(chain.len(), 1);
    assert_eq!(chain[0]["required"], false);
    assert!(get["responses"]["400"].is_object());
}
