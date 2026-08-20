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

use pipeline_worker::indexer::mappers::{
    carry_over_transfer, is_position_event_name, is_staking_event_name,
};

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
