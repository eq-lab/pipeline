// spec: docs/frontend/trustee-flows.md#risk-council-pending-operations
import { useEffect, useMemo } from "react";
import {
  FLAG_OUTCOMES,
  SECURITY_PAYMENT_TERMS,
  type FlagOutcome,
  type RiskCouncilCall,
  type RiskCouncilClosureReason,
  type SecurityPaymentTerm,
  type SecurityRegistryCall,
} from "@pipeline/wallet-connect";
import {
  canonicalPendingFunction,
  type PendingOperation,
  type PendingOperationState,
  type PendingTargetKind,
} from "@/api/pendingOperations";
import { useLoanBook, type LoanBookEntry } from "@/api/useLoanBook";
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
  evmCouncilErrorCopy,
  formatReadyAt,
  NO_LONGER_SCHEDULED,
  otherWalletCopy,
  REGISTRY_PAUSED_COPY,
  riskCouncilErrorCopy,
  securityRegistryErrorCopy,
  stageLabel,
} from "@/lib/accessManagerAction";
import {
  councilTarget,
  pruneExecutedOperations,
  recordServedOperations,
  useExecutedOperations,
  useScheduledOps,
  useServedOperationIds,
  type ExecutedOperation,
  type ScheduledOp,
} from "@/lib/riskCouncilOps";
import { useChainWallet } from "@/lib/chainWallet";
import {
  isStellarTarget,
  riskCouncilChainReason,
  sameChainAddress,
} from "@/lib/targetChains";
import { truncateAddress } from "@/lib/truncateAddress";
import { formatMaturityDate } from "@/utils/formatDate";
import { formatBpsRate } from "@/utils/formatUsd";
import { toUserError, type UserFacingError } from "@/utils/userError";
import {
  evmRecoveryErrorCopy,
  formatChainAmount,
  recoveryErrorCopy,
} from "./-repayment-recovery";
import {
  formatSignedChainAmount,
  type ActionView,
  type LabelValue,
} from "./-risk-council-shared";
import { formatTermsRows, PAYMENT_TERM_LABELS } from "./-risk-council-terms";

export const PENDING_CARD_TITLE = "Scheduled operations";
export const PENDING_EMPTY = "No scheduled operations found.";
export const PENDING_SESSION_NOTE =
  "Scheduled from this console. The list catches up within a minute.";
export const PENDING_ARGS_MISMATCH =
  "The served arguments do not match this operation on chain. Reload the page.";
export const PENDING_EXECUTED = "Executed";
export const PENDING_PAUSED = REGISTRY_PAUSED_COPY;
export const SET_TERMS_PENDING_NOTICE =
  "A terms change is already scheduled — see above. Scheduling again creates a second operation with a new 24 h wait.";

export const PENDING_CONTRACT_NAMES: Record<PendingTargetKind, string> = {
  security_registry: "SecurityRegistry",
  loan_registry: "LoanRegistry",
  minter: "Minter",
  other: "contract",
};

export const PENDING_STATE_LABELS: Record<PendingOperationState, string> = {
  waiting: "Waiting",
  ready: "Ready",
  expired: "Expired",
};

export type PendingOwner =
  | "escalate"
  | "reterm"
  | "writedown"
  | "security"
  | "recovery";

const PENDING_OWNERS: Record<string, PendingOwner> = {
  set_default: "escalate",
  amend_economics: "reterm",
  adjust_interest: "reterm",
  write_down: "writedown",
  close_defaulted: "writedown",
  cure: "writedown",
  set_terms: "security",
  resolve_flag: "security",
  release_with_consent: "security",
  reverse_repay: "recovery",
};

export const PENDING_OWNER_KINDS: Record<PendingOwner, PendingTargetKind> = {
  escalate: "loan_registry",
  reterm: "loan_registry",
  writedown: "loan_registry",
  security: "security_registry",
  recovery: "minter",
};

export const PENDING_OWNER_LINK_LABELS: Record<PendingOwner, string> = {
  escalate: "Open Escalate to Default",
  reterm: "Open Amend economics",
  writedown: "Open Default resolution",
  security: "Open Security",
  recovery: "Open loan · Repayment recovery",
};

