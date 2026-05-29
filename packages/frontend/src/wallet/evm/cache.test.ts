import { describe, it, expect } from "vitest";
import { CACHE_FOREVER } from "./cache";

describe("CACHE_FOREVER", () => {
  it("has staleTime and gcTime set to Infinity", () => {
    expect(CACHE_FOREVER.staleTime).toBe(Infinity);
    expect(CACHE_FOREVER.gcTime).toBe(Infinity);
  });

  it("disables all automatic refetch triggers", () => {
    expect(CACHE_FOREVER.refetchOnMount).toBe(false);
    expect(CACHE_FOREVER.refetchOnWindowFocus).toBe(false);
    expect(CACHE_FOREVER.refetchOnReconnect).toBe(false);
    expect(CACHE_FOREVER.refetchInterval).toBe(false);
  });
});
