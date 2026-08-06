/**
 * Unit tests for the trustee app's `getNetworkSwitcherState` (issue #1032).
 *
 * Mirrors `packages/frontend/src/wallet/networkSwitcher.test.ts` — the
 * underlying parsing/identity logic is covered in
 * `@pipeline/wallet-connect`'s `network/links.test.ts`; these tests cover
 * only this module's composition: deriving the current network from env and
 * filtering it out of the sibling-links list.
 */
import { describe, it, expect, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    NETWORK_LINKS: "",
  },
}));

vi.mock("./env", () => ({
  ENV: mockEnv,
}));

import { getNetworkSwitcherState } from "./networkSwitcher";

describe("getNetworkSwitcherState (trustee)", () => {
  it("returns the static-label case (no other networks) when NETWORK_LINKS is unset", () => {
    mockEnv.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    mockEnv.NETWORK_LINKS = "";

    const { currentNetwork, otherNetworks } = getNetworkSwitcherState();

    expect(currentNetwork).toEqual({ id: "testnet", label: "Testnet" });
    expect(otherNetworks).toEqual([]);
  });

  it("excludes the current network from otherNetworks when links are configured", () => {
    mockEnv.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    mockEnv.NETWORK_LINKS =
      "mainnet=https://dashboard.pipeline.one,testnet=https://dashboard.pipeline.stage.eqlab.net";

    const { currentNetwork, otherNetworks } = getNetworkSwitcherState();

    expect(currentNetwork).toEqual({ id: "testnet", label: "Testnet" });
    expect(otherNetworks).toEqual([
      {
        id: "mainnet",
        label: "Mainnet",
        url: "https://dashboard.pipeline.one",
      },
    ]);
  });

  it("on a mainnet deployment, offers testnet as the other network", () => {
    mockEnv.STELLAR_NETWORK_PASSPHRASE =
      "Public Global Stellar Network ; September 2015";
    mockEnv.NETWORK_LINKS =
      "mainnet=https://dashboard.pipeline.one,testnet=https://dashboard.pipeline.stage.eqlab.net";

    const { currentNetwork, otherNetworks } = getNetworkSwitcherState();

    expect(currentNetwork).toEqual({ id: "mainnet", label: "Mainnet" });
    expect(otherNetworks).toEqual([
      {
        id: "testnet",
        label: "Testnet",
        url: "https://dashboard.pipeline.stage.eqlab.net",
      },
    ]);
  });
});
