// spec: docs/frontend/trustee-flows.md#repayment-recovery-1711
import type {
  CanCall,
  MinterRepayment,
  OperationSchedule,
  RepaymentInput,
} from "@pipeline/wallet-connect";
import {
  RECOVERY_STATUSES,
  type RecoveryRow,
} from "@/api/useRepaymentRecovery";
import type { AuditLogItem } from "@/api/useAuditLog";
import type { WaterfallResponse } from "@/api/useLoanWaterfall";
import { chainAmountDecimals } from "@/lib/targetChains";
import { sacBaseUnitsToUsdDecimal } from "@/utils/stellarSacUnits";
import { buildRepaymentInput } from "./-record-repayment";

export type RecoveryCardState =
  | "hidden"
  | "eligible"
  | "awaiting-corrected-repayment"
  | "blocked-evm";

export type ReverseAction =
  | "execute-now"
  | "schedule"
  | "execute-scheduled"
  | "no-role";

export interface LabelValue {
  label: string;
  value: string;
}

export interface CandidateRow {
  repaymentId: number;
  suspect: boolean;
  fields: LabelValue[];
}

const ZERO_SERVED = /^0+(?:\.0*)?$/;
const POSITIVE_SERVED = /^\d*\.?\d*[1-9]\d*\.?\d*$/;

export function isRecoveryEligible({
  offtakerOutstanding,
  seniorOutstanding,
  onchainStatus,
}: {
  offtakerOutstanding: string | null | undefined;
  seniorOutstanding: string | null | undefined;
  onchainStatus: string | null | undefined;
}): boolean {
  return (
    onchainStatus != null &&
    RECOVERY_STATUSES.has(onchainStatus) &&
    offtakerOutstanding != null &&
    ZERO_SERVED.test(offtakerOutstanding.trim()) &&
    seniorOutstanding != null &&
    POSITIVE_SERVED.test(seniorOutstanding.trim())
  );
}

export function recoveryCardState({
  eligible,
  onchainStatus,
  latestReversed,
  evmBlocked,
}: {
  eligible: boolean;
  onchainStatus: string | null | undefined;
  latestReversed: boolean;
  evmBlocked: boolean;
}): RecoveryCardState {
  if (onchainStatus == null || !RECOVERY_STATUSES.has(onchainStatus)) {
    return "hidden";
  }
  if (evmBlocked) return eligible ? "blocked-evm" : "hidden";
  if (latestReversed) return "awaiting-corrected-repayment";
  return eligible ? "eligible" : "hidden";
}

export function formatChainAmount(raw: string, chainId: number): string {
  const decimal = sacBaseUnitsToUsdDecimal(raw, chainAmountDecimals(chainId));
  if (decimal == null) return "—";
  const [whole = "0", frac = ""] = decimal.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = frac.replace(/0+$/, "").padEnd(2, "0");
  return `$${grouped}.${trimmed}`;
}

function isSuspect(repayment: RepaymentInput): boolean {
  return (
    repayment.senior_principal_repaid === "0" &&
    repayment.equity_distributed !== "0"
  );
}

export function candidateRows(
  rows: ReadonlyArray<RecoveryRow>,
  chainId: number,
): CandidateRow[] {
  const money = (raw: string) => formatChainAmount(raw, chainId);
  const mapped = rows
    .filter((row) => !row.reversed)
    .map<CandidateRow>((row) => ({
      repaymentId: row.repaymentId,
      suspect: isSuspect(row.repayment),
      fields: [
        {
          label: "Offtaker received",
          value: money(row.repayment.offtaker_received),
        },
        {
          label: "Senior principal repaid",
          value: money(row.repayment.senior_principal_repaid),
        },
        {
          label: "Senior interest",
          value: money(row.repayment.senior_interest),
        },
        {
          label: "Equity distributed",
          value: money(row.repayment.equity_distributed),
        },
        { label: "Management fee", value: money(row.repayment.mgmt_fee) },
        { label: "Performance fee", value: money(row.repayment.perf_fee) },
        { label: "OET allocation", value: money(row.repayment.oet_alloc) },
      ],
    }));
  return [
    ...mapped.filter((r) => r.suspect),
    ...mapped.filter((r) => !r.suspect),
  ];
}

