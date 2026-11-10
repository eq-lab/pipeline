// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { useSyncExternalStore } from "react";
import type { RiskCouncilCall } from "@pipeline/wallet-connect";

export interface ScheduledOp {
  chainId: number;
  call: RiskCouncilCall;
  scheduledAt: number;
  executedHere: boolean;
}

const ops = new Map<string, ScheduledOp>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyArray<ScheduledOp> = [];

export function riskCouncilCallKey(call: RiskCouncilCall): string {
  return JSON.stringify(
    Object.keys(call)
      .sort()
      .map((key) => [key, (call as unknown as Record<string, unknown>)[key]]),
  );
}

function opKey(chainId: number, call: RiskCouncilCall): string {
  return `${chainId}:${riskCouncilCallKey(call)}`;
}

function commit(): void {
  snapshot = Array.from(ops.values());
  listeners.forEach((listener) => listener());
}

export function recordScheduledOp({
  chainId,
  call,
}: {
  chainId: number;
  call: RiskCouncilCall;
}): void {
  ops.set(opKey(chainId, call), {
    chainId,
    call,
    scheduledAt: Date.now(),
    executedHere: false,
  });
  commit();
}

export function markExecuted(chainId: number, call: RiskCouncilCall): void {
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

export function useScheduledOp(
  chainId: number,
  call: RiskCouncilCall | null,
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
}
