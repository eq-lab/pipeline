/// Unit tests for carry-over-basis position math on sPLUSD share transfers.
///
/// Pure math only — `carry_over_transfer` takes the two prior positions as
/// arguments, so no DB is involved. The SQL that supplies those positions lives
/// in `fetch_prev_position` / the `position_events` view.
///
/// Carry-over basis: a transfer is not an economic disposal, so no PnL is
/// realized and the cost basis travels with the shares. The invariant these
/// tests protect is that protocol-wide cost (shares × basis, summed over
/// holders) is unchanged by a transfer.
use bigdecimal::BigDecimal;
use std::str::FromStr;

use alloy::primitives::{address, Address, U256};
use pipeline_worker::indexer::{
    mappers::{
        apply_position_delta, carry_over_transfer, is_position_event_name, is_staking_event_name,
        transfer_sides, write_transfer_position,
    },
    parsers::parse_share_transfer,
};
use serde_json::json;
use std::collections::HashMap;

mod deal_token_support;
use deal_token_support::{make_log, SPLUSD};

fn bd(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).expect("valid decimal")
}

/// Total cost across both holders — the quantity a transfer must conserve.
fn total_cost(
    shares_a: &BigDecimal,
    price_a: &BigDecimal,
    shares_b: &BigDecimal,
    price_b: &BigDecimal,
) -> BigDecimal {
    shares_a * price_a + shares_b * price_b
}

// ── event-name gating ────────────────────────────────────────────────────────

#[test]
fn share_transfer_is_a_position_event_but_not_a_staking_event() {
    // The distinction matters: `is_staking_event_name` still gates the
    // single-`owner` params shape, while `is_position_event_name` gates running
    // balance computation.
    assert!(is_position_event_name("ShareTransfer"));
    assert!(!is_staking_event_name("ShareTransfer"));

    for name in ["StakingDeposit", "StakingWithdrawal"] {
        assert!(is_staking_event_name(name));
        assert!(is_position_event_name(name));
    }

    for name in ["AssetTransfer", "YieldMinted", "DepositRequested"] {
        assert!(!is_position_event_name(name));
    }
}

// ── carry_over_transfer ──────────────────────────────────────────────────────

#[test]
fn receiver_with_no_prior_position_inherits_sender_basis_exactly() {
    let next = carry_over_transfer(
        (bd("100"), bd("1.5")), // sender: 100 shares at 1.5
        (bd("0"), bd("0")),     // receiver: nothing
        &bd("40"),
        false,
    );

    assert_eq!(next.shares_from, bd("60"));
    assert_eq!(next.avg_price_from, bd("1.5"), "sender basis is unchanged");
    assert_eq!(next.shares_to, bd("40"));
    assert_eq!(
        next.avg_price_to,
        bd("1.5"),
        "a fresh receiver takes the sender's basis verbatim"
    );
}

#[test]
fn receiver_with_existing_position_gets_weighted_basis() {
    // Receiver holds 60 @ 2.0 (cost 120), receives 40 @ 1.0 (cost 40).
    // New basis = 160 / 100 = 1.6.
    let next = carry_over_transfer(
        (bd("40"), bd("1.0")),
        (bd("60"), bd("2.0")),
        &bd("40"),
        false,
    );

    assert_eq!(next.shares_to, bd("100"));
    assert_eq!(next.avg_price_to, bd("1.6"));
    assert_eq!(next.shares_from, bd("0"));
    assert_eq!(next.avg_price_from, bd("1.0"));
}

#[test]
fn transfer_conserves_total_cost() {
    let (prev_from, prev_to) = ((bd("100"), bd("1.25")), (bd("30"), bd("3.5")));
    let before = total_cost(&prev_from.0, &prev_from.1, &prev_to.0, &prev_to.1);

    let next = carry_over_transfer(prev_from, prev_to, &bd("55"), false);
    let after = total_cost(
        &next.shares_from,
        &next.avg_price_from,
        &next.shares_to,
        &next.avg_price_to,
    );

    // The whole point of carry-over basis: no gain or loss is created by moving
    // shares between holders.
    //
    // Conservation is exact in the reals but not in BigDecimal: the receiver's
    // weighted basis is a division (160/85 here) that doesn't terminate, so it
    // truncates. The residual is ~1e-97 on a cost of 230 — far below the
    // 18-decimal precision `avg_buy_share_price` was ever stored at. This is
    // inherent to tracking an average price rather than a running total cost,
    // and the pre-existing staking path divides the same way.
    let residual = (&before - &after).abs();
    assert!(
        residual < bd("1e-50"),
        "total cost basis must be conserved to well beyond stored precision: \
         before={before}, after={after}, residual={residual}"
    );
}