export function pendingOwner(fn: string): PendingOwner | null {
  return Object.hasOwn(PENDING_OWNERS, fn) ? PENDING_OWNERS[fn]! : null;
}

export function pendingTargetMismatch(
  short: string,
  contract = PENDING_CONTRACT_NAMES.security_registry,
): string {
  return `This operation targets another ${contract} (${short}) than this console is configured for.`;
}

const EXPIRATION_SECONDS = 604_800;
const U32_MAX = 4_294_967_295;
const U64_DECIMAL = /^\d+$/;
const SIGNED_DECIMAL = /^-?\d+$/;
const MAX_RATE_BPS = 10_000;
const RATE_SCALE = 100;
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

const EVM_TERMS_KEYS = [
  "advanceRatioBps",
  "marginCallRatioBps",
  "defaultRatioBps",
  "curePeriod",
  "priceStaleAfter",
  "paymentTerm",
  "gracePeriod",
  "defaultRate",
  "originatorFeeRate",
  "attestationInterval",
  "inspectionInterval",
  "toleranceBps",
  "gradeToleranceBps",
  "marginCallAt",
  "defaultBreachAt",
] as const;

const EVM_TERMS12_KEYS = [
  "advanceRatioBps",
  "marginCallRatioBps",
  "curePeriod",
  "priceStaleAfter",
  "paymentTerm",
  "gracePeriod",
  "defaultRate",
  "attestationInterval",
  "inspectionInterval",
  "toleranceBps",
  "gradeToleranceBps",
  "marginCallAt",
] as const;

export interface ReverseRepayCall {
  fn: "reverse_repay";
  loanId: number;
  repaymentId: number;
  refHash: string;
}

export type PendingCall = CouncilCall | ReverseRepayCall;

