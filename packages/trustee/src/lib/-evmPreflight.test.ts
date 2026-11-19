// spec: docs/frontend/trustee-flows.md#evm-1574
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  STELLAR_CHAIN_ID: 1001,
  EVM_CHAIN_ID: 560048,
  EVM_ACCESS_MANAGER_ADDRESS: "0xAccessManager",
  EVM_LOAN_REGISTRY_ADDRESS: "0xRegistry",
}));

vi.mock("@/lib/env", () => ({ ENV: envMock }));

import type { ChainWallet } from "./chainWallet";
import {
  EVM_WALLET_NOT_CONNECTED,
  evmLoanRegistryConfig,
  evmPreflight,
} from "./evmPreflight";
import { drawChainReason, loanActionChainReason } from "./targetChains";

const OTHER_CHAIN = 42;
const NOT_CONFIGURED = "not configured";

const connected: ChainWallet = {
  kind: "evm",
  address: "0xCaller",
  isConnected: true,
};

beforeEach(() => {
  envMock.EVM_ACCESS_MANAGER_ADDRESS = "0xAccessManager";
  envMock.EVM_LOAN_REGISTRY_ADDRESS = "0xRegistry";
});

describe("evmPreflight", () => {
  it("throws the chain gate before a missing config or a disconnected wallet", () => {
    expect(() =>
      evmPreflight({
        chainId: OTHER_CHAIN,
        wallet: { kind: "evm", address: undefined, isConnected: false },
        config: null,
        notConfigured: NOT_CONFIGURED,
      }),
    ).toThrow(loanActionChainReason(OTHER_CHAIN)!);
  });

  it("throws the config error before the wallet error", () => {
    expect(() =>
      evmPreflight({
        chainId: envMock.EVM_CHAIN_ID,
        wallet: { kind: "evm", address: undefined, isConnected: false },
        config: null,
        notConfigured: NOT_CONFIGURED,
      }),
    ).toThrow(NOT_CONFIGURED);
  });

  it("throws when the wallet is disconnected or has no address", () => {
    const base = {
      chainId: envMock.EVM_CHAIN_ID,
      config: { ok: true },
      notConfigured: NOT_CONFIGURED,
    };
    expect(() =>
      evmPreflight({
        ...base,
        wallet: { kind: "evm", address: "0xCaller", isConnected: false },
      }),
    ).toThrow(EVM_WALLET_NOT_CONNECTED);
    expect(() =>
      evmPreflight({
        ...base,
        wallet: { kind: "evm", address: undefined, isConnected: true },
      }),
    ).toThrow(EVM_WALLET_NOT_CONNECTED);
  });

  it("returns the config, the caller and the configured EVM chain id", () => {
    const config = { ok: true };
    expect(
      evmPreflight({
        chainId: envMock.EVM_CHAIN_ID,
        wallet: connected,
        config,
        notConfigured: NOT_CONFIGURED,
      }),
    ).toEqual({
      config,
      caller: "0xCaller",
      chainId: envMock.EVM_CHAIN_ID,
    });
  });

  it("uses a custom chain reason instead of the default", () => {
    expect(() =>
      evmPreflight({
        chainId: OTHER_CHAIN,
        wallet: connected,
        config: { ok: true },
        notConfigured: NOT_CONFIGURED,
        chainReason: drawChainReason,
      }),
    ).toThrow(drawChainReason(OTHER_CHAIN)!);
  });
});

describe("evmLoanRegistryConfig", () => {
  it("returns both addresses when set", () => {
    expect(evmLoanRegistryConfig()).toEqual({
      accessManager: "0xAccessManager",
      registry: "0xRegistry",
    });
  });

  it("returns null when either address is blank and reads ENV at call time", () => {
    envMock.EVM_ACCESS_MANAGER_ADDRESS = "";
    expect(evmLoanRegistryConfig()).toBeNull();
    envMock.EVM_ACCESS_MANAGER_ADDRESS = "0xAccessManager";
    envMock.EVM_LOAN_REGISTRY_ADDRESS = "";
    expect(evmLoanRegistryConfig()).toBeNull();
  });
});