#[test]
fn full_balance_transfer_empties_sender() {
    let next = carry_over_transfer((bd("75"), bd("2.0")), (bd("0"), bd("0")), &bd("75"), false);

    assert_eq!(next.shares_from, bd("0"));
    assert_eq!(next.shares_to, bd("75"));
    assert_eq!(next.avg_price_to, bd("2.0"));
}

#[test]
fn self_transfer_leaves_position_unchanged() {
    // from == to: both sides are the same holder, so the balance must not move.
    // Computing the arms independently against the same prior balance would
    // otherwise yield a contradictory -amount / +amount pair.
    let next = carry_over_transfer(
        (bd("100"), bd("1.5")),
        (bd("100"), bd("1.5")),
        &bd("40"),
        true,
    );

    assert_eq!(next.shares_from, bd("100"));
    assert_eq!(next.shares_to, bd("100"));
    assert_eq!(next.avg_price_from, bd("1.5"));
    assert_eq!(next.avg_price_to, bd("1.5"));
}

#[test]
fn oversized_transfer_clamps_sender_to_zero() {
    // Indicates incomplete indexed history (missed event, or a transfer
    // predating the indexed start block). Clamp rather than go negative; the
    // caller logs a warning.
    let next = carry_over_transfer((bd("10"), bd("1.0")), (bd("0"), bd("0")), &bd("25"), false);

    assert_eq!(next.shares_from, bd("0"), "never negative");
    assert_eq!(next.shares_to, bd("25"), "receiver still credited in full");
}

#[test]
fn sender_with_zero_basis_does_not_corrupt_receiver_basis() {
    // A holder whose basis is unknown (0) passes that on rather than inventing
    // a price. Receiver: 50 @ 2.0 (cost 100) + 50 @ 0 = 100 / 100 = 1.0.
    let next = carry_over_transfer((bd("50"), bd("0")), (bd("50"), bd("2.0")), &bd("50"), false);

    assert_eq!(next.shares_to, bd("100"));
    assert_eq!(next.avg_price_to, bd("1.0"));
}

#[test]
fn fractional_share_price_keeps_precision() {
    // 7-decimal SAC scale: shares are large integers, price is fractional.
    let next = carry_over_transfer(
        (bd("10000000"), bd("1.0500000")),
        (bd("5000000"), bd("1.1000000")),
        &bd("2500000"),
        false,
    );

    assert_eq!(next.shares_from, bd("7500000"));
    assert_eq!(next.shares_to, bd("7500000"));
    // (5000000·1.1 + 2500000·1.05) / 7500000 = 8125000 / 7500000 = 1.0833…
    let expected = (bd("5000000") * bd("1.1") + bd("2500000") * bd("1.05")) / bd("7500000");
    assert_eq!(next.avg_price_to, expected);
}

#[test]
fn shares_burned_withdrawal_reduces_the_treasury_balance_and_realizes_pnl() {
    let (shares, avg, pnl) =
        apply_position_delta(false, &bd("1000"), &bd("1.05"), &bd("700"), &bd("750"));
    assert_eq!(shares, bd("300"));
    assert_eq!(avg, bd("1.05"));
    assert_eq!(pnl, bd("15"));
}

#[test]
fn stake_updates_the_weighted_average_without_realizing_pnl() {
    let (shares, avg, pnl) =
        apply_position_delta(true, &bd("100"), &bd("1"), &bd("100"), &bd("120"));
    assert_eq!(shares, bd("200"));
    assert_eq!(avg, bd("1.1"));
    assert_eq!(pnl, bd("0"));
}

// ── EVM end-to-end replay (issue #1593) ──────────────────────────────────────

const EVM_ALICE: Address = address!("a11ce00000000000000000000000000000000001");
const EVM_BOB: Address = address!("b0b0000000000000000000000000000000000002");

type Ledger = HashMap<String, (BigDecimal, BigDecimal)>;

