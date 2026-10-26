// spec: docs/frontend/wallet-flows.md#request-state-model

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readInflightEvmRequest,
  writeInflightEvmRequest,
  clearInflightEvmRequest,
} from "./inflight";

const ADDRESS = "0xAbCd000000000000000000000000000000000001";
const ENTRY = {
  requestId: "12",
  amount: "2000000000",
  txHash: "0xdead",
  createdAt: 1_700_000_000_000,
};

describe("EVM in-flight request record", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("round-trips an entry per kind, chain and lowercased address", () => {
    writeInflightEvmRequest("deposit", 560048, ADDRESS, ENTRY);
    expect(readInflightEvmRequest("deposit", 560048, ADDRESS)).toEqual(ENTRY);
    expect(
      readInflightEvmRequest("deposit", 560048, ADDRESS.toLowerCase()),
    ).toEqual(ENTRY);
    expect(
      localStorage.getItem(
        `pipeline.evm.deposit.inflight.560048.${ADDRESS.toLowerCase()}`,
      ),
    ).not.toBeNull();
  });

  it("keeps deposit, withdraw and chains separate", () => {
    writeInflightEvmRequest("deposit", 560048, ADDRESS, ENTRY);
    expect(readInflightEvmRequest("withdraw", 560048, ADDRESS)).toBeUndefined();
    expect(readInflightEvmRequest("deposit", 1, ADDRESS)).toBeUndefined();
  });

  it("clear removes the entry", () => {
    writeInflightEvmRequest("withdraw", 560048, ADDRESS, ENTRY);
    clearInflightEvmRequest("withdraw", 560048, ADDRESS);
    expect(readInflightEvmRequest("withdraw", 560048, ADDRESS)).toBeUndefined();
  });

  it("returns undefined for malformed JSON or a wrong shape", () => {
    const key = `pipeline.evm.deposit.inflight.560048.${ADDRESS.toLowerCase()}`;
    localStorage.setItem(key, "{not json");
    expect(readInflightEvmRequest("deposit", 560048, ADDRESS)).toBeUndefined();
    localStorage.setItem(key, JSON.stringify({ requestId: 5 }));
    expect(readInflightEvmRequest("deposit", 560048, ADDRESS)).toBeUndefined();
    localStorage.setItem(key, "null");
    expect(readInflightEvmRequest("deposit", 560048, ADDRESS)).toBeUndefined();
  });

  it("swallows storage errors", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readInflightEvmRequest("deposit", 1, ADDRESS)).toBeUndefined();
    expect(() =>
      writeInflightEvmRequest("deposit", 1, ADDRESS, ENTRY),
    ).not.toThrow();
    expect(() => clearInflightEvmRequest("deposit", 1, ADDRESS)).not.toThrow();
  });
});
