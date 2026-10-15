// spec: docs/frontend/wallet-flows.md#chain-registry
import { describe, it, expect, beforeEach } from "vitest";
import { getEvmChain, _resetEvmChainForTests } from "./chain";
import {
  setWalletConnectConfig,
  _resetWalletConnectConfigForTests,
} from "../config";

describe("getEvmChain", () => {
  beforeEach(() => {
    _resetEvmChainForTests();
    _resetWalletConnectConfigForTests();
  });

  it("throws before the config is set", () => {
    expect(() => getEvmChain()).toThrow();
  });

  it("reports Ethereum for chain id 1", () => {
    setWalletConnectConfig({
      evmChainId: 1,
      evmRpcUrl: "https://rpc.example",
      walletConnectProjectId: "p",
      stellarNetworkPassphrase: "x",
      appName: "a",
      appDescription: "d",
    });
    const chain = getEvmChain();
    expect(chain.name).toBe("Ethereum");
    expect(chain.testnet).toBe(false);
  });
});
