// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import type { SecurityPaymentTerm } from "@pipeline/wallet-connect";
import type { LoanSecurityTerms } from "@/api/useLoanSecurity";
import {
  bpsToPercentText,
  defaultRateToPercentText,
  formatServedDuration,
} from "@/utils/securityTermsUnits";
import type { LabelValue } from "./-risk-council-shared";

export const PAYMENT_TERM_LABELS: Record<SecurityPaymentTerm, string> = {
  Lc: "Letter of credit (Lc)",
  Dp: "Documents against payment (Dp)",
  Da: "Documents against acceptance (Da)",
  OpenAccount: "Open account",
};

export function formatTermsRows(
  terms: LoanSecurityTerms | null | undefined,
): LabelValue[] {
  if (terms == null) return [];
  const bps = (value: number | undefined) =>
    value == null ? "—" : `${bpsToPercentText(value)}%`;
  return [
    { label: "Advance ratio", value: bps(terms.advance_ratio_bps) },
    { label: "Margin call ratio", value: bps(terms.margin_call_ratio_bps) },
    { label: "Cure period", value: formatServedDuration(terms.cure_period) },
    {
      label: "Price stale after",
      value: formatServedDuration(terms.price_stale_after),
    },
    { label: "Payment term", value: terms.payment_term ?? "—" },
    { label: "Grace period", value: formatServedDuration(terms.grace_period) },
    {
      label: "Default rate",
      value:
        terms.default_rate == null
          ? "—"
          : `${defaultRateToPercentText(terms.default_rate)}%`,
    },
    {
      label: "Attestation interval",
      value: formatServedDuration(terms.attestation_interval),
    },
    {
      label: "Inspection interval",
      value: formatServedDuration(terms.inspection_interval),
    },
    { label: "Quantity tolerance", value: bps(terms.tolerance_bps) },
    { label: "Grade tolerance", value: bps(terms.grade_tolerance_bps) },
  ];
}
