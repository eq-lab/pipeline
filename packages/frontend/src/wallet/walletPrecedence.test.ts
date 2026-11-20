// spec: docs/frontend/wallet-flows.md#single-connected-wallet
import { describe, expect, it } from "vitest";
import { walletPrecedence } from "./walletPrecedence";

describe("walletPrecedence", () => {
  it.each([
    ["both connected", true, true, "evm"],
    ["Stellar only", false, true, "stellar"],
    ["EVM only", true, false, "evm"],
    ["none", false, false, null],
  ])("%s", (_name, e, s, expected) => {
    expect(walletPrecedence({ isConnected: e }, { isConnected: s })).toBe(
      expected,
    );
  });
});
