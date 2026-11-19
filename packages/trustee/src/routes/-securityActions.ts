// spec: docs/frontend/trustee-flows.md#security-marks-1859
import type { UseLoanSecurityResult } from "@/api/useLoanSecurity";
import {
  ABOVE_RATIO_NO_CALL_NOTE,
  CURABLE_NOTE,
  buildSecurityCard,
  formatUnixDate,
} from "./-loanSecurity";

export const NO_CONSENTS_TEXT = "No extension consents are recorded.";

export interface ExtensionConsentRow {
  key: string;
  position: string;
  newMaturity: string;
  consentHash: string;
  recordedAt: string;
}

export interface SecurityActionsView {
  state: "hidden" | "ready";
  consents: ExtensionConsentRow[];
  notes: string[];
}

function served(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "—";
}

export function buildSecurityActions(
  result: UseLoanSecurityResult,
): SecurityActionsView {
  if (buildSecurityCard(result).state !== "ready") {
    return { state: "hidden", consents: [], notes: [] };
  }
  const sec = result.data;
  const notes: string[] = [];
  if (sec?.margin_call?.open_call_curable === true) {
    notes.push(CURABLE_NOTE);
  }
  if (sec?.margin_call?.ltv_above_ratio_no_onchain_call === true) {
    notes.push(ABOVE_RATIO_NO_CALL_NOTE);
  }
  const consents = Array.isArray(sec?.extension_consents)
    ? sec.extension_consents
    : [];
  return {
    state: "ready",
    notes,
    consents: consents.map((consent, index) => ({
      key: `${consent?.position ?? "p"}-${index}`,
      position:
        typeof consent?.position === "number" ? `#${consent.position}` : "—",
      newMaturity: formatUnixDate(consent?.new_maturity),
      consentHash: served(consent?.consent_hash),
      recordedAt: formatUnixDate(consent?.at),
    })),
  };
}
