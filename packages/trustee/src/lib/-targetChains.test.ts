import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  ENV: { EVM_CHAIN_ID: 560048, STELLAR_CHAIN_ID: 99_000_001 },
}));

import {
  chainAmountDecimals,
  DEFAULT_TARGET_CHAIN_ID,
  TARGET_CHAINS,
  isStellarTarget,
  servedTargetChains,
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

describe("servedTargetChains (#1667)", () => {
  const served = (ids: number[], def: number) => ({
    chains: ids.map((chain_id) => ({ chain_id })),
    default_chain_id: def,
  });

  it("is loading with no options while pending", () => {
    expect(servedTargetChains("pending", undefined)).toEqual({
      options: [],
      defaultChainId: null,
      isLoading: true,
    });
  });

  it("falls back to the env list and Stellar default on error", () => {
    expect(servedTargetChains("error", undefined)).toEqual({
      options: TARGET_CHAINS,
      defaultChainId: DEFAULT_TARGET_CHAIN_ID,
      isLoading: false,
    });
  });

  it("keeps env order and the served default when offered", () => {
    const result = servedTargetChains(
      "success",
      served([560048, 99_000_001, 7], 560048),
    );
    expect(result.options).toEqual(TARGET_CHAINS);
    expect(result.defaultChainId).toBe(560048);
    expect(result.isLoading).toBe(false);
  });

  it("drops unserved chains and falls back to the first option when the default is not offered", () => {
    const result = servedTargetChains("success", served([99_000_001], 560048));
    expect(result.options).toEqual([{ id: 99_000_001, label: "Stellar" }]);
    expect(result.defaultChainId).toBe(99_000_001);
  });

  it("yields no options and no default for an empty intersection", () => {
    expect(servedTargetChains("success", served([1], 1))).toEqual({
      options: [],
      defaultChainId: null,
      isLoading: false,
    });
  });
});
