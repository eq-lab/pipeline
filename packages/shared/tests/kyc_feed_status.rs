// spec: docs/design-docs/multi-chain-kyc-sharding.md#v1requests-status-per-chain-kind
use shared::chains::ChainKind;
use shared::kyc_repo::{feed_status, kyt_gate_for_kind};

fn voucher_allows(gate: bool, kyt: Option<i16>) -> bool {
    !gate || kyt == Some(1)
}

#[test]
fn feed_matches_voucher_for_every_flag_kind_and_kyt_combination() {
    for crystal in [false, true] {
        for elliptic in [false, true] {
            for kind in [ChainKind::Evm, ChainKind::Stellar] {
                let gate = kyt_gate_for_kind(kind, crystal, elliptic);
                let expected_gate = match kind {
                    ChainKind::Evm => crystal,
                    ChainKind::Stellar => elliptic,
                };
                assert_eq!(gate, expected_gate);
                for kyt in [None, Some(1), Some(2), Some(0)] {
                    for allowed in [true, false] {
                        for event in ["DepositRequested", "WithdrawalRequested"] {
                            let claimed = feed_status(event, true, allowed, kyt, gate);
                            assert_eq!(claimed, "Completed");
                            let s = feed_status(event, false, allowed, kyt, gate);
                            let claimable = s == "PendingClaim";
                            assert_eq!(claimable, allowed && voucher_allows(gate, kyt));
                            if gate && kyt.is_some_and(|k| k != 1) {
                                assert_eq!(s, "VerificationFailed");
                            }
                            if !gate {
                                assert_ne!(s, "VerificationFailed");
                            }
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn stellar_row_ignores_crystal_and_evm_row_ignores_elliptic() {
    let stellar = kyt_gate_for_kind(ChainKind::Stellar, true, false);
    assert_eq!(
        feed_status("DepositRequested", false, true, None, stellar),
        "PendingClaim"
    );
    let evm = kyt_gate_for_kind(ChainKind::Evm, false, true);
    assert_eq!(
        feed_status("DepositRequested", false, true, None, evm),
        "PendingClaim"
    );
    let stellar_gated = kyt_gate_for_kind(ChainKind::Stellar, false, true);
    assert_eq!(
        feed_status("DepositRequested", false, true, None, stellar_gated),
        "PendingVerification"
    );
}

#[test]
fn staking_rows_are_always_completed() {
    for event in ["StakingDeposit", "StakingWithdrawal"] {
        assert_eq!(feed_status(event, false, false, None, true), "Completed");
    }
}
