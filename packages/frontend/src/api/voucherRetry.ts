/**
 * Shared voucher-polling retry classification (#313): 404/403 "not yet" states
 * keep polling; anything else stops both retry and refetchInterval.
 * spec: docs/frontend/wallet-flows.md#request-state-model
 */

export const VOUCHER_RETRY_LIMIT = 20;

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
