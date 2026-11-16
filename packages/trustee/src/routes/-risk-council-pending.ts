// spec: docs/frontend/trustee-flows.md#risk-council-pending-operations
import {
  FLAG_OUTCOMES,
  SECURITY_PAYMENT_TERMS,
  useStellarWallet,
  type FlagOutcome,
  type SecurityPaymentTerm,
  type SecurityRegistryCall,
} from "@pipeline/wallet-connect";
import type {
  PendingOperation,
  PendingOperationState,
} from "@/api/pendingOperations";
import type { LoanSecurityTerms } from "@/api/useLoanSecurity";
import {
  NoLongerScheduledError,
  PendingArgsMismatchError,
  PendingTargetMismatchError,
  RegistryPausedError,
  usePendingOperationExecute,
  type CouncilCall,
} from "@/api/useRiskCouncil";
import {
  formatReadyAt,
  NO_LONGER_SCHEDULED,
  otherWalletCopy,
  riskCouncilErrorCopy,
  securityRegistryErrorCopy,
  stageLabel,
} from "@/lib/accessManagerAction";
import {
  councilTarget,
  type ExecutedOperation,
  type ScheduledOp,
} from "@/lib/riskCouncilOps";
import { stellarOnlyActionReason } from "@/lib/targetChains";
import { truncateAddress } from "@/lib/truncateAddress";
import { toUserError, type UserFacingError } from "@/utils/userError";
import { type ActionView, type LabelValue } from "./-risk-council-shared";
import { formatTermsRows, PAYMENT_TERM_LABELS } from "./-risk-council-terms";

export const PENDING_CARD_TITLE = "Scheduled operations";
export const PENDING_EMPTY = "No scheduled operations found.";
export const PENDING_SESSION_NOTE =
  "Scheduled from this console. The list catches up within a minute.";
export const PENDING_ARGS_MISMATCH =
  "The served arguments do not match this operation on chain. Reload the page.";
export const PENDING_EXECUTED = "Executed";
export const PENDING_PAUSED =
  "The SecurityRegistry is paused. Executing is blocked until it resumes.";
export const SET_TERMS_PENDING_NOTICE =
  "A terms change is already scheduled — see above. Scheduling again creates a second operation with a new 24 h wait.";

export function pendingTargetMismatch(short: string): string {
  return `This operation targets another SecurityRegistry (${short}) than this console is configured for.`;
}

const EXPIRATION_SECONDS = 604_800;
const U32_MAX = 4_294_967_295;
const U64_DECIMAL = /^\d+$/;
const HEX32 = /^[0-9a-f]{64}$/;

const TERMS_KEYS = [
  "advance_ratio_bps",
  "attestation_interval",
  "cure_period",
  "default_rate",
  "grace_period",
  "grade_tolerance_bps",
  "inspection_interval",
  "margin_call_at",
  "margin_call_ratio_bps",
  "payment_term",
  "price_stale_after",
  "tolerance_bps",
] as const;

export interface PendingOpItem {
  key: string;
  operationId: string;
  caller: string;
  target: string;
  fn: string;
  argsXdr: string;
  readyAt: number;
  expiresAt: number;
  state: PendingOperationState;
  call: CouncilCall | null;
  rawArgs: unknown;
  source: "indexed" | "session";
  loanId: number | null;
  executed: { hash: string } | null;
}

function isU32(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= U32_MAX
  );
}

function isU64(value: unknown): value is string {
  return typeof value === "string" && U64_DECIMAL.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HEX32.test(value);
}

function variantOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const name = value[0];
  return allowed.find((candidate) => candidate === name) ?? null;
}

