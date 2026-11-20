// spec: docs/frontend/wallet-flows.md#activity-refresh-after-a-confirmed-action
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useEvmWallet, useStellarWallet, useWalletView } from "@/wallet";
import { ENV } from "@/lib/env";
import type { RequestItem, RequestType, RequestsResponse } from "./useRequests";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActivityExpectation = {
  wallet: string;
  chainId: number;
  type: RequestType;
  deadline: number;
} & ({ requestId: string; status?: "Completed" } | { baselineCount?: number });

export const ACTIVITY_POLL_MS = 3_000;
export const ACTIVITY_POLL_CAP_MS = 60_000;

// ── Expectation store ─────────────────────────────────────────────────────────

let expectations: readonly ActivityExpectation[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeExpectations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getExpectations(): readonly ActivityExpectation[] {
  return expectations;
}

export function addExpectation(e: ActivityExpectation): void {
  expectations = [...expectations, e];
  emit();
}

export function resetExpectationsForTests(): void {
  expectations = [];
  emit();
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function rowsOf(data: RequestsResponse | undefined): RequestItem[] {
  return data?.requests ?? [];
}

export function isExpectationMet(
  e: ActivityExpectation,
  data: RequestsResponse | undefined,
): boolean {
  const rows = rowsOf(data).filter((r) => r.type === e.type);
  if ("requestId" in e) {
    const row = rows.find(
      (r) =>
        r.request_id !== undefined &&
        String(r.request_id) === String(e.requestId),
    );
    if (!row) return false;
    return e.status === undefined ? true : row.status === e.status;
  }
  return e.baselineCount === undefined
    ? rows.length > 0
    : rows.length > e.baselineCount;
}

function isForScope(
  e: ActivityExpectation,
  wallet: string | undefined,
  chainId: number,
): boolean {
  return (
    wallet !== undefined &&
    e.chainId === chainId &&
    e.wallet.toLowerCase() === wallet.toLowerCase()
  );
}

export function openExpectationsFor(
  list: readonly ActivityExpectation[],
  wallet: string | undefined,
  chainId: number,
  data: RequestsResponse | undefined,
  now: number,
): ActivityExpectation[] {
  return list.filter(
    (e) =>
      isForScope(e, wallet, chainId) &&
      e.deadline > now &&
      !isExpectationMet(e, data),
  );
}

export function settleExpectations(
  data: RequestsResponse | undefined,
  wallet: string | undefined,
  chainId: number,
  now: number,
): boolean {
  let anyMet = false;
  const next = expectations.filter((e) => {
    if (e.deadline <= now) return false;
    if (isForScope(e, wallet, chainId) && isExpectationMet(e, data)) {
      anyMet = true;
      return false;
    }
    return true;
  });
  if (next.length !== expectations.length) {
    expectations = next;
    emit();
  }
  return anyMet;
}

// ── Active wallet scope ───────────────────────────────────────────────────────

export function useActiveRequestsScope() {
  const { kind } = useWalletView();
  const { address: evmAddress, isConnected: isEvmConnected } = useEvmWallet();
  const { address: stellarAddress, isConnected: isStellarConnected } =
    useStellarWallet();
  const address = kind === "stellar" ? stellarAddress : evmAddress;
  const isConnected = kind === "stellar" ? isStellarConnected : isEvmConnected;
  const chainId = kind === "stellar" ? ENV.STELLAR_CHAIN_ID : ENV.EVM_CHAIN_ID;
  return { kind, address, isConnected, chainId };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface ActionConfirmed {
  type: RequestType;
  requestId?: string | bigint;
  claimed?: boolean;
}

function isBalanceOfRead(queryKey: readonly unknown[]): boolean {
  if (queryKey[0] !== "readContract") return false;
  const params = queryKey[1] as { functionName?: string } | undefined;
  return params?.functionName === "balanceOf";
}

export function useActionConfirmedRefresh(): (a: ActionConfirmed) => void {
  const queryClient = useQueryClient();
  const { kind, address, chainId } = useActiveRequestsScope();

  return useCallback(
    ({ type, requestId, claimed }: ActionConfirmed) => {
      if (address) {
        const base = {
          wallet: address,
          chainId,
          type,
          deadline: Date.now() + ACTIVITY_POLL_CAP_MS,
        };
        if (requestId !== undefined) {
          addExpectation({
            ...base,
            requestId: String(requestId),
            ...(claimed ? { status: "Completed" as const } : {}),
          });
        } else {
          const cached = queryClient.getQueriesData<RequestsResponse>({
            queryKey: ["requests", kind, address, chainId],
          });
          const data = cached.find(([, d]) => d !== undefined)?.[1];
          addExpectation({
            ...base,
            baselineCount:
              data === undefined
                ? undefined
                : data.requests.filter((r) => r.type === type).length,
          });
        }
      }
      for (const key of [
        ["requests"],
        ["pnl"],
        ["positionsHistory"],
        ["stellarSacToken"],
        ["stellarUsdcBalance"],
        ["stellarStakedPlusdBalance"],
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      void queryClient.invalidateQueries({
        predicate: (q) => isBalanceOfRead(q.queryKey),
      });
    },
    [queryClient, kind, address, chainId],
  );
}
