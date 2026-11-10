// spec: docs/product-specs/kyb-lp-verification.md#settlement-address

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use alloy::signers::local::PrivateKeySigner;
use alloy::signers::SignerSync;
use async_trait::async_trait;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use axum::response::IntoResponse;
use chrono::{DateTime, TimeZone, Utc};
use ed25519_dalek::{Signer, SigningKey};
use pipeline_api::config::{ConfiguredChain, KybLimits};
use pipeline_api::error::ApiError;
use pipeline_api::routes::auth::wallet::{challenge_message, CHALLENGE_TTL_SECS};
use pipeline_api::routes::lp_settlement_address::{
    issue_link_challenge, link_challenge_message, link_refusal, resolve_link_target, verify_link,
    LinkTarget, LpSettlementAddressDoc, LINK_CHALLENGE_TTL_SECS, LINK_PROOF_FAILED,
};
use pipeline_api::routes::{lp_settlement_address, lps};
use pipeline_api::AppState;
use sha2::{Digest, Sha256};
use shared::chains::ChainKind;
use shared::contract_logs_repo::ContractLogsRepo;
use shared::kyc_repo::KycRepo;
use shared::lp_repo::{LinkChallenge, LinkOutcome, LpRow, SettlementLink, SettlementLinkStore};
use shared::position_repo::PositionRepo;
use tower::ServiceExt;
use uuid::Uuid;

const DOMAIN: &str = "app.pipeline.one";
const LP_ID: i64 = 42;
const ACCOUNT: Uuid = Uuid::from_u128(7);
const STELLAR: ConfiguredChain = ConfiguredChain {
    chain_id: 99_000_001,
    kind: ChainKind::Stellar,
};
const EVM: ConfiguredChain = ConfiguredChain {
    chain_id: 560_048,
    kind: ChainKind::Evm,
};
const PROOF_FAILED: &str = "settlement address proof failed";

fn t(secs: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(1_800_000_000 + secs, 0).unwrap()
}

// ── Keys ─────────────────────────────────────────────────────────────────────

fn stellar_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn g_of(key: &SigningKey) -> String {
    format!(
        "{}",
        stellar_strkey::ed25519::PublicKey(key.verifying_key().to_bytes())
    )
}

fn contract() -> String {
    format!("{}", stellar_strkey::Contract([9; 32]))
}