function decodeTerms(
  value: unknown,
): Extract<SecurityRegistryCall, { fn: "set_terms" }>["terms"] | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const terms = value as Record<string, unknown>;
  const keys = Object.keys(terms);
  if (
    keys.length !== TERMS_KEYS.length ||
    !TERMS_KEYS.every((key) => key in terms)
  ) {
    return null;
  }
  const paymentTerm = variantOf<SecurityPaymentTerm>(
    terms.payment_term,
    SECURITY_PAYMENT_TERMS,
  );
  const u32s = [
    terms.advance_ratio_bps,
    terms.default_rate,
    terms.grade_tolerance_bps,
    terms.margin_call_ratio_bps,
    terms.tolerance_bps,
  ];
  const u64s = [
    terms.attestation_interval,
    terms.cure_period,
    terms.grace_period,
    terms.inspection_interval,
    terms.price_stale_after,
  ];
  if (
    paymentTerm === null ||
    !u32s.every(isU32) ||
    !u64s.every(isU64) ||
    terms.margin_call_at !== "0"
  ) {
    return null;
  }
  return {
    advanceRatioBps: terms.advance_ratio_bps as number,
    marginCallRatioBps: terms.margin_call_ratio_bps as number,
    curePeriod: terms.cure_period as string,
    priceStaleAfter: terms.price_stale_after as string,
    paymentTerm,
    gracePeriod: terms.grace_period as string,
    defaultRate: terms.default_rate as number,
    attestationInterval: terms.attestation_interval as string,
    inspectionInterval: terms.inspection_interval as string,
    toleranceBps: terms.tolerance_bps as number,
    gradeToleranceBps: terms.grade_tolerance_bps as number,
  };
}

export function decodeSecurityCall(
  fn: string,
  args: unknown,
): SecurityRegistryCall | null {
  if (!Array.isArray(args)) return null;
  switch (fn) {
    case "set_terms": {
      const terms = args.length === 2 ? decodeTerms(args[1]) : null;
      return terms !== null && isU32(args[0])
        ? { fn: "set_terms", loanId: args[0], terms }
        : null;
    }
    case "resolve_flag": {
      const outcome = variantOf<FlagOutcome>(args[1], FLAG_OUTCOMES);
      return args.length === 3 &&
        isU32(args[0]) &&
        outcome !== null &&
        isHash(args[2])
        ? {
            fn: "resolve_flag",
            recordId: args[0],
            outcome,
            reasonHash: args[2],
          }
        : null;
    }
    case "release_with_consent":
      return args.length === 2 && isU32(args[0]) && isHash(args[1])
        ? {
            fn: "release_with_consent",
            recordId: args[0],
            consentHash: args[1],
          }
        : null;
    default:
      return null;
  }
}

