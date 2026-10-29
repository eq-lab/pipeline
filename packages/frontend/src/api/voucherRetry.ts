// spec: docs/frontend/wallet-flows.md#request-state-model
import { useEffect, useState } from "react";

export const VOUCHER_RETRY_LIMIT = 20;
export const VOUCHER_POLL_MS = 3000;
export const VOUCHER_MIN_REFETCH_MS = 1000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export function isRetriableVoucherError(error: unknown): boolean {
  const msg = error instanceof Error ? (error.message ?? "") : "";
  return (
    msg.includes("Not Found") ||
    msg.includes("not found") ||
    msg.includes("Forbidden") ||
    msg.includes("forbidden") ||
    msg.includes("not yet")
  );
}

export function msUntilVoucherDeadline(
  deadline: string | undefined,
  nowMs: number,
): number | undefined {
  if (deadline === undefined || !/^\d+$/.test(deadline)) return undefined;
  return Number(BigInt(deadline) * 1000n - BigInt(Math.floor(nowMs)));
}

export function isVoucherExpired(
  deadline: string | undefined,
  nowMs: number,
): boolean {
  const ms = msUntilVoucherDeadline(deadline, nowMs);
  return ms !== undefined && ms <= 0;
}

export function voucherRefetchInterval(
  data: { signature?: string; deadline?: string } | undefined,
  error: unknown,
  nowMs: number,
): number | false {
  if (data?.signature) {
    const ms = msUntilVoucherDeadline(data.deadline, nowMs);
    if (ms === undefined) return false;
    if (ms <= 0) return VOUCHER_POLL_MS;
    return Math.min(Math.max(ms, VOUCHER_MIN_REFETCH_MS), MAX_TIMEOUT_MS);
  }
  if (error && !isRetriableVoucherError(error)) return false;
  return VOUCHER_POLL_MS;
}

export function useVoucherExpired(deadline: string | undefined): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    const ms = msUntilVoucherDeadline(deadline, Date.now());
    if (ms === undefined || ms <= 0) return;
    const id = setTimeout(
      () => setTick((t) => t + 1),
      Math.min(ms, MAX_TIMEOUT_MS),
    );
    return () => clearTimeout(id);
  }, [deadline]);
  return isVoucherExpired(deadline, Date.now());
}
