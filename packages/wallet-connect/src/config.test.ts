import { describe, it, expect, afterEach } from "vitest";
import {
  setWalletConnectConfig,
  getWalletConnectConfig,
  _resetWalletConnectConfigForTests,
  type WalletConnectConfig,
} from "./config";

const SAMPLE: WalletConnectConfig = {
  evmChainId: 560048,
  evmRpcUrl: "https://example.invalid",
  walletConnectProjectId: "abc123",
  stellarNetworkPassphrase: "Test SDF Network ; September 2015",
  appName: "Test App",
  appDescription: "Test App Description",
};

describe("wallet-connect config", () => {
  afterEach(() => {
    // Restore a valid config so later test files (which assume the global
    // test-setup config is in place) aren't affected by module-state leakage.
    setWalletConnectConfig(SAMPLE);
  });

  it("throws when read before being set", () => {
    _resetWalletConnectConfigForTests();
    expect(() => getWalletConnectConfig()).toThrow(
      /setWalletConnectConfig\(\) must be called/,
    );
  });

  it("returns the config that was set", () => {
    setWalletConnectConfig(SAMPLE);
    expect(getWalletConnectConfig()).toEqual(SAMPLE);
  });
});