export interface PendingOpItem {
  key: string;
  operationId: string;
  caller: string;
  target: string;
  fn: string;
  argsXdr: string | null;
  calldata: string | null;
  readyAt: number;
  expiresAt: number;
  state: PendingOperationState;
  targetKind: PendingTargetKind;
  call: PendingCall | null;
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

function evmId(value: unknown): number | null {
  if (typeof value !== "string" || !U64_DECIMAL.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= U32_MAX ? id : null;
}

function enumOrdinal<T>(value: unknown, allowed: readonly T[]): T | null {
  return Number.isInteger(value) ? (allowed[value as number] ?? null) : null;
}

function hasExactKeys(
  terms: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): boolean {
  return (
    Object.keys(terms).length === keys.length &&
    keys.every((key) => key in terms)
  );
}

function decodeEvmTerms(
  value: unknown,
): Extract<SecurityRegistryCall, { fn: "set_terms" }>["terms"] | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const terms = value as Record<string, unknown>;
  const full = hasExactKeys(terms, EVM_TERMS_KEYS);
  if (!full && !hasExactKeys(terms, EVM_TERMS12_KEYS)) return null;
  const paymentTerm = enumOrdinal<SecurityPaymentTerm>(
    terms.paymentTerm,
    SECURITY_PAYMENT_TERMS,
  );
  const u32s = [
    terms.advanceRatioBps,
    terms.marginCallRatioBps,
    terms.defaultRate,
    terms.toleranceBps,
    terms.gradeToleranceBps,
    ...(full ? [terms.defaultRatioBps, terms.originatorFeeRate] : []),
  ];
  const u64s = [
    terms.curePeriod,
    terms.priceStaleAfter,
    terms.gracePeriod,
    terms.attestationInterval,
    terms.inspectionInterval,
  ];
  if (
    paymentTerm === null ||
    !u32s.every(isU32) ||
    !u64s.every(isU64) ||
    terms.marginCallAt !== "0" ||
    (full && terms.defaultBreachAt !== "0")
  ) {
    return null;
  }
  return {
    advanceRatioBps: terms.advanceRatioBps as number,
    marginCallRatioBps: terms.marginCallRatioBps as number,
    curePeriod: terms.curePeriod as string,
    priceStaleAfter: terms.priceStaleAfter as string,
    paymentTerm,
    gracePeriod: terms.gracePeriod as string,
    defaultRate: terms.defaultRate as number,
    attestationInterval: terms.attestationInterval as string,
    inspectionInterval: terms.inspectionInterval as string,
    toleranceBps: terms.toleranceBps as number,
    gradeToleranceBps: terms.gradeToleranceBps as number,
    ...(full
      ? {
          defaultRatioBps: terms.defaultRatioBps as number,
          originatorFeeRate: terms.originatorFeeRate as number,
        }
      : {}),
  };
}

export function decodeEvmSecurityCall(
  fn: string,
  args: unknown,
): SecurityRegistryCall | null {
  if (!Array.isArray(args)) return null;
  const id = evmId(args[0]);
  if (id === null) return null;
  switch (fn) {
    case "set_terms": {
      const terms = args.length === 2 ? decodeEvmTerms(args[1]) : null;
      return terms !== null ? { fn: "set_terms", loanId: id, terms } : null;
    }
    case "resolve_flag": {
      const outcome = enumOrdinal<FlagOutcome>(args[1], FLAG_OUTCOMES);
      return args.length === 3 && outcome !== null && isHash(args[2])
        ? {
            fn: "resolve_flag",
            recordId: id,
            outcome,
            reasonHash: args[2],
          }
        : null;
    }
    case "release_with_consent":
      return args.length === 2 && isHash(args[1])
        ? { fn: "release_with_consent", recordId: id, consentHash: args[1] }
        : null;
    default:
      return null;
  }
}

const EVM_CLOSURE_ORDINALS: Readonly<Record<number, RiskCouncilClosureReason>> =
  { 4: "Default", 5: "OtherWriteDown" };

export function decodeEvmLoanRegistryCall(
  fn: string,
  args: unknown,
): RiskCouncilCall | null {
  if (!Array.isArray(args)) return null;
  const loanId = evmId(args[0]);
  if (loanId === null) return null;
  switch (fn) {
    case "set_default":
      return args.length === 1 ? { fn: "set_default", loanId } : null;
    case "cure":
      return args.length === 1 ? { fn: "cure", loanId } : null;
    case "amend_economics": {
      const rate = args[1];
      const maturity = Number(args[2]);
      if (
        args.length !== 3 ||
        !isU32(rate) ||
        rate % RATE_SCALE !== 0 ||
        rate / RATE_SCALE < 1 ||
        rate / RATE_SCALE > MAX_RATE_BPS ||
        !isU64(args[2]) ||
        !Number.isSafeInteger(maturity) ||
        maturity <= 0
      ) {
        return null;
      }
      return {
        fn: "amend_economics",
        loanId,
        rateBps: rate / RATE_SCALE,
        maturity,
      };
    }
    case "adjust_interest": {
      const delta = args[1];
      return args.length === 3 &&
        typeof delta === "string" &&
        SIGNED_DECIMAL.test(delta) &&
        isHash(args[2])
        ? { fn: "adjust_interest", loanId, delta, reasonHash: args[2] }
        : null;
    }
    case "write_down":
      return args.length === 2 && isU64(args[1])
        ? { fn: "write_down", loanId, amount: args[1] }
        : null;
    case "close_defaulted": {
      const reason =
        typeof args[1] === "number" ? EVM_CLOSURE_ORDINALS[args[1]] : undefined;
      return args.length === 2 && reason !== undefined
        ? { fn: "close_defaulted", loanId, reason }
        : null;
    }
    default:
      return null;
  }
}

export function decodeEvmReverseRepayCall(
  fn: string,
  args: unknown,
): ReverseRepayCall | null {
  if (fn !== "reverse_repay" || !Array.isArray(args)) return null;
  const loanId = evmId(args[0]);
  const repaymentId = evmId(args[1]);
  return args.length === 3 &&
    loanId !== null &&
    repaymentId !== null &&
    isHash(args[2])
    ? { fn: "reverse_repay", loanId, repaymentId, refHash: args[2] }
    : null;
}

export function decodeEvmPendingCall(
  fn: string,
  args: unknown,
): PendingCall | null {
  return (
    decodeEvmSecurityCall(fn, args) ??
    decodeEvmLoanRegistryCall(fn, args) ??
    decodeEvmReverseRepayCall(fn, args)
  );
}

export function decodeLoanRegistryCall(
  fn: string,
  args: unknown,
): RiskCouncilCall | null {
  if (!Array.isArray(args) || !isU32(args[0])) return null;
  const loanId = args[0];
  switch (fn) {
    case "set_default":
      return args.length === 1 ? { fn: "set_default", loanId } : null;
    case "cure":
      return args.length === 1 ? { fn: "cure", loanId } : null;
    case "amend_economics": {
      const rate = args[1];
      const maturity = Number(args[2]);
      if (
        args.length !== 3 ||
        !isU32(rate) ||
        rate % RATE_SCALE !== 0 ||
        rate / RATE_SCALE < 1 ||
        rate / RATE_SCALE > MAX_RATE_BPS ||
        !isU64(args[2]) ||
        !Number.isSafeInteger(maturity) ||
        maturity <= 0
      ) {
        return null;
      }
      return {
        fn: "amend_economics",
        loanId,
        rateBps: rate / RATE_SCALE,
        maturity,
      };
    }
    case "adjust_interest": {
      const delta = args[1];
      return args.length === 3 &&
        typeof delta === "string" &&
        SIGNED_DECIMAL.test(delta) &&
        isHash(args[2])
        ? { fn: "adjust_interest", loanId, delta, reasonHash: args[2] }
        : null;
    }
    case "write_down":
      return args.length === 2 && isU64(args[1])
        ? { fn: "write_down", loanId, amount: args[1] }
        : null;
    case "close_defaulted": {
      const reason = variantOf<RiskCouncilClosureReason>(args[1], [
        "Default",
        "OtherWriteDown",
      ]);
      return args.length === 2 && reason !== null
        ? { fn: "close_defaulted", loanId, reason }
        : null;
    }
    default:
      return null;
  }
}

export function decodeReverseRepayCall(
  fn: string,
  args: unknown,
): ReverseRepayCall | null {
  if (fn !== "reverse_repay" || !Array.isArray(args)) return null;
  return args.length === 3 &&
    isU32(args[0]) &&
    isU32(args[1]) &&
    isHash(args[2])
    ? {
        fn: "reverse_repay",
        loanId: args[0],
        repaymentId: args[1],
        refHash: args[2],
      }
    : null;
}

export function decodePendingCall(
  fn: string,
  args: unknown,
): PendingCall | null {
  return (
    decodeSecurityCall(fn, args) ??
    decodeLoanRegistryCall(fn, args) ??
    decodeReverseRepayCall(fn, args)
  );
}

function callLoanId(call: PendingCall | null): number | null {
  return call !== null && "loanId" in call ? call.loanId : null;
}

function toUnix(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

export function fromServed(
  op: PendingOperation,
  loanId?: number | null,
): PendingOpItem {
  const fn = canonicalPendingFunction(op.function);
  const calldata = op.calldata ?? null;
  const call =
    calldata !== null
      ? decodeEvmPendingCall(fn, op.args)
      : decodePendingCall(fn, op.args);
  return {
    key: op.operation_id,
    operationId: op.operation_id,
    caller: op.caller,
    target: op.target,
    fn,
    argsXdr: op.args_xdr ?? null,
    calldata,
    readyAt: toUnix(op.ready_at),
    expiresAt: toUnix(op.expires_at),
    state: op.state,
    targetKind: op.target_kind,
    call,
    rawArgs: op.args,
    source: "indexed",
    loanId: loanId ?? callLoanId(call),
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
  const { operationId, readyAt, caller, target, argsXdr, calldata } = op;
  if (
    operationId == null ||
    readyAt == null ||
    readyAt <= 0 ||
    caller == null ||
    target == null ||
    (argsXdr == null && calldata == null)
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
    argsXdr: argsXdr ?? null,
    calldata: calldata ?? null,
    readyAt,
    expiresAt,
    state: stateAt(readyAt, expiresAt, nowSec),
    targetKind: councilTarget(op.call),
    call: op.call,
    rawArgs: null,
    source: "session",
    loanId: op.loanId ?? callLoanId(op.call),
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
  everServed,
  chainId,
  loanId,
  nowSec,
}: {
  served: ReadonlyArray<PendingOperation>;
  session: ReadonlyArray<ScheduledOp>;
  executed: ReadonlyMap<string, ExecutedOperation>;
  everServed: ReadonlySet<string>;
  chainId: number;
  loanId: number | null;
  nowSec: number;
}): PendingOpItem[] {
  const seen = new Set<string>();
  const unique = served.filter((op) => {
    if (seen.has(op.operation_id)) return false;
    seen.add(op.operation_id);
    return true;
  });
  const indexed = unique.map((op) => fromServed(op, loanId));
  const local = session
    .filter((op) => op.chainId === chainId)
    .map((op) => fromSession(op, nowSec))
    .filter(
      (item): item is PendingOpItem =>
        item !== null &&
        loanId !== null &&
        item.loanId === loanId &&
        !seen.has(item.operationId) &&
        !everServed.has(item.operationId),
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

export function servedReadyAtById(
  ops: ReadonlyArray<PendingOperation>,
): ReadonlyMap<string, number> {
  return new Map(ops.map((op) => [op.operation_id, toUnix(op.ready_at)]));
}

export function usePruneExecuted(
  chainId: number,
  ops: ReadonlyArray<PendingOperation>,
  fetchedAt: number,
): void {
  useEffect(() => {
    recordServedOperations(
      chainId,
      ops.map((op) => op.operation_id),
    );
    pruneExecutedOperations(chainId, servedReadyAtById(ops), fetchedAt);
  }, [chainId, ops, fetchedAt]);
}

const NO_OPS: ReadonlyArray<PendingOperation> = [];

export function useLoanPendingOps({
  chainId,
  loanId,
  entry,
  extraServed = NO_OPS,
  extraFetchedAt,
}: {
  chainId: number;
  loanId: number | null;
  entry: LoanBookEntry | undefined;
  extraServed?: ReadonlyArray<PendingOperation>;
  extraFetchedAt?: number;
}): PendingOpItem[] {
  const loanBook = useLoanBook();
  const session = useScheduledOps(chainId);
  const executed = useExecutedOperations(chainId);
  const everServed = useServedOperationIds(chainId);
  const loans = loanBook.data?.loans;
  const chainOps = useMemo(
    () => [
      ...extraServed,
      ...(loans ?? [])
        .filter((loan) => loan.chain_id === chainId)
        .flatMap((loan) => loan.pending_operations ?? []),
    ],
    [extraServed, loans, chainId],
  );
  const fetchTimes = [loanBook.dataUpdatedAt, extraFetchedAt].filter(
    (time): time is number => time !== undefined,
  );
  usePruneExecuted(
    chainId,
    chainOps,
    fetchTimes.length === 0 ? 0 : Math.min(...fetchTimes),
  );
  return mergePendingOps({
    served: [...extraServed, ...(entry?.pending_operations ?? [])],
    session,
    executed,
    everServed,
    chainId,
    loanId,
    nowSec: Date.now() / 1000,
  });
}

function isExecutedHere(
  item: PendingOpItem,
  session: ReadonlyArray<ScheduledOp>,
): boolean {
  return session.some(
    (op) => op.operationId === item.operationId && op.executedHere,
  );
}

function rawIdOf(item: PendingOpItem, value: unknown): number | null {
  if (isU32(value)) return value;
  return item.calldata !== null ? evmId(value) : null;
}

export function recordNumberOf(item: PendingOpItem): number | null {
  if (item.call != null && "recordId" in item.call) return item.call.recordId;
  const first = Array.isArray(item.rawArgs) ? item.rawArgs[0] : null;
  return rawIdOf(item, first);
}

export function repaymentNumberOf(item: PendingOpItem): number | null {
  if (item.call?.fn === "reverse_repay") return item.call.repaymentId;
  const second = Array.isArray(item.rawArgs) ? item.rawArgs[1] : null;
  return rawIdOf(item, second);
}

export function pendingActionLabel(item: PendingOpItem): string {
  const record = recordNumberOf(item);
  const suffix = record === null ? "" : ` · record #${record}`;
  switch (item.fn) {
    case "set_default":
      return "Declare default";
    case "cure":
      return "Cure";
    case "amend_economics":
      return "Amend economics";
    case "adjust_interest":
      return "Adjust interest";
    case "write_down":
      return "Write down";
    case "close_defaulted":
      return "Close defaulted loan";
    case "reverse_repay": {
      const repayment = repaymentNumberOf(item);
      return `Reverse repayment${repayment === null ? "" : ` · repayment #${repayment}`}`;
    }
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
    default_ratio_bps: terms.defaultRatioBps,
    originator_fee_rate: terms.originatorFeeRate,
  };
}

const CLOSURE_LABELS: Record<RiskCouncilClosureReason, string> = {
  Default: "Default",
  OtherWriteDown: "Other write-down",
};

export function pendingArgRows(
  item: PendingOpItem,
  chainId: number,
): LabelValue[] {
  const call = item.call;
  switch (call?.fn) {
    case "set_default":
    case "cure":
      return [];
    case "amend_economics":
      return [
        {
          label: "New rate",
          value: `${formatBpsRate(call.rateBps)} (${call.rateBps} bps)`,
        },
        { label: "New maturity", value: formatMaturityDate(call.maturity) },
      ];
    case "adjust_interest":
      return [
        {
          label: "Delta",
          value: formatSignedChainAmount(call.delta, chainId),
        },
        { label: "Reason hash", value: shortHash(call.reasonHash) },
      ];
    case "write_down":
      return [
        { label: "Amount", value: formatChainAmount(call.amount, chainId) },
      ];
    case "close_defaulted":
      return [{ label: "Closure reason", value: CLOSURE_LABELS[call.reason] }];
    case "reverse_repay":
      return [
        { label: "Repayment", value: `#${call.repaymentId}` },
        { label: "Reference hash", value: shortHash(call.refHash) },
      ];
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
  chainId: number,
): string {
  const short = truncateAddress(item.caller);
  return address != null && sameChainAddress(chainId, address, item.caller)
    ? `${short} · this wallet`
    : short;
}

function executeErrorCopy(
  kind: PendingTargetKind,
  details: string,
  chainId: number,
): string | null {
  if (!isStellarTarget(chainId)) {
    return kind === "minter"
      ? (evmRecoveryErrorCopy(details) ?? evmCouncilErrorCopy(details, kind))
      : evmCouncilErrorCopy(details, kind);
  }
  switch (kind) {
    case "minter":
      return (
        recoveryErrorCopy("execute", details) ??
        riskCouncilErrorCopy("execute", details)
      );
    case "security_registry":
      return (
        riskCouncilErrorCopy("execute", details) ??
        securityRegistryErrorCopy(details)
      );
    default:
      return riskCouncilErrorCopy("execute", details);
  }
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
  const { address } = useChainWallet(chainId);
  const execute = usePendingOperationExecute();

  const blocked = riskCouncilChainReason(chainId);
  const isCaller =
    address != null && sameChainAddress(chainId, address, item.caller);
  const wrongTarget = !sameChainAddress(chainId, item.target, expectedTarget);
  const contract = PENDING_CONTRACT_NAMES[item.targetKind];
  const isExecuted = item.executed !== null;
  const ready = item.state === "ready" && !isExecuted;
  const gate = ready ? executeGate : null;

  const notice = isExecuted
    ? null
    : (blocked ??
      (isCaller ? null : otherWalletCopy(item.caller)) ??
      (wrongTarget
        ? pendingTargetMismatch(truncateAddress(item.target), contract)
        : null) ??
      gate);

  const error = execute.error;
  let userError: UserFacingError | null = null;
  if (error != null && !(error instanceof NoLongerScheduledError)) {
    if (error instanceof PendingTargetMismatchError) {
      userError = {
        message: pendingTargetMismatch(truncateAddress(error.target), contract),
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
      const copy = executeErrorCopy(item.targetKind, mapped.details, chainId);
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
          paused:
            item.targetKind === "security_registry" && executeGate != null,
          fn: item.fn,
          argsXdr: item.argsXdr,
          calldata: item.calldata,
          targetKind: item.targetKind,
        })
        .catch(() => {});
    },
  };
}
