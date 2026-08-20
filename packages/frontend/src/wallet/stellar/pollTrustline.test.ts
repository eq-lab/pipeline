import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pollTrustlineUntilPresent } from "./pollTrustline";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pollTrustlineUntilPresent", () => {
  it("resolves true on the first attempt without sleeping", async () => {
    const refetch = vi.fn().mockResolvedValue({ hasTrustline: true });
    const result = await pollTrustlineUntilPresent(refetch);
    expect(result).toBe(true);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("retries until the trustline flips (stale-then-fresh)", async () => {
    const refetch = vi
      .fn()
      .mockResolvedValueOnce({ hasTrustline: false })
      .mockResolvedValueOnce({ hasTrustline: true });
    const promise = pollTrustlineUntilPresent(refetch);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await promise).toBe(true);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("stops at the attempt cap and resolves false without throwing", async () => {
    const refetch = vi.fn().mockResolvedValue({ hasTrustline: false });
    const promise = pollTrustlineUntilPresent(refetch, {
      attempts: 3,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await promise).toBe(false);
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it("treats an undefined snapshot (mock/unconfigured) as not present", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const promise = pollTrustlineUntilPresent(refetch, {
      attempts: 2,
      intervalMs: 500,
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(await promise).toBe(false);
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
