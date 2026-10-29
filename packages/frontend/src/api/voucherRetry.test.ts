/**
 * Tests for the shared voucher retry classification (#313).
 * spec: docs/frontend/wallet-flows.md#request-state-model
 */
import { describe, it, expect } from "vitest";
import {
  isRetriableVoucherError,
  isVoucherExpired,
  msUntilVoucherDeadline,
  VOUCHER_RETRY_LIMIT,
  voucherRefetchInterval,
} from "./voucherRetry";

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

describe("voucher deadline helpers", () => {
  const NOW = 1_800_000_000_000;

  it("isVoucherExpired is true only for a numeric deadline at or before now", () => {
    expect(isVoucherExpired("1799999999", NOW)).toBe(true);
    expect(isVoucherExpired("1800000000", NOW)).toBe(true);
    expect(isVoucherExpired("1800000001", NOW)).toBe(false);
    expect(isVoucherExpired(undefined, NOW)).toBe(false);
    expect(isVoucherExpired("", NOW)).toBe(false);
    expect(isVoucherExpired("abc", NOW)).toBe(false);
  });

  it("msUntilVoucherDeadline returns the signed distance in ms", () => {
    expect(msUntilVoucherDeadline("1800000060", NOW)).toBe(60_000);
    expect(msUntilVoucherDeadline("1799999990", NOW)).toBe(-10_000);
    expect(msUntilVoucherDeadline(undefined, NOW)).toBeUndefined();
    expect(msUntilVoucherDeadline("-5", NOW)).toBeUndefined();
  });

  it("voucherRefetchInterval schedules the deadline and polls past it", () => {
    const ok = { signature: "0xab", deadline: "1800000060" };
    expect(voucherRefetchInterval(ok, null, NOW)).toBe(60_000);
    expect(voucherRefetchInterval({ signature: "0xab" }, null, NOW)).toBe(
      false,
    );
    expect(
      voucherRefetchInterval({ signature: "0xab", deadline: "1" }, null, NOW),
    ).toBe(3000);
    expect(voucherRefetchInterval(undefined, null, NOW)).toBe(3000);
    expect(
      voucherRefetchInterval(
        undefined,
        new Error("Internal Server Error"),
        NOW,
      ),
    ).toBe(false);
  });
});
