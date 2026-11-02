// spec: docs/product-specs/staking.md#default-pockets
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  claimPocket: vi.fn(),
  wallet: { address: "GHOLDER" as string | undefined, isConnected: true },
  sign: vi.fn(),
  chain: { pocketId: "CPOCKET" },
}));

vi.mock("@pipeline/wallet-connect", () => ({
  claimPocket: (...a: unknown[]) => h.claimPocket(...a),
}));
vi.mock("./useStellarWallet", () => ({
  useStellarWallet: () => ({ ...h.wallet, signTransaction: h.sign }),
}));
vi.mock("./chain", () => ({
  get pocketId() {
    return h.chain.pocketId;
  },
  networkPassphrase: "PASS",
  sorobanRpcUrl: "https://rpc",
}));

import { useStellarPocketClaim } from "./useStellarPocketClaim";

beforeEach(() => {
  vi.clearAllMocks();
  h.wallet = { address: "GHOLDER", isConnected: true };
  h.chain.pocketId = "CPOCKET";
});

describe("useStellarPocketClaim", () => {
  it("claims as the holder and exposes the returned amount", async () => {
    h.claimPocket.mockResolvedValue({ hash: "tx", amount: "42" });
    const { result } = renderHook(() => useStellarPocketClaim());
    act(() => result.current.claim("7"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.loanId).toBe("7");
    expect(result.current.amountRaw).toBe("42");
    expect(result.current.hash).toBe("tx");
    expect(h.claimPocket).toHaveBeenCalledWith({
      pocketId: "CPOCKET",
      holder: "GHOLDER",
      loanId: 7,
      rpcUrl: "https://rpc",
      networkPassphrase: "PASS",
      signTransaction: h.sign,
    });
  });

  it("ignores a second claim while one is in flight", async () => {
    let resolve: (v: unknown) => void = () => {};
    h.claimPocket.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useStellarPocketClaim());
    act(() => result.current.claim("1"));
    act(() => result.current.claim("2"));
    expect(h.claimPocket).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(true);
    await act(async () => resolve({ hash: "tx", amount: null }));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.amountRaw).toBeUndefined();
  });

  it("surfaces a rejection and reset clears it", async () => {
    h.claimPocket.mockRejectedValue(new Error("User rejected"));
    const { result } = renderHook(() => useStellarPocketClaim());
    act(() => result.current.claim("1"));
    await waitFor(() =>
      expect(result.current.error?.message).toBe("User rejected"),
    );
    expect(result.current.isSuccess).toBe(false);
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
  });

  it("errors without a connected wallet or pocket", () => {
    h.wallet = { address: undefined, isConnected: false };
    const a = renderHook(() => useStellarPocketClaim());
    act(() => a.result.current.claim("1"));
    expect(a.result.current.error?.message).toMatch(/not connected/);
    h.wallet = { address: "GHOLDER", isConnected: true };
    h.chain.pocketId = "";
    const b = renderHook(() => useStellarPocketClaim());
    act(() => b.result.current.claim("1"));
    expect(b.result.current.error?.message).toMatch(/not configured/);
    expect(h.claimPocket).not.toHaveBeenCalled();
  });
});
