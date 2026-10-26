// spec: docs/product-specs/loans.md#economics-epochs-rate-and-maturity-over-the-loans-life
use shared::contract_logs_repo::EconomicsEventRow;
use shared::loan_economics::{build_epochs, economics_rate_to_bps};

fn event(name: &str, new_rate: i64, new_maturity: i64) -> EconomicsEventRow {
    EconomicsEventRow {
        event_name: name.to_owned(),
        new_rate,
        new_maturity_timestamp: new_maturity,
        block_timestamp: 0,
    }
}

#[test]
fn rollover_opens_a_new_epoch_at_the_prior_maturity() {
    let epochs = build_epochs(100, 200, 1_200, &[event("LoanRolledOver", 240_000, 300)]);
    assert_eq!(epochs.len(), 2);
    assert_eq!(
        (epochs[1].start, epochs[1].maturity, epochs[1].rate_bps),
        (200, 300, 2_400)
    );
}

#[test]
fn amendment_rewrites_the_current_epoch_in_place() {
    let epochs = build_epochs(100, 200, 1_200, &[event("EconomicsAmended", 150_000, 250)]);
    assert_eq!(epochs.len(), 1);
    assert_eq!((epochs[0].maturity, epochs[0].rate_bps), (250, 1_500));
}

#[test]
fn rate_conversion_floors_ppm_to_bps() {
    assert_eq!(economics_rate_to_bps(112_550), 1_125);
}
