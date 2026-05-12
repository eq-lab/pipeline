/// Phase 1: Sumsub KYC/KYB/AML status checks.
///
/// Currently a placeholder — Sumsub statuses are written by the webhook handler
/// in the API service, not by the relayer. This phase exists as the logical home
/// for any future Sumsub polling or re-verification logic.
pub async fn phase_check_sumsub() {
    // No-op: Sumsub webhook sets sumsub_kyc_status, sumsub_review_status, sumsub_aml_status
    // directly on lp_profiles. Future work may add active polling here.
}
