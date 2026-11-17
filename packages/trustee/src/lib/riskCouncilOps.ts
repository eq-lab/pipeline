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
export interface ExecutedOperation {
  operationId: string;
  hash: string;
  readyAt: number | null;
  executedAt: number;
}

const executed = new Map<string, ExecutedOperation>();
let servedByChain: ReadonlyMap<number, ReadonlySet<string>> = new Map();
const NO_IDS: ReadonlySet<string> = new Set();
let executedSnapshot: ReadonlyArray<[string, ExecutedOperation]> = [];
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

function recordExecuted(
  chainId: number,
  operationId: string,
  hash: string,
  readyAt: number | null,
): void {
  executed.set(`${chainId}:${operationId}`, {
    operationId,
    hash,
    readyAt,
    executedAt: Date.now(),
  });
  executedSnapshot = Array.from(executed.entries());
}

export function markOperationExecuted(
  chainId: number,
  operationId: string,
  hash: string,
  readyAt: number | null = null,
): void {
  let knownReadyAt = readyAt;
  for (const [opId, op] of ops) {
    if (op.chainId === chainId && op.operationId === operationId) {
      knownReadyAt ??= op.readyAt ?? null;
      ops.set(opId, { ...op, executedHere: true });
    }
  }
  recordExecuted(chainId, operationId, hash, knownReadyAt);
  commit();
}

export function markExecuted(
  chainId: number,
  call: CouncilCall,
  hash?: string,
): void {
  const key = opKey(chainId, call);
  const existing = ops.get(key);
  if (existing == null) return;
  ops.set(key, { ...existing, executedHere: true });
  if (existing.operationId != null && hash !== undefined) {
    recordExecuted(
      chainId,
      existing.operationId,
      hash,
      existing.readyAt ?? null,
    );
  }
  commit();
}

export function recordServedOperations(
  chainId: number,
  operationIds: Iterable<string>,
): void {
  const known = servedByChain.get(chainId) ?? NO_IDS;
  const added = Array.from(operationIds).filter((id) => !known.has(id));
  if (added.length === 0) return;
  servedByChain = new Map(servedByChain).set(
    chainId,
    new Set([...known, ...added]),
  );
  listeners.forEach((listener) => listener());
}

export function pruneExecutedOperations(
  chainId: number,
  servedReadyAtById: ReadonlyMap<string, number>,
  servedFetchedAt: number,
): void {
  let changed = false;
  for (const [key, entry] of executed) {
    if (!key.startsWith(`${chainId}:`)) continue;
    const servedReadyAt = servedReadyAtById.get(entry.operationId);
    const stale =
      servedFetchedAt > entry.executedAt &&
      (servedReadyAt === undefined ||
        (entry.readyAt !== null && servedReadyAt !== entry.readyAt));
    if (stale) {
      executed.delete(key);
      changed = true;
    }
  }
  if (changed) {
    executedSnapshot = Array.from(executed.entries());
    commit();
  }
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

function getServedSnapshot(): ReadonlyMap<number, ReadonlySet<string>> {
  return servedByChain;
}

export function useServedOperationIds(chainId: number): ReadonlySet<string> {
  const all = useSyncExternalStore(
    subscribe,
    getServedSnapshot,
    getServedSnapshot,
  );
  return all.get(chainId) ?? NO_IDS;
}

function getExecutedSnapshot(): ReadonlyArray<[string, ExecutedOperation]> {
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
  {
    source: ReadonlyArray<[string, ExecutedOperation]>;
    result: ReadonlyMap<string, ExecutedOperation>;
  }
>();

export function useExecutedOperations(
  chainId: number,
): ReadonlyMap<string, ExecutedOperation> {
  const all = useSyncExternalStore(
    subscribe,
    getExecutedSnapshot,
    getExecutedSnapshot,
  );
  const cached = executedChainSnapshots.get(chainId);
  if (cached != null && cached.source === all) return cached.result;
  const prefix = `${chainId}:`;
  const result = new Map(
    all
      .filter(([key]) => key.startsWith(prefix))
      .map(([, entry]) => [entry.operationId, entry] as const),
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
  executed.clear();
  servedByChain = new Map();
  executedChainSnapshots.clear();
  executedSnapshot = [];
}