fn evm_transfer_params(from: Address, to: Address, amount: u64) -> serde_json::Value {
    alloy::sol! {
        event Transfer(address indexed from, address indexed to, uint256 value);
    }
    use alloy::sol_types::SolEvent;
    let ev = Transfer {
        from,
        to,
        value: U256::from(amount),
    };
    let log = make_log(SPLUSD, ev.encode_log_data(), 1, 0);
    parse_share_transfer(&log, &[SPLUSD])
        .expect("decodes")
        .params
}

fn replay_transfer(
    ledger: &mut Ledger,
    from: Address,
    to: Address,
    amount: u64,
) -> serde_json::Value {
    let mut params = evm_transfer_params(from, to, amount);
    let (f, t, amt) = transfer_sides(&params).expect("sides");
    assert_eq!(f, from.to_checksum(None).to_lowercase());
    assert_eq!(t, to.to_checksum(None).to_lowercase());
    let zero = (bd("0"), bd("0"));
    let prev_from = ledger.get(&f).cloned().unwrap_or_else(|| zero.clone());
    let prev_to = ledger.get(&t).cloned().unwrap_or(zero);
    let next = carry_over_transfer(prev_from, prev_to, &amt, f == t);
    write_transfer_position(&mut params, &next);
    ledger.insert(f, (next.shares_from.clone(), next.avg_price_from.clone()));
    ledger.insert(t, (next.shares_to.clone(), next.avg_price_to.clone()));
    params
}

fn alice_with_400_shares() -> Ledger {
    let key = EVM_ALICE.to_checksum(None).to_lowercase();
    let (shares, avg, _) = apply_position_delta(true, &bd("0"), &bd("0"), &bd("400"), &bd("400"));
    HashMap::from([(key, (shares, avg))])
}

#[test]
fn evm_transfer_before_redeem_realizes_only_the_real_gain() {
    let mut ledger = alice_with_400_shares();
    let params = replay_transfer(&mut ledger, EVM_ALICE, EVM_BOB, 400);

    assert_eq!(params["shares_balance_from"], "0");
    assert_eq!(params["shares_balance_to"], "400");
    assert_eq!(
        bd(params["avg_buy_share_price_to"].as_str().unwrap()),
        bd("1")
    );
    assert_eq!(params["realized_pnl"], "0");

    let (bob_shares, bob_avg) = ledger[&EVM_BOB.to_checksum(None).to_lowercase()].clone();
    let (shares, _, pnl) =
        apply_position_delta(false, &bob_shares, &bob_avg, &bd("400"), &bd("420"));
    assert_eq!(shares, bd("0"));
    assert_eq!(pnl, bd("20"));
}

#[test]
fn without_the_transfer_the_redeem_books_the_whole_payout_as_gain() {
    let (_, _, pnl) = apply_position_delta(false, &bd("0"), &bd("0"), &bd("400"), &bd("420"));
    assert_eq!(pnl, bd("420"));
}

#[test]
fn evm_partial_transfer_conserves_cost() {
    let mut ledger = alice_with_400_shares();
    replay_transfer(&mut ledger, EVM_ALICE, EVM_BOB, 100);

    let (a_shares, a_avg) = ledger[&EVM_ALICE.to_checksum(None).to_lowercase()].clone();
    let (b_shares, b_avg) = ledger[&EVM_BOB.to_checksum(None).to_lowercase()].clone();
    assert_eq!(a_shares, bd("300"));
    assert_eq!(a_avg, bd("1"));
    assert_eq!(b_shares, bd("100"));
    assert_eq!(b_avg, bd("1"));
    assert_eq!(total_cost(&a_shares, &a_avg, &b_shares, &b_avg), bd("400"));
}

#[test]
fn transfer_sides_rejects_zero_amount_and_missing_sides() {
    assert!(transfer_sides(&json!({"from": "A", "to": "B", "amount": "0"})).is_none());
    assert!(transfer_sides(&json!({"to": "B", "amount": "5"})).is_none());
    assert!(transfer_sides(&json!({"from": "A", "amount": "5"})).is_none());
    let (f, t, a) = transfer_sides(&json!({"from": "AbC", "to": "dEf", "amount": "5"})).unwrap();
    assert_eq!((f.as_str(), t.as_str(), a), ("abc", "def", bd("5")));
}
