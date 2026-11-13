// spec: docs/frontend/trustee-flows.md#risk-council-actions
import type { CanCall, OperationSchedule } from "@pipeline/wallet-connect";

export type AccessAction =
  | "execute-now"
  | "schedule"
  | "execute-scheduled"
  | "no-role";

export function accessAction(
  access: CanCall | undefined,
  schedule: OperationSchedule | undefined,
): AccessAction | null {
  if (access == null) return null;
  if (access.immediate) return "execute-now";
  if (access.delay === 0) return "no-role";
  if (schedule == null) return null;
  return schedule.readyAt > 0 ? "execute-scheduled" : "schedule";
}

export function formatDelayHours(delaySeconds: number): string {
  return `${delaySeconds / 3600} h`;
}

export function formatReadyAt(readyAtSeconds: number): string {
  const iso = new Date(readyAtSeconds * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function stageLabel(stage: string | null, idle: string): string {
  switch (stage) {
    case "awaiting-signature":
      return "Waiting for wallet signature…";
    case "submitting":
      return "Submitting on-chain…";
    case "confirming":
      return "Confirming…";
    default:
      return idle;
  }
}

export function amErrorCode(details: string): string | null {
  return details.match(/Error\(Contract,\s*#(\d+)\)/)?.[1] ?? null;
}

export const RISK_COUNCIL_AM_ERROR_COPY: Record<string, string> = {
  "execute:6": "Nothing is scheduled for this wallet. Schedule it first.",
  "execute:7":
    "This operation is not ready yet. Execute it once the ready time has passed.",
  "execute:8": "The scheduled operation expired. Schedule it again.",
  "schedule:9": "This operation is already scheduled.",
};

export const SECURITY_REGISTRY_ERROR_COPY: Record<string, string> = {
  "12": "The record's current status does not allow this. It may already be released or enforced.",
  "14": "This loan has no security terms yet. Set them first.",
  "15": "The margin call ratio must be at least the advance ratio.",
  "32": "This record has no flag to resolve.",
};

export function securityRegistryErrorCopy(details: string): string | null {
  const code = amErrorCode(details);
  return code == null ? null : (SECURITY_REGISTRY_ERROR_COPY[code] ?? null);
}

export function riskCouncilErrorCopy(
  mode: "schedule" | "execute",
  details: string,
): string | null {
  const code = amErrorCode(details);
  return code == null
    ? null
    : (RISK_COUNCIL_AM_ERROR_COPY[`${mode}:${code}`] ?? null);
}

export function riskCouncilRoleLine(
  action: AccessAction | null,
  delaySeconds: number | null,
  readyAt: number | null,
  noRoleCopy: string,
): string {
  switch (action) {
    case "execute-now":
      return "Risk Council: this executes at once, with one signature.";
    case "schedule":
      return `Risk Council: this deployment applies a ${formatDelayHours(delaySeconds ?? 0)} delay. Schedule it, then execute after the ready time. The Guardian or the Admin can cancel it during the wait.`;
    case "execute-scheduled":
      return `Scheduled. Executable from ${formatReadyAt(readyAt ?? 0)}.`;
    case "no-role":
      return noRoleCopy;
    default:
      return "Checking this wallet's permissions…";
  }
}

export const NO_LONGER_SCHEDULED =
  "No longer scheduled — cancelled by the Guardian or the Admin, or executed from another session.";
