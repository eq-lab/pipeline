// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { useSyncExternalStore } from "react";
import type {
  RiskCouncilCall,
  SecurityRegistryCall,
} from "@pipeline/wallet-connect";

export type CouncilCall = RiskCouncilCall | SecurityRegistryCall;
export type CouncilTarget = "loan_registry" | "security_registry";

const SECURITY_FNS: ReadonlySet<string> = new Set<SecurityRegistryCall["fn"]>([
  "set_terms",
  "resolve_flag",
  "release_with_consent",
  "set_inspectors",
]);

export function councilTarget(
  call: CouncilCall | CouncilCall["fn"],
): CouncilTarget {
  const fn = typeof call === "string" ? call : call.fn;
  return SECURITY_FNS.has(fn) ? "security_registry" : "loan_registry";
}

export function isSecurityCall(
  call: CouncilCall,
): call is SecurityRegistryCall {
  return councilTarget(call) === "security_registry";
}

export interface ScheduledOp {
  chainId: number;
  call: CouncilCall;
  loanId?: number;
  scheduledAt: number;
  executedHere: boolean;
  operationId?: string;
  readyAt?: number;
  caller?: string;
  target?: string;
  argsXdr?: string;
}

export interface ScheduledOpChain {
  operationId?: string;
  readyAt?: number;
  caller?: string;
  target?: string;
  argsXdr?: string;
}

const ops = new Map<string, ScheduledOp>();
const executedIds = new Set<string>();
let executedSnapshot: ReadonlyArray<string> = [];
const listeners = new Set<() => void>();
let snapshot: ReadonlyArray<ScheduledOp> = [];

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .map((key) => [key, stableJson((value as Record<string, unknown>)[key])]);
  }
  return value;
}

export function riskCouncilCallKey(call: CouncilCall): string {
  return JSON.stringify(stableJson(call));
}

function opKey(chainId: number, call: CouncilCall): string {
  return `${chainId}:${riskCouncilCallKey(call)}`;
}

function commit(): void {
  snapshot = Array.from(ops.values());
  listeners.forEach((listener) => listener());
}

export function recordScheduledOp({
  chainId,
  call,
  loanId,
  operationId,
  readyAt,
  caller,
  target,
  argsXdr,
}: {
  chainId: number;
  call: CouncilCall;
  loanId?: number;
} & ScheduledOpChain): void {
  const chain: ScheduledOpChain = {
    operationId,
    readyAt,
    caller,
    target,
    argsXdr,
  };
  ops.set(opKey(chainId, call), {
    chainId,
    call,
    ...(loanId === undefined ? {} : { loanId }),
    ...Object.fromEntries(
      Object.entries(chain).filter(([, value]) => value !== undefined),
    ),
    scheduledAt: Date.now(),
    executedHere: false,
  });
  commit();
}

export function markOperationExecuted(
  chainId: number,
  operationId: string,
): void {
  const key = `${chainId}:${operationId}`;
  if (!executedIds.has(key)) {
    executedIds.add(key);
    executedSnapshot = Array.from(executedIds);
  }
  for (const [opId, op] of ops) {
    if (op.chainId === chainId && op.operationId === operationId) {
      ops.set(opId, { ...op, executedHere: true });
    }
  }
  commit();
}

export function markExecuted(chainId: number, call: CouncilCall): void {
  const key = opKey(chainId, call);
  const existing = ops.get(key);
  if (existing == null) return;
  ops.set(key, { ...existing, executedHere: true });
  commit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadonlyArray<ScheduledOp> {
  return snapshot;
}

function getExecutedSnapshot(): ReadonlyArray<string> {
  return executedSnapshot;
}

const chainSnapshots = new Map<
  number,
  { source: ReadonlyArray<ScheduledOp>; result: ScheduledOp[] }
>();

export function useScheduledOps(chainId: number): ReadonlyArray<ScheduledOp> {
  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const cached = chainSnapshots.get(chainId);
  if (cached != null && cached.source === all) return cached.result;
  const result = all.filter((op) => op.chainId === chainId);
  chainSnapshots.set(chainId, { source: all, result });
  return result;
}

const executedChainSnapshots = new Map<
  number,
  { source: ReadonlyArray<string>; result: ReadonlySet<string> }
>();

export function useExecutedOperationIds(chainId: number): ReadonlySet<string> {
  const all = useSyncExternalStore(
    subscribe,
    getExecutedSnapshot,
    getExecutedSnapshot,
  );
  const cached = executedChainSnapshots.get(chainId);
  if (cached != null && cached.source === all) return cached.result;
  const prefix = `${chainId}:`;
  const result = new Set(
    all
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length)),
  );
  executedChainSnapshots.set(chainId, { source: all, result });
  return result;
}

export function useScheduledOp(
  chainId: number,
  call: CouncilCall | null,
): ScheduledOp | undefined {
  const all = useScheduledOps(chainId);
  if (call == null) return undefined;
  const key = riskCouncilCallKey(call);
  return all.find((op) => riskCouncilCallKey(op.call) === key);
}

export function _resetRiskCouncilOpsForTests(): void {
  ops.clear();
  chainSnapshots.clear();
  snapshot = [];
  executedIds.clear();
  executedChainSnapshots.clear();
  executedSnapshot = [];
}
