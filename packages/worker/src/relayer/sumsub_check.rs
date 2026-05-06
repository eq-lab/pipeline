/// Phase 1: Sumsub KYC/KYB/AML status checks.
///
/// Currently a placeholder — Sumsub statuses are written by the webhook handler
/// in the API service, not by the relayer. This phase exists as the logical home
/// for any future Sumsub polling or re-verification logic.
pub async fn phase_check_sumsub() {
    // No-op: Sumsub webhook sets kyc_status, kyc_review_status, aml_status
    // directly on lp_profiles. Future work may add active polling here.
}