export function preselectedRepaymentId(
  rows: ReadonlyArray<CandidateRow>,
): number | null {
  return rows.find((row) => row.suspect)?.repaymentId ?? null;
}

export function defaultSelection(
  rows: ReadonlyArray<RecoveryRow>,
  chainId: number,
): number | null {
  const last = rows.at(-1);
  if (last?.reversed) return last.repaymentId;
  return preselectedRepaymentId(candidateRows(rows, chainId));
}

export function hasServedPositive(value: string | null | undefined): boolean {
  return value != null && POSITIVE_SERVED.test(value.trim());
}

export function reversalEffects(
  minter: MinterRepayment,
  chainId: number,
): LabelValue[] {
  const money = (raw: string) => formatChainAmount(raw, chainId);
  const effects: LabelValue[] = [
    { label: "Cash removed from bank", value: money(minter.cash) },
    { label: "Treasury fee shares burned", value: minter.feeShares },
  ];
  if (minter.carvedOut) {
    effects.push({
      label: "Pocket unrelease: principal / interest",
      value: `${money(minter.principal)} / ${money(minter.interestMinted)}`,
    });
  } else {
    effects.push({
      label: "Interest absorbed from the vault",
      value: money(minter.interestMinted),
    });
  }
  return effects;
}

export function reverseAction(
  access: CanCall | undefined,
  schedule: OperationSchedule | undefined,
): ReverseAction | null {
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

export function originalValueDate(
  items: ReadonlyArray<AuditLogItem> | undefined,
  chainId: number,
  loanId: string,
  repaymentId: number,
): number | null {
  const item = items?.find(
    (i) =>
      i.event_name === "CashRepaid" &&
      i.chain_id === chainId &&
      i.scope.loan_id === loanId &&
      Number(i.details.repayment_id) === repaymentId,
  );
  if (item == null) return null;
  const valueDate = Number(item.details.value_date);
  return Number.isInteger(valueDate) && valueDate > 0 ? valueDate : null;
}

export function correctedRepaymentInput(
  original: RepaymentInput,
  waterfall: WaterfallResponse | undefined,
): RepaymentInput | null {
  return buildRepaymentInput(original.offtaker_received, waterfall);
}

const RECOVERY_ERROR_COPY: Record<string, string> = {
  "execute:6":
    "No scheduled reversal found for this wallet. Schedule it first.",
  "execute:7":
    "This reversal is not ready yet. Execute it once the ready time has passed.",
  "execute:8":
    "The scheduled reversal expired, or the Minter's bank cash is below this repayment's cash. See details.",
  "execute:25": "This repayment is already reversed.",
  "schedule:9": "A reversal is already scheduled for this repayment.",
};

export function recoveryErrorCopy(
  mode: "schedule" | "execute",
  details: string,
): string | null {
  const code = details.match(/Error\(Contract,\s*#(\d+)\)/)?.[1];
  return code == null ? null : (RECOVERY_ERROR_COPY[`${mode}:${code}`] ?? null);
}

export function formatValueDate(valueDateSeconds: number): string {
  return new Date(valueDateSeconds * 1000).toISOString().slice(0, 10);
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

export function roleLine(
  action: ReverseAction | null,
  delaySeconds: number | null,
  readyAt: number | null,
): string {
  switch (action) {
    case "execute-now":
      return "Risk Council: this reversal executes at once, with one signature.";
    case "schedule":
      return `Risk Council: this deployment applies a ${formatDelayHours(delaySeconds ?? 0)} delay. Schedule the reversal, then execute it after the ready time.`;
    case "execute-scheduled":
      return `Scheduled. Executable from ${formatReadyAt(readyAt ?? 0)}.`;
    case "no-role":
      return "Only the Risk Council can reverse a repayment.";
    default:
      return "Checking this wallet's permissions…";
  }
}
