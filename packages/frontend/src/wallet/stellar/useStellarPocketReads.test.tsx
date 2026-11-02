// spec: docs/product-specs/staking.md#default-pockets
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  readPocket: vi.fn(),
  claimable: vi.fn(),
  claimed: vi.fn(),
  chain: { pocketId: "CPOCKET" },
}));

vi.mock("@pipeline/wallet-connect", () => ({
  readPocket: (...a: unknown[]) => h.readPocket(...a),
  readPocketClaimable: (...a: unknown[]) => h.claimable(...a),
  readPocketClaimed: (...a: unknown[]) => h.claimed(...a),
}));
vi.mock("./chain", () => ({
  get pocketId() {
    return h.chain.pocketId;
  },
  networkPassphrase: "PASS",
  sorobanRpcUrl: "https://rpc",
}));

import { useStellarPocketReads } from "./useStellarPocketReads";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.chain.pocketId = "CPOCKET";
});

describe("useStellarPocketReads", () => {
  it("reads pocket, claimable and claimed per loan, passing raw values through", async () => {
    h.readPocket.mockResolvedValue({ balance: "5000000" });
    h.claimable.mockResolvedValue("1200000");
    h.claimed.mockResolvedValue("0");
    const { result } = renderHook(
      () => useStellarPocketReads(["3"], "GHOLDER"),
      { wrapper },
    );
    await waitFor(() => expect(result.current["3"]?.claimedRaw).toBe("0"));
    expect(result.current["3"]).toEqual({
      exists: true,
      balanceRaw: "5000000",
      claimableRaw: "1200000",
      claimedRaw: "0",
      error: null,
    });
    expect(h.claimable).toHaveBeenCalledWith({
      pocketId: "CPOCKET",
      holder: "GHOLDER",
      loanId: 3,
      rpcUrl: "https://rpc",
      networkPassphrase: "PASS",
    });
  });

  it("marks an absent pocket and never reads the holder amounts for it", async () => {
    h.readPocket.mockResolvedValue(null);
    const { result } = renderHook(
      () => useStellarPocketReads(["4"], "GHOLDER"),
      { wrapper },
    );
    await waitFor(() => expect(result.current["4"]?.exists).toBe(false));
    expect(result.current["4"]?.error).toBeNull();
    expect(h.claimable).not.toHaveBeenCalled();
    expect(h.claimed).not.toHaveBeenCalled();
  });

  it("isolates a per-loan failure", async () => {
    h.readPocket.mockImplementation(({ loanId }: { loanId: number }) =>
      loanId === 1
        ? Promise.resolve({ balance: "1" })
        : Promise.reject(new Error("rpc down")),
    );
    h.claimable.mockResolvedValue("0");
    h.claimed.mockResolvedValue("0");
    const { result } = renderHook(
      () => useStellarPocketReads(["1", "2"], "GHOLDER"),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current["2"]?.error?.message).toBe("rpc down"),
    );
    expect(result.current["2"]?.exists).toBeUndefined();
    await waitFor(() => expect(result.current["1"]?.exists).toBe(true));
  });

  it("skips holder reads without a holder", async () => {
    h.readPocket.mockResolvedValue({ balance: "1" });
    const { result } = renderHook(
      () => useStellarPocketReads(["1"], undefined),
      { wrapper },
    );
    await waitFor(() => expect(result.current["1"]?.exists).toBe(true));
    expect(h.claimable).not.toHaveBeenCalled();
  });

  it("does not read when disabled or unconfigured", async () => {
    renderHook(() => useStellarPocketReads(["1"], "G", { enabled: false }), {
      wrapper,
    });
    h.chain.pocketId = "";
    renderHook(() => useStellarPocketReads(["1"], "G"), { wrapper });
    await Promise.resolve();
    expect(h.readPocket).not.toHaveBeenCalled();
  });
});
