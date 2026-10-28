// spec: docs/frontend/wallet-flows.md#wallet-namespace-labels
import { describe, expect, it } from "vitest";
import { namespaceLabel } from "./namespaceLabel";

describe("namespaceLabel", () => {
  it("labels both Stellar kinds as Stellar, never Soroban", () => {
    expect(namespaceLabel("stellar")).toBe("Stellar");
    expect(namespaceLabel("soroban")).toBe("Stellar");
  });

  it("labels EVM as Ethereum without a chain id", () => {
    expect(namespaceLabel("evm")).toBe("Ethereum");
  });

  it("uses the known EVM chain name when a chain id is given", () => {
    expect(namespaceLabel("evm", 560048)).toBe("Hoodi");
  });

  it("falls back to Ethereum for an unknown chain id", () => {
    expect(namespaceLabel("evm", 999999)).toBe("Ethereum");
  });
});
