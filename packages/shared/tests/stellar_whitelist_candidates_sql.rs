// spec: docs/design-docs/multi-chain-kyc-sharding.md#stellar-relayer-whitelist
use shared::kyc_repo::{
    stellar_allow_candidates_sql, stellar_disallow_candidates_sql,
    POPULATE_PROFILES_FROM_LINKED_STELLAR_SQL,
};

fn flat(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

const COMBOS: [(bool, bool); 4] = [(false, false), (true, false), (false, true), (true, true)];
const LINKED_BRANCH: &str = "OR EXISTS ( SELECT 1 FROM lps l";

#[test]
fn linked_branch_is_always_or_ed_with_the_deposit_branch() {
    for (sumsub, elliptic) in COMBOS {
        let sql = flat(&stellar_allow_candidates_sql(sumsub, elliptic));
        assert!(sql.contains(LINKED_BRANCH), "{sql}");
        assert!(
            sql.contains("l.stellar_address = p.wallet_address"),
            "{sql}"
        );
        assert!(sql.contains("l.kyb_status = 'Passed'"), "{sql}");
        assert!(sql.contains("l.address_linked_at IS NOT NULL"), "{sql}");
        assert!(sql.contains("c.event_name = 'DepositRequested'"), "{sql}");
        assert!(sql.contains("p.chain_id = $1"), "{sql}");
        assert!(sql.contains("p.on_chain_allowed = FALSE"), "{sql}");
        assert!(!sql.contains("LOWER("), "{sql}");
    }
}

#[test]
fn elliptic_gates_the_profile_and_the_deposit_log() {
    for sumsub in [false, true] {
        let on = flat(&stellar_allow_candidates_sql(sumsub, true));
        let or_at = on.find(LINKED_BRANCH).unwrap();
        let profile_kyt = on.find("p.kyt_status = 1").expect("profile kyt");
        let and_group = on.find("AND ( (EXISTS").expect("and group");
        assert!(profile_kyt < and_group, "{on}");
        assert!(on.find("c.kyt_status = 1").unwrap() < or_at, "{on}");

        let off = flat(&stellar_allow_candidates_sql(sumsub, false));
        assert!(!off.contains("kyt_status"), "{off}");
    }
}

#[test]
fn sumsub_applies_to_the_deposit_branch_only() {
    for elliptic in [false, true] {
        let on = flat(&stellar_allow_candidates_sql(true, elliptic));
        let or_at = on.find(LINKED_BRANCH).unwrap();
        let (before, after) = on.split_at(or_at);
        for needle in [
            "p.sumsub_kyc_status = 2",
            "p.sumsub_review_status = 2",
            "p.sumsub_aml_status = 2",
        ] {
            assert!(before.contains(needle), "{needle} missing before OR: {on}");
            assert!(!after.contains(needle), "{needle} leaked after OR: {on}");
        }

        let off = flat(&stellar_allow_candidates_sql(false, elliptic));
        assert!(!off.contains("sumsub"), "{off}");
    }
}

#[test]
fn disallow_takes_every_kyt_failed_profile_only_when_elliptic_is_on() {
    for sumsub in [false, true] {
        let on = flat(&stellar_disallow_candidates_sql(sumsub, true));
        assert!(
            on.contains("AND (p.kyt_status = 2 OR (p.on_chain_allowed = TRUE"),
            "{on}"
        );
        let off = flat(&stellar_disallow_candidates_sql(sumsub, false));
        assert!(
            off.contains("AND (FALSE OR (p.on_chain_allowed = TRUE"),
            "{off}"
        );
    }
}

#[test]
fn disallow_takes_a_relinked_away_address_unless_the_allow_depositor_branch_still_covers_it() {
    for (sumsub, elliptic) in COMBOS {
        let sql = flat(&stellar_disallow_candidates_sql(sumsub, elliptic));
        for needle in [
            "p.chain_id = $1",
            "h.chain_kind = 'stellar' AND h.address = p.wallet_address AND (h.chain_id IS NULL OR h.chain_id = $1)",
            "AND NOT EXISTS (SELECT 1 FROM lps l WHERE l.stellar_address = p.wallet_address)",
        ] {
            assert!(sql.contains(needle), "missing `{needle}` in: {sql}");
        }
        let allow = flat(&stellar_allow_candidates_sql(sumsub, elliptic));
        let depositor = &allow[allow.find("(EXISTS").unwrap()..allow.find(LINKED_BRANCH).unwrap()];
        assert!(
            sql.ends_with(&format!("AND NOT {}))", depositor.trim_end())),
            "{sql}"
        );
    }
}

#[test]
fn populate_seeds_passed_lps_linked_address() {
    let sql = flat(POPULATE_PROFILES_FROM_LINKED_STELLAR_SQL);
    for needle in [
        "INSERT INTO lp_profiles (chain_id, wallet_address)",
        "SELECT $1, l.stellar_address FROM lps l",
        "l.kyb_status = 'Passed'",
        "l.stellar_address IS NOT NULL",
        "l.address_linked_at IS NOT NULL",
        "ON CONFLICT (chain_id, wallet_address) DO NOTHING",
    ] {
        assert!(sql.contains(needle), "missing `{needle}` in: {sql}");
    }
}
