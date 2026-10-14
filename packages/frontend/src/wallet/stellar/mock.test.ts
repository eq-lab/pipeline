import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  STELLAR_MOCK_KEYS,
  parseStellarAddress,
  readMockStellarAddress,
  readMockStellarIsConnected,
  useBothWalletMocksConnected,
  _resetBothMocksWarningForTests,
} from "./mock";
import { readMock, parseBoolean } from "../evm/mock";

// ── parseStellarAddress ────────────────────────────────────────────────────────

describe("parseStellarAddress", () => {
  it("accepts a valid G… 56-char strkey", () => {
    const key = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    expect(parseStellarAddress(key)).toBe(key);
  });

  it("rejects an EVM 0x… address", () => {
    expect(() =>
      parseStellarAddress("0x1234000000000000000000000000000000000000"),
    ).toThrow();
  });

  it("rejects a G… key that is too short", () => {
    expect(() => parseStellarAddress("GSHORT")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => parseStellarAddress("")).toThrow();
  });
});

// ── Key constants ──────────────────────────────────────────────────────────────

describe("STELLAR_MOCK_KEYS constants", () => {
  it("address key matches expected pattern", () => {
    expect(STELLAR_MOCK_KEYS.address).toBe(
      "pipeline.mock.wallet.stellar.address",
    );
  });

  it("isConnected key matches expected pattern", () => {
    expect(STELLAR_MOCK_KEYS.isConnected).toBe(
      "pipeline.mock.wallet.stellar.isConnected",
    );
  });

  it("balanceUsdc key matches expected pattern", () => {
    expect(STELLAR_MOCK_KEYS.balanceUsdc).toBe(
      "pipeline.mock.wallet.stellar.balance.usdc",
    );
  });
});

// ── readMockStellarAddress ─────────────────────────────────────────────────────

describe("readMockStellarAddress", () => {
  beforeEach(() => localStorage.clear());

  it("returns undefined when key is absent", () => {
    expect(readMockStellarAddress()).toBeUndefined();
  });

  it("returns the address when key is a valid G… strkey", () => {
    const key = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    localStorage.setItem(STELLAR_MOCK_KEYS.address, key);
    expect(readMockStellarAddress()).toBe(key);
  });

  it("returns undefined when key contains an EVM address (parse throws → undefined)", () => {
    localStorage.setItem(
      STELLAR_MOCK_KEYS.address,
      "0x1234000000000000000000000000000000000000",
    );
    expect(readMockStellarAddress()).toBeUndefined();
  });
});

// ── readMockStellarIsConnected ─────────────────────────────────────────────────

describe("readMockStellarIsConnected", () => {
  beforeEach(() => localStorage.clear());

  it("returns undefined when key is absent", () => {
    expect(readMockStellarIsConnected()).toBeUndefined();
  });

  it("returns true when key is 'true'", () => {
    localStorage.setItem(STELLAR_MOCK_KEYS.isConnected, "true");
    expect(readMockStellarIsConnected()).toBe(true);
  });

  it("returns false when key is 'false'", () => {
    localStorage.setItem(STELLAR_MOCK_KEYS.isConnected, "false");
    expect(readMockStellarIsConnected()).toBe(false);
  });
});

// ── Shared parse helpers reuse ─────────────────────────────────────────────────

describe("readMock with parseBoolean (shared from evm/mock)", () => {
  beforeEach(() => localStorage.clear());

  it("parses isConnected key correctly", () => {
    localStorage.setItem(STELLAR_MOCK_KEYS.isConnected, "true");
    expect(readMock(STELLAR_MOCK_KEYS.isConnected, parseBoolean)).toBe(true);
  });
});

describe("useBothWalletMocksConnected (#1512)", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetBothMocksWarningForTests();
  });

  const evmKeys = () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000001",
    );
  };
  const stellarKeys = () => {
    localStorage.setItem(
      STELLAR_MOCK_KEYS.address,
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    );
  };

  it("is false when only one chain is mocked", () => {
    evmKeys();
    const { result } = renderHook(() => useBothWalletMocksConnected());
    expect(result.current).toBe(false);
  });

  it("is true with a single warning when both chains are mocked connected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    evmKeys();
    stellarKeys();
    const { result, rerender } = renderHook(() =>
      useBothWalletMocksConnected(),
    );
    rerender();
    expect(result.current).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("is false when one mock is explicitly disconnected", () => {
    evmKeys();
    stellarKeys();
    localStorage.setItem(STELLAR_MOCK_KEYS.isConnected, "false");
    const { result } = renderHook(() => useBothWalletMocksConnected());
    expect(result.current).toBe(false);
  });
});
