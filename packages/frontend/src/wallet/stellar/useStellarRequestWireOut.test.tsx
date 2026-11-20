// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  requestWireOut: vi.fn(),
  wallet: { address: "GLP" as string | undefined, isConnected: true },
  sign: vi.fn(),
  chain: { minterId: "CMINTER" },
}));

vi.mock("@pipeline/wallet-connect", () => ({
  requestWireOut: (...a: unknown[]) => h.requestWireOut(...a),
}));
vi.mock("./useStellarWallet", () => ({
  useStellarWallet: () => ({ ...h.wallet, signTransaction: h.sign }),
}));
vi.mock("./chain", () => ({
  get minterId() {
    return h.chain.minterId;
  },
  networkPassphrase: "PASS",
  sorobanRpcUrl: "https://rpc",
}));

import { useStellarRequestWireOut } from "./useStellarRequestWireOut";

beforeEach(() => {
  vi.clearAllMocks();
  h.wallet = { address: "GLP", isConnected: true };
  h.chain.minterId = "CMINTER";
});

describe("useStellarRequestWireOut", () => {
  it("returns the id on success and calls the shared binding as the LP", async () => {
    h.requestWireOut.mockResolvedValue({ hash: "tx", wireOutId: 0 });
    const { result } = renderHook(() => useStellarRequestWireOut());
    act(() => result.current.request(25n));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.wireOutId).toBe("0");
    expect(result.current.hash).toBe("tx");
    expect(h.requestWireOut).toHaveBeenCalledWith({
      minterId: "CMINTER",
      lp: "GLP",
      amountRaw: 25n,
      rpcUrl: "https://rpc",
      networkPassphrase: "PASS",
      signTransaction: h.sign,
    });
  });

  it("surfaces a wallet rejection and reset clears it", async () => {
    h.requestWireOut.mockRejectedValue(new Error("User rejected"));
    const { result } = renderHook(() => useStellarRequestWireOut());
    act(() => result.current.request(25n));
    await waitFor(() =>
      expect(result.current.error?.message).toBe("User rejected"),
    );
    expect(result.current.isSuccess).toBe(false);
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
  });

  it("errors without a connected wallet or minter", () => {
    h.wallet = { address: undefined, isConnected: false };
    const a = renderHook(() => useStellarRequestWireOut());
    act(() => a.result.current.request(1n));
    expect(a.result.current.error?.message).toMatch(/not connected/);
    h.wallet = { address: "GLP", isConnected: true };
    h.chain.minterId = "";
    const b = renderHook(() => useStellarRequestWireOut());
    act(() => b.result.current.request(1n));
    expect(b.result.current.error?.message).toMatch(/not configured/);
    expect(h.requestWireOut).not.toHaveBeenCalled();
  });
});
