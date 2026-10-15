// spec: docs/frontend/wallet-flows.md#network-switcher-cross-deployment-links
import { describe, it, expect, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    EVM_CHAIN_ID: 560048,
    NETWORK_LINKS: "",
  },
}));

vi.mock("@/lib/env", () => ({
  ENV: mockEnv,
}));

import { getNetworkSwitcherState, isMainnetNetwork } from "./networkSwitcher";

const LINKS =
  "mainnet=https://app.pipeline.one,testnet=https://pipeline.stage.eqlab.net";

describe("getNetworkSwitcherState", () => {
  it("returns the static-label case when NETWORK_LINKS is unset", () => {
    mockEnv.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    mockEnv.NETWORK_LINKS = "";

    const { currentNetwork, otherNetworks } =
      getNetworkSwitcherState("stellar");

    expect(currentNetwork).toEqual({ id: "testnet", label: "Testnet" });
    expect(otherNetworks).toEqual([]);
  });

  it("excludes the current network from otherNetworks", () => {
    mockEnv.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    mockEnv.NETWORK_LINKS = LINKS;

    const { currentNetwork, otherNetworks } =
      getNetworkSwitcherState("stellar");

    expect(currentNetwork).toEqual({ id: "testnet", label: "Testnet" });
    expect(otherNetworks).toEqual([
      { id: "mainnet", label: "Mainnet", url: "https://app.pipeline.one" },
    ]);
  });

  it("on Stellar mainnet, offers testnet as the other network", () => {
    mockEnv.STELLAR_NETWORK_PASSPHRASE =
      "Public Global Stellar Network ; September 2015";
    mockEnv.NETWORK_LINKS = LINKS;

    const { currentNetwork, otherNetworks } =
      getNetworkSwitcherState("stellar");

    expect(currentNetwork).toEqual({ id: "mainnet", label: "Mainnet" });
    expect(otherNetworks).toEqual([
      {
        id: "testnet",
        label: "Testnet",
        url: "https://pipeline.stage.eqlab.net",
      },
    ]);
  });

  it("in the EVM view, derives the identity from the EVM chain id", () => {
    mockEnv.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    mockEnv.EVM_CHAIN_ID = 1;
    mockEnv.NETWORK_LINKS = LINKS;

    const { currentNetwork, otherNetworks } = getNetworkSwitcherState("evm");

    expect(currentNetwork).toEqual({ id: "mainnet", label: "Mainnet" });
    expect(otherNetworks.map((l) => l.id)).toEqual(["testnet"]);
    mockEnv.EVM_CHAIN_ID = 560048;
  });
});

describe("isMainnetNetwork", () => {
  it("follows the Stellar passphrase in the Stellar view", () => {
    mockEnv.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    expect(isMainnetNetwork("stellar")).toBe(false);
    mockEnv.STELLAR_NETWORK_PASSPHRASE =
      "Public Global Stellar Network ; September 2015";
    expect(isMainnetNetwork("stellar")).toBe(true);
  });

  it("treats an unknown passphrase as testnet", () => {
    mockEnv.STELLAR_NETWORK_PASSPHRASE =
      "Test SDF Future Network ; October 2022";
    expect(isMainnetNetwork("stellar")).toBe(false);
  });

  it("follows the EVM chain id in the EVM view, independent of the passphrase", () => {
    mockEnv.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    mockEnv.EVM_CHAIN_ID = 1;
    expect(isMainnetNetwork("evm")).toBe(true);
    expect(isMainnetNetwork("stellar")).toBe(false);
    mockEnv.EVM_CHAIN_ID = 560048;
    expect(isMainnetNetwork("evm")).toBe(false);
  });
});