function toUnix(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

export function fromServed(op: PendingOperation): PendingOpItem {
  const call = decodeSecurityCall(op.function, op.args);
  return {
    key: op.operation_id,
    operationId: op.operation_id,
    caller: op.caller,
    target: op.target,
    fn: op.function,
    argsXdr: op.args_xdr,
    readyAt: toUnix(op.ready_at),
    expiresAt: toUnix(op.expires_at),
    state: op.state,
    call,
    rawArgs: op.args,
    source: "indexed",
    loanId: call?.fn === "set_terms" ? call.loanId : null,
    executed: null,
  };
}

function stateAt(
  readyAt: number,
  expiresAt: number,
  nowSec: number,
): PendingOperationState {
  if (nowSec < readyAt) return "waiting";
  return nowSec < expiresAt ? "ready" : "expired";
}

export function fromSession(
  op: ScheduledOp,
  nowSec: number,
): PendingOpItem | null {
  const { operationId, readyAt, caller, target, argsXdr } = op;
  if (
    operationId == null ||
    readyAt == null ||
    readyAt <= 0 ||
    caller == null ||
    target == null ||
    argsXdr == null
  ) {
    return null;
  }
  const expiresAt = readyAt + EXPIRATION_SECONDS;
  return {
    key: `session:${operationId}`,
    operationId,
    caller,
    target,
    fn: op.call.fn,
    argsXdr,
    readyAt,
    expiresAt,
    state: stateAt(readyAt, expiresAt, nowSec),
    call: op.call,
    rawArgs: null,
    source: "session",
    loanId: op.loanId ?? null,
    executed: null,
  };
}

function withExecuted(
  item: PendingOpItem,
  executed: ReadonlyMap<string, ExecutedOperation>,
): PendingOpItem {
  const entry = executed.get(item.operationId);
  return entry != null &&
    (entry.readyAt === null || entry.readyAt === item.readyAt)
    ? { ...item, executed: { hash: entry.hash } }
    : item;
}

export function mergePendingOps({
  served,
  session,
  executed,
  chainId,
  loanId,
  nowSec,
}: {
  served: ReadonlyArray<PendingOperation>;
  session: ReadonlyArray<ScheduledOp>;
  executed: ReadonlyMap<string, ExecutedOperation>;
  chainId: number;
  loanId: number | null;
  nowSec: number;
}): PendingOpItem[] {
  const securityServed = served.filter(
    (op) => op.target_kind === "security_registry",
  );
  const servedIds = new Set(securityServed.map((op) => op.operation_id));
  const indexed = securityServed.map(fromServed);
  const local = session
    .filter(
      (op) => op.chainId === chainId && loanId !== null && op.loanId === loanId,
    )
    .map((op) => fromSession(op, nowSec))
    .filter(
      (item): item is PendingOpItem =>
        item !== null && !servedIds.has(item.operationId),
    )
    .map((item) => withExecuted(item, executed))
    .filter((item) => item.executed !== null || !isExecutedHere(item, session));
  return [
    ...indexed.map((item) => withExecuted(item, executed)),
    ...local,
  ].sort(
    (a, b) =>
      a.readyAt - b.readyAt || a.operationId.localeCompare(b.operationId),
  );
}

function isExecutedHere(
  item: PendingOpItem,
  session: ReadonlyArray<ScheduledOp>,
): boolean {
  return session.some(
    (op) => op.operationId === item.operationId && op.executedHere,
  );
}

export function recordNumberOf(item: PendingOpItem): number | null {
  if (item.call != null && "recordId" in item.call) return item.call.recordId;
  const first = Array.isArray(item.rawArgs) ? item.rawArgs[0] : null;
  return isU32(first) ? first : null;
}

export function pendingActionLabel(item: PendingOpItem): string {
  const record = recordNumberOf(item);
  const suffix = record === null ? "" : ` · record #${record}`;
  switch (item.fn) {
    case "set_terms":
      return "Set terms";
    case "resolve_flag":
      return `Resolve flag${suffix}`;
    case "release_with_consent":
      return `Release with consent${suffix}`;
    default:
      return item.fn;
  }
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…`;
}

function termsForRows(
  call: Extract<SecurityRegistryCall, { fn: "set_terms" }>,
): LoanSecurityTerms {
  const { terms } = call;
  return {
    advance_ratio_bps: terms.advanceRatioBps,
    margin_call_ratio_bps: terms.marginCallRatioBps,
    cure_period: String(terms.curePeriod),
    price_stale_after: String(terms.priceStaleAfter),
    payment_term: terms.paymentTerm,
    grace_period: String(terms.gracePeriod),
    default_rate: terms.defaultRate,
    attestation_interval: String(terms.attestationInterval),
    inspection_interval: String(terms.inspectionInterval),
    tolerance_bps: terms.toleranceBps,
    grade_tolerance_bps: terms.gradeToleranceBps,
  };
}

export function pendingArgRows(item: PendingOpItem): LabelValue[] {
  const call = item.call;
  switch (call?.fn) {
    case "set_terms":
      return formatTermsRows(termsForRows(call)).map((row) =>
        row.label === "Payment term"
          ? { ...row, value: PAYMENT_TERM_LABELS[call.terms.paymentTerm] }
          : row,
      );
    case "resolve_flag":
      return [
        { label: "Outcome", value: call.outcome },
        { label: "Reason hash", value: shortHash(call.reasonHash) },
      ];
    case "release_with_consent":
      return [{ label: "Consent hash", value: shortHash(call.consentHash) }];
    default:
      return [{ label: "Arguments", value: JSON.stringify(item.rawArgs) }];
  }
}

export function pendingStateText(item: PendingOpItem): string {
  switch (item.state) {
    case "waiting":
      return `Waiting · executable from ${formatReadyAt(item.readyAt)}`;
    case "ready":
      return `Ready · expires ${formatReadyAt(item.expiresAt)}`;
    default:
      return "Expired — schedule it again";
  }
}

export function callerText(
  item: PendingOpItem,
  address: string | null | undefined,
): string {
  const short = truncateAddress(item.caller);
  return address != null && address === item.caller
    ? `${short} · this wallet`
    : short;
}

export function usePendingOperationView({
  chainId,
  item,
  executeGate,
  expectedTarget,
}: {
  chainId: number;
  item: PendingOpItem;
  executeGate: string | null;
  expectedTarget: string;
}): ActionView {
  const { address } = useStellarWallet();
  const execute = usePendingOperationExecute();

  const blocked = stellarOnlyActionReason(chainId);
  const isCaller = address != null && address === item.caller;
  const wrongTarget = item.target !== expectedTarget;
  const isExecuted = item.executed !== null;
  const ready = item.state === "ready" && !isExecuted;
  const gate = ready ? executeGate : null;

  const notice = isExecuted
    ? null
    : (blocked ??
      (isCaller ? null : otherWalletCopy(item.caller)) ??
      (wrongTarget
        ? pendingTargetMismatch(truncateAddress(item.target))
        : null) ??
      gate);

  const error = execute.error;
  let userError: UserFacingError | null = null;
  if (error != null && !(error instanceof NoLongerScheduledError)) {
    if (error instanceof PendingTargetMismatchError) {
      userError = {
        message: pendingTargetMismatch(truncateAddress(error.target)),
        details: error.message,
        isSpecific: true,
      };
    } else if (error instanceof RegistryPausedError) {
      userError = {
        message: PENDING_PAUSED,
        details: error.message,
        isSpecific: true,
      };
    } else if (error instanceof PendingArgsMismatchError) {
      userError = {
        message: PENDING_ARGS_MISMATCH,
        details: error.message,
        isSpecific: true,
      };
    } else {
      const mapped = toUserError(error, "The Risk Council action failed.");
      const copy =
        riskCouncilErrorCopy("execute", mapped.details) ??
        (councilTarget(item.fn as CouncilCall["fn"]) === "security_registry"
          ? securityRegistryErrorCopy(mapped.details)
          : null);
      userError = copy
        ? { ...mapped, message: copy, isSpecific: true }
        : mapped;
    }
  }

  return {
    action: null,
    roleLine: isExecuted ? PENDING_EXECUTED : pendingStateText(item),
    buttonLabel: "Execute",
    disabled:
      isExecuted ||
      blocked != null ||
      !ready ||
      !isCaller ||
      wrongTarget ||
      gate != null ||
      execute.isPending,
    notice,
    pending: execute.isPending,
    stageText: execute.isPending ? stageLabel(execute.stage, "Working…") : "",
    error: userError,
    hash: execute.hash ?? item.executed?.hash ?? null,
    noLongerScheduled:
      error instanceof NoLongerScheduledError ? NO_LONGER_SCHEDULED : null,
    chip: null,
    run: () => {
      execute
        .mutateAsync({
          chainId,
          operationId: item.operationId,
          caller: item.caller,
          target: item.target,
          expectedTarget,
          paused: executeGate != null,
          fn: item.fn,
          argsXdr: item.argsXdr,
        })
        .catch(() => {});
    },
  };
}
