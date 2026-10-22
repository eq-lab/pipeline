import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  ENV: { EVM_CHAIN_ID: 560048, STELLAR_CHAIN_ID: 99_000_001 },
}));

import {
  chainAmountDecimals,
  DEFAULT_TARGET_CHAIN_ID,
  TARGET_CHAINS,
  isStellarTarget,
  targetChainLabel,
} from "./targetChains";

describe("targetChains (#1536)", () => {
  it("offers the deployment's Stellar and EVM chains, Stellar first and default", () => {
    expect(TARGET_CHAINS).toEqual([
      { id: 99_000_001, label: "Stellar" },
      { id: 560048, label: "Hoodi" },
    ]);
    expect(DEFAULT_TARGET_CHAIN_ID).toBe(99_000_001);
  });

  it("labels configured ids, falls back to 'Chain <id>' and '—'", () => {
    expect(targetChainLabel(99_000_001)).toBe("Stellar");
    expect(targetChainLabel(560048)).toBe("Hoodi");
    expect(targetChainLabel(1)).toBe("Chain 1");
    expect(targetChainLabel(null)).toBe("—");
    expect(targetChainLabel(undefined)).toBe("—");
  });

  it("isStellarTarget is true for the Stellar id and for a missing id, false for EVM", () => {
    expect(isStellarTarget(99_000_001)).toBe(true);
    expect(isStellarTarget(undefined)).toBe(true);
    expect(isStellarTarget(560048)).toBe(false);
  });
});

describe("chainAmountDecimals (#1603)", () => {
  it("is 7 for the Stellar chain and 6 for an EVM chain", () => {
    expect(chainAmountDecimals(99_000_001)).toBe(7);
    expect(chainAmountDecimals(560048)).toBe(6);
    expect(chainAmountDecimals(1)).toBe(6);
    expect(chainAmountDecimals(null)).toBe(7);
  });
});
