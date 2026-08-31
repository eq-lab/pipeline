/**
 * Tests for the shared voucher retry classification (#313).
 * spec: docs/frontend/wallet-flows.md#request-state-model
 */
import { describe, it, expect } from "vitest";
import { isRetriableVoucherError, VOUCHER_RETRY_LIMIT } from "./voucherRetry";

describe("isRetriableVoucherError", () => {
  it.each([
    "404 Not Found",
    "voucher not found",
    "403 Forbidden",
    "request forbidden",
    "voucher not yet available",
  ])("retriable: %s", (msg) => {
    expect(isRetriableVoucherError(new Error(msg))).toBe(true);
  });

  it.each([
    "409 Conflict: already claimed",
    "Internal Server Error",
    "signing failed",
    "",
  ])("non-retriable: %s", (msg) => {
    expect(isRetriableVoucherError(new Error(msg))).toBe(false);
  });

  it("non-Error values are non-retriable", () => {
    expect(isRetriableVoucherError(undefined)).toBe(false);
    expect(isRetriableVoucherError("Not Found")).toBe(false);
  });

  it("retry limit stays at the historical cap", () => {
    expect(VOUCHER_RETRY_LIMIT).toBe(20);
  });
});