fn sep53(key: &SigningKey, message: &str) -> [u8; 64] {
    let mut h = Sha256::new();
    h.update(b"Stellar Signed Message:\n");
    h.update(message.as_bytes());
    let digest: [u8; 32] = h.finalize().into();
    key.sign(&digest).to_bytes()
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |acc, (i, b)| acc | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn evm_signer(byte: &str) -> PrivateKeySigner {
    byte.repeat(32).parse().unwrap()
}

fn evm_addr(signer: &PrivateKeySigner) -> String {
    format!("{}", signer.address()).to_lowercase()
}

fn evm_sig(signer: &PrivateKeySigner, message: &str) -> String {
    hex::encode(
        signer
            .sign_message_sync(message.as_bytes())
            .unwrap()
            .as_bytes(),
    )
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

fn lp(status: &str, stellar: Option<&str>, evm: Option<&str>) -> LpRow {
    LpRow {
        id: LP_ID,
        legal_name: "Acme".to_owned(),
        country: None,
        contact_email: "ops@acme.example".to_owned(),
        stellar_address: stellar.map(str::to_owned),
        address_linked_at: None,
        stellar_signer_address: None,
        evm_address: evm.map(str::to_owned),
        evm_signer_address: None,
        evm_address_linked_at: None,
        kyb_status: status.to_owned(),
        kyb_submitted_at: None,
        kyb_decided_by: None,
        kyb_decided_at: None,
        kyb_decision_reason: None,
        notify_on_review: false,
        owner_account_id: Uuid::nil(),
        owner_chain_id: None,
        owner_address: None,
        created_at: t(0),
        updated_at: t(0),
        settlement_bank_account: None,
    }
}

fn open_lp() -> LpRow {
    lp("NotStarted", None, None)
}

struct FakeState {
    challenge: Option<LinkChallenge>,
    expired: bool,
    holder: Option<i64>,
    consume_finds_nothing: bool,
    link_outcome: LinkOutcome,
    links: Vec<SettlementLink>,
    issue_calls: usize,
    last_ttl: Option<i32>,
}

struct FakeLinkStore {
    inner: Mutex<FakeState>,
}

impl FakeLinkStore {
    fn new() -> Self {
        Self {
            inner: Mutex::new(FakeState {
                challenge: None,
                expired: false,
                holder: None,
                consume_finds_nothing: false,
                link_outcome: LinkOutcome::Linked,
                links: Vec::new(),
                issue_calls: 0,
                last_ttl: None,
            }),
        }
    }

    fn with<R>(&self, f: impl FnOnce(&mut FakeState) -> R) -> R {
        f(&mut self.inner.lock().unwrap())
    }

    fn challenge_present(&self) -> bool {
        self.with(|s| s.challenge.is_some())
    }

    fn links(&self) -> Vec<SettlementLink> {
        self.with(|s| s.links.clone())
    }
}

#[async_trait]
impl SettlementLinkStore for FakeLinkStore {
    async fn issue_or_reuse_challenge(
        &self,
        _lp_id: i64,
        _chain_id: i64,
        address: &str,
        signer_address: &str,
        fresh_nonce: &str,
        ttl_secs: i32,
    ) -> Result<(String, DateTime<Utc>), sqlx::Error> {
        self.with(|s| {
            s.issue_calls += 1;
            s.last_ttl = Some(ttl_secs);
            let reuse = s
                .challenge
                .as_ref()
                .filter(|c| c.address == address && c.signer_address == signer_address)
                .cloned();
            let stored = reuse.unwrap_or(LinkChallenge {
                address: address.to_owned(),
                signer_address: signer_address.to_owned(),
                nonce: fresh_nonce.to_owned(),
                expires_at: t(i64::from(ttl_secs)),
            });
            s.challenge = Some(stored.clone());
            Ok((stored.nonce, stored.expires_at))
        })
    }

    async fn find_challenge(
        &self,
        _lp_id: i64,
        _chain_id: i64,
    ) -> Result<Option<LinkChallenge>, sqlx::Error> {
        Ok(self.with(|s| if s.expired { None } else { s.challenge.clone() }))
    }

    async fn consume_challenge(
        &self,
        _lp_id: i64,
        _chain_id: i64,
        nonce: &str,
    ) -> Result<Option<LinkChallenge>, sqlx::Error> {
        Ok(self.with(|s| {
            if s.consume_finds_nothing || s.expired {
                return None;
            }
            match s.challenge.take() {
                Some(c) if c.nonce == nonce => Some(c),
                other => {
                    s.challenge = other;
                    None
                }
            }
        }))
    }

    async fn address_holder(
        &self,
        _kind: ChainKind,
        _address: &str,
    ) -> Result<Option<i64>, sqlx::Error> {
        Ok(self.with(|s| s.holder))
    }

    async fn link_settlement_address(
        &self,
        link: &SettlementLink,
    ) -> Result<LinkOutcome, sqlx::Error> {
        Ok(self.with(|s| {
            if s.link_outcome == LinkOutcome::Linked {
                s.links.push(link.clone());
            }
            s.link_outcome
        }))
    }
}

fn target(kind: ChainKind, address: &str, signer: Option<&str>) -> LinkTarget {
    resolve_link_target(kind, address, signer).unwrap()
}

async fn issue(store: &FakeLinkStore, chain: ConfiguredChain, target: &LinkTarget) -> String {
    issue_link_challenge(store, &open_lp(), chain, target, DOMAIN, "n-1".to_owned())
        .await
        .unwrap()
        .message
}

async fn issue_for(
    store: &FakeLinkStore,
    row: &LpRow,
    chain: ConfiguredChain,
    target: &LinkTarget,
    nonce: &str,
) -> String {
    issue_link_challenge(store, row, chain, target, DOMAIN, nonce.to_owned())
        .await
        .unwrap()
        .message
}

fn link_for(chain: ConfiguredChain, address: &str, signer: &str) -> SettlementLink {
    SettlementLink {
        lp_id: LP_ID,
        kind: chain.kind,
        chain_id: chain.chain_id,
        address: address.to_owned(),
        signer_address: signer.to_owned(),
        linked_by_account_id: ACCOUNT,
    }
}

fn sign(chain: ConfiguredChain, key: &SigningKey, evm: &PrivateKeySigner, message: &str) -> String {
    match chain.kind {
        ChainKind::Stellar => hex::encode(sep53(key, message)),
        ChainKind::Evm => evm_sig(evm, message),
    }
}

fn is_proof_failed(err: &ApiError) -> bool {
    matches!(err, ApiError::UnprocessableEntity(m) if m == PROOF_FAILED)
}

fn conflict(err: ApiError) -> String {
    match err {
        ApiError::Conflict(m) => m,
        other => panic!("expected Conflict, got {other:?}"),
    }
}

// ── Message ──────────────────────────────────────────────────────────────────

fn message(expires_at: DateTime<Utc>) -> String {
    link_challenge_message(
        DOMAIN, LP_ID, 99_000_001, "GADDR", "GSIGNER", "n-1", expires_at,
    )
}

#[test]
fn the_message_is_byte_exact_to_the_template() {
    let expected = "app.pipeline.one wants you to link a settlement address to your Pipeline LP account. Settlement address: GADDR Signed by: GSIGNER Sign this message to prove you control this wallet. This request will not trigger a blockchain transaction or cost any gas. LP ID: 42 Chain ID: 99000001 Nonce: n-1 Issued At: 2027-01-15T08:00:00Z Expiration Time: 2027-01-15T09:00:00Z";
    assert_eq!(message(t(3600)), expected);
}

#[test]
fn issued_at_is_expiry_minus_one_hour_and_the_message_is_deterministic() {
    assert_eq!(LINK_CHALLENGE_TTL_SECS, 3600);
    assert_eq!(CHALLENGE_TTL_SECS, 300);
    let m = message(t(4200));
    assert!(m.contains("Issued At: 2027-01-15T08:10:00Z"));
    assert!(m.contains("Expiration Time: 2027-01-15T09:10:00Z"));
    assert_eq!(message(t(3600)), message(t(3600)));
}

#[test]
fn the_message_is_one_line_without_double_spaces() {
    let g = g_of(&stellar_key(7));
    let evm = evm_addr(&evm_signer("11"));
    let nonce = Uuid::new_v4().to_string();
    for (chain_id, address, signer) in [
        (STELLAR.chain_id, g.as_str(), g.as_str()),
        (EVM.chain_id, evm.as_str(), evm.as_str()),
    ] {
        let m = link_challenge_message(DOMAIN, LP_ID, chain_id, address, signer, &nonce, t(5400));
        assert!(!m.contains('\n'), "{m}");
        assert!(!m.contains('\r'), "{m}");
        assert!(!m.contains("  "), "{m}");
    }
}

#[test]
fn the_message_changes_with_every_bound_field() {
    let base = message(t(300));
    let variants = [
        link_challenge_message(
            "other.example",
            LP_ID,
            99_000_001,
            "GADDR",
            "GSIGNER",
            "n-1",
            t(300),
        ),
        link_challenge_message(DOMAIN, 43, 99_000_001, "GADDR", "GSIGNER", "n-1", t(300)),
        link_challenge_message(DOMAIN, LP_ID, 1, "GADDR", "GSIGNER", "n-1", t(300)),
        link_challenge_message(
            DOMAIN,
            LP_ID,
            99_000_001,
            "GOTHER",
            "GSIGNER",
            "n-1",
            t(300),
        ),
        link_challenge_message(DOMAIN, LP_ID, 99_000_001, "GADDR", "GOTHER", "n-1", t(300)),
        link_challenge_message(DOMAIN, LP_ID, 99_000_001, "GADDR", "GSIGNER", "n-2", t(300)),
        message(t(301)),
    ];
    for variant in variants {
        assert_ne!(base, variant);
    }
}

#[test]
fn the_message_differs_from_the_sign_in_message() {
    let link = link_challenge_message(DOMAIN, LP_ID, 99_000_001, "GADDR", "GADDR", "n-1", t(300));
    let sign_in = challenge_message(DOMAIN, "GADDR", 99_000_001, "n-1", t(300));
    assert_ne!(link, sign_in);
    assert!(!link.contains("sign in with your wallet"));
}

// ── resolve_link_target ──────────────────────────────────────────────────────

#[test]
fn a_stellar_account_without_a_signer_defaults_to_itself() {
    let g = g_of(&stellar_key(7));
    let resolved = resolve_link_target(ChainKind::Stellar, &g, None).unwrap();
    assert_eq!(resolved.address, g);
    assert_eq!(resolved.signer_address, g);
}

#[test]
fn a_stellar_contract_without_a_signer_is_refused() {
    let err = resolve_link_target(ChainKind::Stellar, &contract(), None).unwrap_err();
    assert_eq!(
        err,
        "signer_address is required for a Stellar contract (C…) settlement address"
    );
}

#[test]
fn a_stellar_contract_with_an_account_signer_is_accepted() {
    let g = g_of(&stellar_key(7));
    let resolved = resolve_link_target(ChainKind::Stellar, &contract(), Some(&g)).unwrap();
    assert_eq!(resolved.address, contract());
    assert_eq!(resolved.signer_address, g);
}

#[test]
fn a_stellar_contract_signer_is_refused() {
    let err = resolve_link_target(ChainKind::Stellar, &contract(), Some(&contract())).unwrap_err();
    assert_eq!(
        err,
        "signer_address must be a Stellar account (G…) Strkey with a valid checksum"
    );
}

#[test]
fn an_evm_address_without_a_signer_defaults_to_the_lowercased_address() {
    let checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    let resolved = resolve_link_target(ChainKind::Evm, checksummed, None).unwrap();
    assert_eq!(resolved.address, checksummed.to_lowercase());
    assert_eq!(resolved.signer_address, checksummed.to_lowercase());
}

#[test]
fn an_evm_signer_different_from_the_address_is_kept() {
    let a = evm_addr(&evm_signer("11"));
    let b = evm_addr(&evm_signer("22"));
    let resolved = resolve_link_target(ChainKind::Evm, &a, Some(&b)).unwrap();
    assert_eq!(resolved.address, a);
    assert_eq!(resolved.signer_address, b);
}

#[test]
fn an_address_of_the_wrong_kind_is_refused() {
    let g = g_of(&stellar_key(7));
    let on_evm = resolve_link_target(ChainKind::Evm, &g, None).unwrap_err();
    assert_eq!(
        on_evm,
        "address must be a 0x-prefixed 20-byte hex EVM address"
    );
    let on_stellar =
        resolve_link_target(ChainKind::Stellar, &evm_addr(&evm_signer("11")), None).unwrap_err();
    assert_eq!(
        on_stellar,
        "address must be a Stellar account (G…) or contract (C…) Strkey with a valid checksum"
    );
}

#[test]
fn a_blank_signer_counts_as_omitted() {
    let g = g_of(&stellar_key(7));
    let resolved = resolve_link_target(ChainKind::Stellar, &g, Some("  ")).unwrap();
    assert_eq!(resolved.signer_address, g);
    assert!(resolve_link_target(ChainKind::Stellar, &contract(), Some("")).is_err());
}

// ── link_refusal ─────────────────────────────────────────────────────────────

fn refusal(row: &LpRow, kind: ChainKind, holder: Option<i64>, addr: &str) -> Result<(), String> {
    link_refusal(row, row.kyb_status.parse().unwrap(), kind, holder, addr)
}

#[test]
fn a_failed_lp_is_refused_with_or_without_an_address() {
    for row in [lp("Failed", None, None), lp("Failed", Some("GOLD"), None)] {
        let msg = refusal(&row, ChainKind::Stellar, None, "GNEW").unwrap_err();
        assert_eq!(
            msg,
            "LP 42 was refused at KYB and cannot set a settlement address"
        );
    }
}

#[test]
fn a_passed_lp_may_relink_either_kind() {
    let row = lp("Passed", Some("GOLD"), Some("0xold"));
    assert!(refusal(&row, ChainKind::Stellar, None, "GNEW").is_ok());
    assert!(refusal(&row, ChainKind::Evm, None, "0xnew").is_ok());
}

#[test]
fn a_passed_lp_may_still_link_the_other_kind() {
    let row = lp("Passed", Some("GOLD"), None);
    assert!(refusal(&row, ChainKind::Evm, None, "0xnew").is_ok());
}

#[test]
fn another_lp_holding_the_address_is_a_conflict() {
    let msg = refusal(&open_lp(), ChainKind::Evm, Some(7), "0xabc").unwrap_err();
    assert_eq!(
        msg,
        "EVM settlement address 0xabc is already linked to another LP"
    );
}

#[test]
fn this_lp_holding_the_address_at_a_non_terminal_status_is_allowed() {
    let row = lp("UnderReview", Some("GOLD"), None);
    assert!(refusal(&row, ChainKind::Stellar, Some(LP_ID), "GOLD").is_ok());
}

// ── issue_link_challenge ─────────────────────────────────────────────────────

#[tokio::test]
async fn issuing_returns_the_stored_nonce_and_the_rebuilt_message() {
    let store = FakeLinkStore::new();
    let g = g_of(&stellar_key(7));
    let tgt = target(ChainKind::Stellar, &g, None);
    let response =
        issue_link_challenge(&store, &open_lp(), STELLAR, &tgt, DOMAIN, "n-1".to_owned())
            .await
            .unwrap();
    assert_eq!(response.nonce, "n-1");
    assert_eq!(
        response.message,
        link_challenge_message(
            DOMAIN,
            LP_ID,
            STELLAR.chain_id,
            &g,
            &g,
            "n-1",
            t(LINK_CHALLENGE_TTL_SECS)
        )
    );
    assert_eq!(store.with(|s| s.last_ttl), Some(3600));
}

#[tokio::test]
async fn a_refused_lp_never_reaches_the_issue_call() {
    let g = g_of(&stellar_key(7));
    let tgt = target(ChainKind::Stellar, &g, None);
    for row in [lp("Failed", None, None), lp("Failed", Some("GOLD"), None)] {
        let store = FakeLinkStore::new();
        let err = issue_link_challenge(&store, &row, STELLAR, &tgt, DOMAIN, "n-1".to_owned())
            .await
            .unwrap_err();
        assert!(matches!(err, ApiError::Conflict(_)));
        assert_eq!(store.with(|s| s.issue_calls), 0);
    }
}

#[tokio::test]
async fn an_address_held_by_another_lp_is_refused_at_challenge_time() {
    let store = FakeLinkStore::new();
    store.with(|s| s.holder = Some(7));
    let g = g_of(&stellar_key(7));
    let tgt = target(ChainKind::Stellar, &g, None);
    let err = issue_link_challenge(&store, &open_lp(), STELLAR, &tgt, DOMAIN, "n-1".to_owned())
        .await
        .unwrap_err();
    assert!(conflict(err).contains("is already linked to another LP"));
    assert_eq!(store.with(|s| s.issue_calls), 0);
}

async fn assert_opaque_500(err: ApiError) {
    assert!(matches!(err, ApiError::Internal(_)), "{err:?}");
    let resp = err.into_response();
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert_eq!(text, r#"{"error":"internal error"}"#);
    assert!(!text.contains("unknown kyb status") && !text.contains("Bogus"));
}

#[tokio::test]
async fn a_corrupt_kyb_status_is_a_500_at_challenge_time() {
    let store = FakeLinkStore::new();
    let g = g_of(&stellar_key(7));
    let tgt = target(ChainKind::Stellar, &g, None);
    let err = issue_link_challenge(
        &store,
        &lp("Bogus", None, None),
        STELLAR,
        &tgt,
        DOMAIN,
        "n-1".to_owned(),
    )
    .await
    .unwrap_err();
    assert_opaque_500(err).await;
    assert_eq!(store.with(|s| s.issue_calls), 0);
}

#[tokio::test]
async fn a_corrupt_kyb_status_is_a_500_at_verify_and_keeps_the_challenge() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue(&store, STELLAR, &tgt).await;
    let sig = hex::encode(sep53(&key, &msg));
    let mut corrupt = open_lp();
    corrupt.kyb_status = "Bogus".to_owned();
    let err = verify_link(&store, &corrupt, STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert_opaque_500(err).await;
    assert!(store.challenge_present());
    assert!(store.links().is_empty());
}

// ── verify_link: refusals ────────────────────────────────────────────────────

#[tokio::test]
async fn a_signature_by_another_key_is_a_proof_failure_and_keeps_the_challenge() {
    let store = FakeLinkStore::new();
    let g = g_of(&stellar_key(7));
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue(&store, STELLAR, &tgt).await;
    let wrong = hex::encode(sep53(&stellar_key(8), &msg));
    let err = verify_link(&store, &open_lp(), STELLAR, &tgt, &wrong, DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert!(is_proof_failed(&err), "{err:?}");
    assert_eq!(LINK_PROOF_FAILED, PROOF_FAILED);
    assert!(store.challenge_present());
    assert!(store.links().is_empty());
}

#[tokio::test]
async fn an_expired_challenge_is_a_proof_failure() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue(&store, STELLAR, &tgt).await;
    store.with(|s| s.expired = true);
    let sig = hex::encode(sep53(&key, &msg));
    let err = verify_link(&store, &open_lp(), STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert!(is_proof_failed(&err));
    assert!(store.links().is_empty());
}

#[tokio::test]
async fn a_challenge_that_was_never_issued_is_a_proof_failure() {
    let store = FakeLinkStore::new();
    let g = g_of(&stellar_key(7));
    let tgt = target(ChainKind::Stellar, &g, None);
    let err = verify_link(&store, &open_lp(), STELLAR, &tgt, "00", DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert!(is_proof_failed(&err));
    assert!(store.links().is_empty());
}

#[tokio::test]
async fn a_replay_after_success_is_a_proof_failure() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue(&store, STELLAR, &tgt).await;
    let sig = hex::encode(sep53(&key, &msg));
    verify_link(&store, &open_lp(), STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap();
    let err = verify_link(&store, &open_lp(), STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert!(is_proof_failed(&err));
    assert_eq!(store.links().len(), 1);
}

#[tokio::test]
async fn a_sign_in_signature_is_a_proof_failure() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &g, None);
    issue(&store, STELLAR, &tgt).await;
    let sign_in = challenge_message(DOMAIN, &g, STELLAR.chain_id, "n-1", t(300));
    let sig = hex::encode(sep53(&key, &sign_in));
    let err = verify_link(&store, &open_lp(), STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert!(is_proof_failed(&err));
    assert!(store.challenge_present());
    assert!(store.links().is_empty());
}

#[tokio::test]
async fn an_address_differing_from_the_challenge_is_a_proof_failure() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue(&store, STELLAR, &tgt).await;
    let sig = hex::encode(sep53(&key, &msg));
    let other = target(ChainKind::Stellar, &contract(), Some(&g));
    let err = verify_link(&store, &open_lp(), STELLAR, &other, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert!(is_proof_failed(&err));
    assert!(store.links().is_empty());
}

#[tokio::test]
async fn a_signer_differing_from_the_challenge_is_a_proof_failure() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &contract(), Some(&g));
    let msg = issue(&store, STELLAR, &tgt).await;
    let sig = hex::encode(sep53(&key, &msg));
    let other_signer = g_of(&stellar_key(8));
    let other = target(ChainKind::Stellar, &contract(), Some(&other_signer));
    let err = verify_link(&store, &open_lp(), STELLAR, &other, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert!(is_proof_failed(&err));
    assert!(store.links().is_empty());
}

#[tokio::test]
async fn an_lp_that_failed_after_the_challenge_is_a_conflict_and_the_challenge_is_spent() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue(&store, STELLAR, &tgt).await;
    let sig = hex::encode(sep53(&key, &msg));
    let err = verify_link(
        &store,
        &lp("Failed", None, None),
        STELLAR,
        &tgt,
        &sig,
        DOMAIN,
        ACCOUNT,
    )
    .await
    .unwrap_err();
    assert!(conflict(err).contains("was refused at KYB"));
    assert!(!store.challenge_present());
    assert!(store.links().is_empty());
}

#[tokio::test]
async fn a_passed_lp_relinks_through_challenge_and_verify() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &g, None);
    let row = lp("Passed", Some("GOLD"), None);
    let msg = issue_for(&store, &row, STELLAR, &tgt, "n-1").await;
    let sig = hex::encode(sep53(&key, &msg));
    verify_link(&store, &row, STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap();
    assert_eq!(store.links(), vec![link_for(STELLAR, &g, &g)]);
}

#[tokio::test]
async fn a_lost_consume_race_is_a_proof_failure_with_no_link_call() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue(&store, STELLAR, &tgt).await;
    store.with(|s| s.consume_finds_nothing = true);
    let sig = hex::encode(sep53(&key, &msg));
    let err = verify_link(&store, &open_lp(), STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert!(is_proof_failed(&err));
    assert!(store.links().is_empty());
}

#[tokio::test]
async fn a_unique_violation_on_the_link_is_a_conflict() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue(&store, STELLAR, &tgt).await;
    store.with(|s| s.link_outcome = LinkOutcome::AddressTaken);
    let sig = hex::encode(sep53(&key, &msg));
    let err = verify_link(&store, &open_lp(), STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert!(conflict(err).contains("is already linked to another LP"));
    assert!(store.links().is_empty());
}

#[tokio::test]
async fn a_guarded_update_that_touches_nothing_is_a_conflict() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue(&store, STELLAR, &tgt).await;
    store.with(|s| s.link_outcome = LinkOutcome::Ineligible);
    let sig = hex::encode(sep53(&key, &msg));
    let err = verify_link(&store, &open_lp(), STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert_eq!(
        conflict(err),
        "LP 42 is no longer eligible to set a Stellar settlement address"
    );
    assert!(store.links().is_empty());
}

// ── verify_link: happy paths ─────────────────────────────────────────────────

#[tokio::test]
async fn a_stellar_account_links_with_its_own_signature() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue(&store, STELLAR, &tgt).await;
    assert!(!msg.contains('\n'));
    let sig = hex::encode(sep53(&key, &msg));
    verify_link(&store, &open_lp(), STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap();
    assert_eq!(store.links(), vec![link_for(STELLAR, &g, &g)]);
    assert!(!store.challenge_present());
}

#[tokio::test]
async fn a_stellar_contract_links_through_a_g_signer_in_base64_and_hex() {
    let key = stellar_key(7);
    let g = g_of(&key);
    for encode in [|b: &[u8]| base64(b), |b: &[u8]| hex::encode(b)] {
        let store = FakeLinkStore::new();
        let tgt = target(ChainKind::Stellar, &contract(), Some(&g));
        let msg = issue(&store, STELLAR, &tgt).await;
        let sig = encode(&sep53(&key, &msg));
        verify_link(&store, &open_lp(), STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
            .await
            .unwrap();
        assert_eq!(store.links(), vec![link_for(STELLAR, &contract(), &g)]);
    }
}

#[tokio::test]
async fn an_evm_address_links_with_the_stored_lowercase_address_and_signer() {
    let store = FakeLinkStore::new();
    let signer = evm_signer("11");
    let address = evm_addr(&signer);
    let checksummed = format!("{}", signer.address());
    let tgt = target(ChainKind::Evm, &checksummed, None);
    let msg = issue(&store, EVM, &tgt).await;
    assert!(!msg.contains('\n'));
    let sig = evm_sig(&signer, &msg);
    verify_link(&store, &open_lp(), EVM, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap();
    assert_eq!(store.links(), vec![link_for(EVM, &address, &address)]);
}

#[tokio::test]
async fn an_evm_address_links_through_a_different_signer() {
    let store = FakeLinkStore::new();
    let owner = evm_addr(&evm_signer("22"));
    let signer = evm_signer("11");
    let signer_addr = evm_addr(&signer);
    let tgt = target(ChainKind::Evm, &owner, Some(&signer_addr));
    let msg = issue(&store, EVM, &tgt).await;
    let sig = format!("0x{}", evm_sig(&signer, &msg));
    verify_link(&store, &open_lp(), EVM, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap();
    assert_eq!(store.links(), vec![link_for(EVM, &owner, &signer_addr)]);
}

#[tokio::test]
async fn a_new_address_after_a_challenge_invalidates_the_previous_one() {
    let store = FakeLinkStore::new();
    let key = stellar_key(7);
    let g = g_of(&key);
    let first = target(ChainKind::Stellar, &g, None);
    let msg = issue(&store, STELLAR, &first).await;
    let sig = hex::encode(sep53(&key, &msg));
    let second = target(ChainKind::Stellar, &contract(), Some(&g));
    issue(&store, STELLAR, &second).await;
    let err = verify_link(&store, &open_lp(), STELLAR, &first, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap_err();
    assert!(is_proof_failed(&err));
}

#[tokio::test]
async fn relink_succeeds_at_every_non_failed_status_for_both_kinds() {
    let new_stellar = stellar_key(7);
    let new_evm = evm_signer("11");
    for status in [
        "NotStarted",
        "InProgress",
        "UnderReview",
        "ChangesRequested",
        "Passed",
    ] {
        for chain in [STELLAR, EVM] {
            let store = FakeLinkStore::new();
            let (row, tgt, address) = match chain.kind {
                ChainKind::Stellar => {
                    let g = g_of(&new_stellar);
                    (
                        lp(status, Some("GOLD"), None),
                        target(chain.kind, &g, None),
                        g,
                    )
                }
                ChainKind::Evm => {
                    let a = evm_addr(&new_evm);
                    (
                        lp(status, None, Some("0xold")),
                        target(chain.kind, &a, None),
                        a,
                    )
                }
            };
            let msg = issue_for(&store, &row, chain, &tgt, "n-1").await;
            let sig = sign(chain, &new_stellar, &new_evm, &msg);
            verify_link(&store, &row, chain, &tgt, &sig, DOMAIN, ACCOUNT)
                .await
                .unwrap_or_else(|e| panic!("{status} {:?}: {e:?}", chain.kind));
            assert_eq!(store.links(), vec![link_for(chain, &address, &address)]);
            assert!(!store.challenge_present());
        }
    }
}

#[tokio::test]
async fn repeated_relinks_each_need_a_fresh_challenge() {
    let a = (stellar_key(7), evm_signer("11"));
    let b = (stellar_key(8), evm_signer("22"));
    for chain in [STELLAR, EVM] {
        let store = FakeLinkStore::new();
        let row = lp("Passed", Some("GOLD"), Some("0xold"));
        let addr = |k: &(SigningKey, PrivateKeySigner)| match chain.kind {
            ChainKind::Stellar => g_of(&k.0),
            ChainKind::Evm => evm_addr(&k.1),
        };
        let order = [&a, &b, &a, &a];
        let mut first_sig = String::new();
        let mut expected = Vec::new();
        for (i, k) in order.iter().enumerate() {
            let address = addr(k);
            let tgt = target(chain.kind, &address, None);
            let msg = issue_for(&store, &row, chain, &tgt, &format!("n-{}", i + 1)).await;
            let sig = sign(chain, &k.0, &k.1, &msg);
            if i == 0 {
                first_sig = sig.clone();
            }
            verify_link(&store, &row, chain, &tgt, &sig, DOMAIN, ACCOUNT)
                .await
                .unwrap();
            expected.push(link_for(chain, &address, &address));
        }
        assert_eq!(store.links(), expected);
        let tgt = target(chain.kind, &addr(&a), None);
        let err = verify_link(&store, &row, chain, &tgt, &first_sig, DOMAIN, ACCOUNT)
            .await
            .unwrap_err();
        assert!(is_proof_failed(&err), "{err:?}");
        assert_eq!(store.links().len(), 4);
    }
}

#[tokio::test]
async fn re_verifying_the_current_address_and_signer_is_allowed() {
    let store = FakeLinkStore::new();
    store.with(|s| s.holder = Some(LP_ID));
    let key = stellar_key(7);
    let g = g_of(&key);
    let row = lp("Passed", Some(&g), None);
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue_for(&store, &row, STELLAR, &tgt, "n-1").await;
    let sig = hex::encode(sep53(&key, &msg));
    verify_link(&store, &row, STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap();
    assert_eq!(store.links().len(), 1);
}

#[tokio::test]
async fn a_passed_lp_proves_its_legacy_unsigned_address_by_relinking_it() {
    let store = FakeLinkStore::new();
    store.with(|s| s.holder = Some(LP_ID));
    let key = stellar_key(7);
    let g = g_of(&key);
    let row = lp("Passed", Some(&g), None);
    assert!(row.stellar_signer_address.is_none());
    let tgt = target(ChainKind::Stellar, &g, None);
    let msg = issue_for(&store, &row, STELLAR, &tgt, "n-1").await;
    let sig = hex::encode(sep53(&key, &msg));
    verify_link(&store, &row, STELLAR, &tgt, &sig, DOMAIN, ACCOUNT)
        .await
        .unwrap();
    assert_eq!(store.links(), vec![link_for(STELLAR, &g, &g)]);
}

// ── OpenAPI document ─────────────────────────────────────────────────────────

fn openapi_json() -> serde_json::Value {
    serde_json::to_value(<LpSettlementAddressDoc as utoipa::OpenApi>::openapi())
        .expect("a serializable document")
}

fn param<'a>(op: &'a serde_json::Value, name: &str) -> &'a serde_json::Value {
    op["parameters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == name)
        .unwrap_or_else(|| panic!("missing param {name}"))
}

#[test]
fn the_challenge_is_a_get_with_required_chain_and_address_and_optional_signer() {
    let doc = openapi_json();
    let op = &doc["paths"]["/v1/lps/me/link-address/challenge"]["get"];
    assert!(op.is_object());
    assert_eq!(param(op, "chain_id")["required"], true);
    assert_eq!(param(op, "address")["required"], true);
    assert_ne!(param(op, "signer_address")["required"], true);
    let responses = op["responses"].as_object().unwrap();
    for status in ["200", "400", "401", "404", "409"] {
        assert!(responses.contains_key(status), "missing {status}");
    }
    let schema = op["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
        .as_str()
        .unwrap();
    assert!(schema.ends_with("/ChallengeResponse"));
    let ok = op["responses"]["200"]["description"].as_str().unwrap();
    assert!(ok.contains("1 hour"));
    assert!(ok.contains("exactly as returned"));
    assert_no_fixed_wording(op);
}

fn assert_no_fixed_wording(op: &serde_json::Value) {
    let conflict = op["responses"]["409"]["description"].as_str().unwrap();
    assert!(!conflict.contains("fixed"), "{conflict}");
    assert!(conflict.contains("refused at KYB"));
}

#[test]
fn the_verify_is_a_post_with_a_required_proof_body_and_a_422() {
    let doc = openapi_json();
    let op = &doc["paths"]["/v1/lps/me/link-address/verify"]["post"];
    assert!(op.is_object());
    let responses = op["responses"].as_object().unwrap();
    for status in ["200", "400", "401", "404", "409", "422"] {
        assert!(responses.contains_key(status), "missing {status}");
    }
    let ok = op["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
        .as_str()
        .unwrap();
    assert!(ok.ends_with("/LpResponse"));
    let unauthorized = op["responses"]["401"]["description"].as_str().unwrap();
    assert_eq!(unauthorized, "Missing, invalid, or expired token");
    let unprocessable = op["responses"]["422"]["description"].as_str().unwrap();
    assert!(unprocessable.contains("bad signature"));
    assert!(unprocessable.contains("consumed challenge"));

    let body = &doc["components"]["schemas"]["LinkVerifyRequest"];
    let required: Vec<&str> = body["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    for field in ["chain_id", "address", "signature"] {
        assert!(required.contains(&field), "{field} must be required");
    }
    assert!(!required.contains(&"signer_address"));
    assert_no_fixed_wording(op);
}

// ── Router ───────────────────────────────────────────────────────────────────

fn test_state() -> AppState {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/test").unwrap();

    AppState {
        pool: pool.clone(),
        kyc_repo: KycRepo::new(pool.clone()),
        position_repo: PositionRepo::new(pool.clone()),
        contract_logs_repo: ContractLogsRepo::new(pool.clone()),
        default_chain_id: 1,
        chains: vec![EVM],
        sumsub_client: None,
        sumsub_settings: None,
        voucher_signers: HashMap::new(),
        dm_domains: HashMap::new(),
        wq_domains: HashMap::new(),
        stellar_voucher_signers: HashMap::new(),
        transfer_addresses: HashMap::new(),
        withdrawal_queue_wallets: HashMap::new(),
        asset_decimals: HashMap::new(),
        loan_registry_addresses: HashMap::new(),
        minter_addresses: HashMap::new(),
        capital_allocation_from_minter: std::collections::HashSet::new(),
        withdrawal_queue_addresses: HashMap::new(),
        pocket_addresses: HashMap::new(),
        security_registry_addresses: HashMap::new(),
        plusd_addresses: HashMap::new(),
        security_marks: shared::security_marks::MarkSettings::default(),
        crystal_enabled: false,
        elliptic_enabled: false,
        auth_user_repo: shared::auth_user_repo::AuthUserRepo::new(pool.clone()),
        submitted_loan_repo: shared::submitted_loan_repo::SubmittedLoanRepo::new(pool.clone()),
        loan_metadata_fetcher: std::sync::Arc::new(
            shared::loan_metadata::HttpLoanMetadataFetcher::new(
                shared::metadata_fetcher::MetadataFetcher::new(
                    reqwest::Client::new(),
                    "https://ipfs.io/ipfs/".to_owned(),
                ),
            ),
        ),
        loan_fee_schedule_repo: shared::loan_fee_schedule_repo::LoanFeeScheduleRepo::new(
            pool.clone(),
        ),
        loan_asset_price_repo: shared::loan_asset_price_repo::LoanAssetPriceRepo::new(pool.clone()),
        collateral_valuation_repo: shared::collateral_valuation_repo::CollateralValuationRepo::new(
            pool.clone(),
        ),
        loan_disbursement_repo: shared::loan_disbursement_repo::LoanDisbursementRepo::new(
            pool.clone(),
        ),
        jwt_keys: None,
        loan_capital_transfers_repo:
            shared::loan_capital_transfers_repo::LoanCapitalTransfersRepo::new(pool.clone()),
        lp_repo: shared::lp_repo::LpRepo::new(pool.clone()),
        lp_ledger_repo: shared::lp_ledger_repo::LpLedgerRepo::new(pool.clone()),
        lp_bank_deposit_repo: shared::lp_bank_deposit_repo::LpBankDepositRepo::new(pool.clone()),
        system_configuration_repo: shared::system_configuration_repo::SystemConfigurationRepo::new(
            pool.clone(),
        ),
        lp_requested_bank_details_repo:
            shared::lp_requested_bank_details_repo::LpRequestedBankDetailsRepo::new(pool.clone()),
        kyb_document_repo: shared::kyb_document_repo::KybDocumentRepo::new(pool.clone()),
        object_store: shared::object_store::ObjectStore::new(
            "test-key",
            "test-secret",
            "https://test.digitaloceanspaces.com",
            "test",
            "test-bucket",
        ),
        kyb_limits: KybLimits {
            max_document_bytes: pipeline_api::config::DEFAULT_KYB_MAX_DOCUMENT_BYTES,
            max_files_per_request: pipeline_api::config::DEFAULT_KYB_MAX_FILES_PER_REQUEST,
            max_documents_per_lp: pipeline_api::config::DEFAULT_KYB_MAX_DOCUMENTS_PER_LP,
        },
        account_repo: shared::account_repo::AccountRepo::new(pool.clone()),
        otp_repo: shared::otp_repo::OtpRepo::new(pool.clone()),
        captcha: Box::new(pipeline_api::captcha::DisabledCaptcha),
        email_sender: std::sync::Arc::new(shared::email::LoggingEmailSender),
        login_attempt_repo: shared::login_attempt_repo::LoginAttemptRepo::new(pool),
        password_reset: pipeline_api::password_reset::PasswordResetConfig {
            app_base_url: pipeline_api::password_reset::DEV_APP_BASE_URL.to_owned(),
            ttl_minutes: pipeline_api::password_reset::DEFAULT_PASSWORD_RESET_TTL_MINUTES,
        },
    }
}

async fn status_of(method: Method, uri: &str) -> StatusCode {
    let limits = KybLimits {
        max_document_bytes: pipeline_api::config::DEFAULT_KYB_MAX_DOCUMENT_BYTES,
        max_files_per_request: pipeline_api::config::DEFAULT_KYB_MAX_FILES_PER_REQUEST,
        max_documents_per_lp: pipeline_api::config::DEFAULT_KYB_MAX_DOCUMENTS_PER_LP,
    };
    let app = axum::Router::new()
        .merge(lps::router(limits))
        .merge(lp_settlement_address::router())
        .with_state(Arc::new(test_state()));
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .body(Body::empty())
        .unwrap();
    app.oneshot(req).await.unwrap().status()
}

#[tokio::test]
async fn the_unsigned_link_path_answers_404() {
    assert_eq!(
        status_of(Method::POST, "/lps/me/link-address").await,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn the_new_endpoints_are_gated_by_the_token_before_anything_else() {
    assert_eq!(
        status_of(Method::GET, "/lps/me/link-address/challenge").await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        status_of(Method::POST, "/lps/me/link-address/verify").await,
        StatusCode::UNAUTHORIZED
    );
}
