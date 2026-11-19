// spec: docs/frontend/trustee-flows.md#repayment-recovery-1711
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadEnv() {
  vi.resetModules();
  return (await import("./env")).ENV;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("ENV.EVM_START_BLOCK", () => {
  it("defaults to 0", async () => {
    vi.stubEnv("VITE_EVM_START_BLOCK", "");
    expect((await loadEnv()).EVM_START_BLOCK).toBe(0);
  });

  it("accepts a non-negative integer", async () => {
    vi.stubEnv("VITE_EVM_START_BLOCK", "4000000");
    expect((await loadEnv()).EVM_START_BLOCK).toBe(4_000_000);
  });

  it.each(["1.5", "-1", "abc"])(
    "rejects %s with a clear config error",
    async (value) => {
      vi.stubEnv("VITE_EVM_START_BLOCK", value);
      await expect(loadEnv()).rejects.toThrow(/VITE_EVM_START_BLOCK/);
    },
  );
});

describe("ENV.EVM_DEAL_TOKEN_FACTORY_ADDRESS", () => {
  it("defaults to empty", async () => {
    vi.stubEnv("VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS", "");
    expect((await loadEnv()).EVM_DEAL_TOKEN_FACTORY_ADDRESS).toBe("");
  });

  it("reads the configured address", async () => {
    vi.stubEnv(
      "VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS",
      "0xCf54e4d3ffcfFC663058b6966D9B8578d988eCDC",
    );
    expect((await loadEnv()).EVM_DEAL_TOKEN_FACTORY_ADDRESS).toBe(
      "0xCf54e4d3ffcfFC663058b6966D9B8578d988eCDC",
    );
  });
});
