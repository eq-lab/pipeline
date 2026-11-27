// Characterization of the voucher KYT gate (#2257): the 403 fires for failed or unscreened rows.
// spec: docs/design-docs/multi-chain-kyc-sharding.md#v1requests-status-per-chain-kind
use pipeline_api::routes::vouchers::kyt_blocks_voucher;
use shared::kyc_repo::feed_status;

#[test]
fn gate_on_blocks_every_kyt_status_except_clear_and_gate_off_blocks_nothing() {
    for kyt in [None, Some(0), Some(1), Some(2), Some(3)] {
        assert_eq!(kyt_blocks_voucher(true, kyt), kyt != Some(1), "{kyt:?}");
        assert!(!kyt_blocks_voucher(false, kyt), "{kyt:?}");
    }
}

#[test]
fn feed_pending_claim_matches_an_unblocked_voucher_on_an_allowed_profile() {
    for gate in [false, true] {
        for kyt in [None, Some(1), Some(2)] {
            for allowed in [false, true] {
                let claimable =
                    feed_status("DepositRequested", false, allowed, kyt, gate) == "PendingClaim";
                assert_eq!(
                    claimable,
                    allowed && !kyt_blocks_voucher(gate, kyt),
                    "{gate} {kyt:?} {allowed}"
                );
            }
        }
    }
}
