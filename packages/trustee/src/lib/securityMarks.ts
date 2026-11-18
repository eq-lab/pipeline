// spec: docs/frontend/trustee-flows.md#security-marks-1859
import { isSecurityBenchmark, type CanCall } from "@pipeline/wallet-connect";
import { amErrorCode } from "./accessManagerAction";
import { valueDateSeconds } from "./wireOut";
import { toUserError, type UserFacingError } from "@/utils/userError";

export const REVALUE_NO_ROLE =
  "This wallet is not allowed to set a price mark.";
export const CONSENT_NO_ROLE =
  "This wallet is not allowed to record an extension consent.";
export const CHECK_COVERAGE_CONNECT_WALLET =
  "Connect a Stellar wallet to check coverage.";
export const CHECK_COVERAGE_HELP =
  "Asks the registry to re-evaluate this loan's coverage and open or cure a margin call. Any connected wallet can run it.";
export const CONSENT_HELP =
  "Records the buyers' consent to a maturity extension on-chain. The extension itself is a separate Risk Council action.";
export const EVIDENCE_HELP =
  "The suggested price no longer applies. Describe the source of your price (report, quote, reference); its sha256 is sent on-chain.";

const SUGGESTION_STATUS_LABELS: Record<string, string> = {
  unmapped: "No price source is configured for this commodity",
  unsupported_unit: "The record's unit has no price conversion",
  no_price: "No recent price is available",
  inputs_missing: "Assay or offtake inputs are missing",
  unreadable: "The suggestion could not be read",
};

const MARK_DUE_REASON_LABELS: Record<string, string> = {
  missing: "No mark set",
  age: "Mark is older than the maximum age",
  moved: "Suggested price moved beyond the threshold",
};

export function suggestionStatusLabel(status: unknown): string | null {
  if (typeof status !== "string" || status.length === 0) return null;
  if (status === "ok") return null;
  return SUGGESTION_STATUS_LABELS[status] ?? status;
}

export function markDueReasonsText(reasons: unknown): string {
  if (!Array.isArray(reasons)) return "—";
  const labels = reasons
    .filter((r): r is string => typeof r === "string" && r.length > 0)
    .map((r) => MARK_DUE_REASON_LABELS[r] ?? r);
  return labels.length === 0 ? "—" : labels.join(", ");
}

export function formatMoveBps(bps: unknown): string {
  return typeof bps === "number" && Number.isFinite(bps) ? `${bps} bps` : "—";
}

export type AccessState = "checking" | "ok" | "no-role";

export function accessState(access: CanCall | undefined): AccessState {
  if (access == null) return "checking";
  return access.immediate ? "ok" : "no-role";
}

export interface RevalueSeed {
  recordId: number;
  title: string;
  suggestedValue: string | null;
  suggestedBenchmark: string | null;
  suggestedHash: string | null;
  currentBenchmark: string | null;
}

export interface RevalueInput {
  value: string;
  benchmark: string;
  evidence: string;
}

const PRICE_PATTERN = /^\d+(\.\d{1,7})?$/;

export function revalueNeedsEvidence(
  input: Pick<RevalueInput, "value" | "benchmark">,
  seed: RevalueSeed,
): boolean {
  if (seed.suggestedHash == null || seed.suggestedValue == null) return true;
  return (
    input.value.trim() !== seed.suggestedValue ||
    input.benchmark.trim() !== (seed.suggestedBenchmark ?? "")
  );
}

export function revalueFormError(
  input: RevalueInput,
  seed: RevalueSeed,
): string | null {
  const value = input.value.trim();
  if (value === "") return "Enter the price per unit.";
  if (value.startsWith("-")) return "The price can't be negative.";
  if (!PRICE_PATTERN.test(value)) {
    return "Enter the price as a number with at most 7 decimals.";
  }
  const benchmark = input.benchmark.trim();
  if (benchmark === "") return "Enter the benchmark.";
  if (!isSecurityBenchmark(benchmark)) {
    return "The benchmark can use letters, digits and underscores, up to 32 characters.";
  }
  if (revalueNeedsEvidence(input, seed) && input.evidence.trim() === "") {
    return "Describe the source of your price.";
  }
  return null;
}

export function reportHashFor(
  input: RevalueInput,
  seed: RevalueSeed,
  evidenceHash: string | null,
): string | null {
  return revalueNeedsEvidence(input, seed)
    ? evidenceHash
    : (seed.suggestedHash ?? null);
}

export interface ConsentInput {
  dateInput: string;
  reference: string;
}

export function consentFormError(
  input: ConsentInput,
  today: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateInput)) {
    return "Pick the new maturity date.";
  }
  if (Number.isNaN(valueDateSeconds(input.dateInput))) {
    return "Pick a valid maturity date.";
  }
  if (input.dateInput <= today) return "Pick a date after today (UTC).";
  if (input.reference.trim() === "") {
    return "Enter the buyers' consent reference.";
  }
  return null;
}

export function newMaturitySeconds(dateInput: string): number {
  return valueDateSeconds(dateInput);
}

export const SECURITY_MARKS_ERROR_COPY: Record<string, string> = {
  "1": "This record does not exist on-chain.",
  "14": "This loan has no security terms yet. Set them first.",
};

export function securityMarksErrorCopy(
  err: unknown,
  fallback: string,
): UserFacingError {
  const mapped = toUserError(err, fallback);
  if (/^You cancelled the transaction/.test(mapped.message)) return mapped;
  const code = amErrorCode(mapped.details);
  const copy = code == null ? undefined : SECURITY_MARKS_ERROR_COPY[code];
  return copy == null
    ? mapped
    : { message: copy, details: mapped.details, isSpecific: true };
}
