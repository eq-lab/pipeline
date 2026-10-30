// spec: docs/frontend/wallet-flows.md#withdrawal-queue-reads
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { chain, client } = vi.hoisted(() => ({
  chain: { withdrawalQueueId: "CQUEUE" },
  client: {
    totalQueued: vi.fn(),
    totalClaimed: vi.fn(),
    rate: vi.fn(),
    paused: vi.fn(),
    withdrawalRequestQueued: vi.fn(),
    claimable: vi.fn(),
    simulateClaimPayout: vi.fn(),
  },
}));

vi.mock("./chain", () => ({
  get withdrawalQueueId() {
    return chain.withdrawalQueueId;
  },
}));
vi.mock("./contracts/withdrawalQueue", () => ({
  createWithdrawalQueueClient: () => client,
}));

import {
  useStellarClaimPayout,
  useStellarWithdrawalQueueTotals,
  useStellarWithdrawalRequestQueueState,
} from "./useStellarWithdrawalQueueReads";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  chain.withdrawalQueueId = "CQUEUE";
  client.totalQueued.mockResolvedValue(10_000_000_000n);
  client.totalClaimed.mockResolvedValue(5n);
  client.rate.mockResolvedValue(950_000n);
  client.paused.mockResolvedValue(false);
  client.withdrawalRequestQueued.mockResolvedValue(77n);
  client.claimable.mockResolvedValue(true);
  client.simulateClaimPayout.mockResolvedValue(9_500_000n);
});

describe("useStellarWithdrawalQueueTotals", () => {
  it("passes the contract values through untouched", async () => {
    const { result } = renderHook(() => useStellarWithdrawalQueueTotals(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.paused).toBe(false));
    await waitFor(() => expect(result.current.rate).toBe(950_000n));
    expect(result.current.totalQueued).toBe(10_000_000_000n);
    expect(result.current.totalClaimed).toBe(5n);
  });

  it("makes no read when disabled or unconfigured", () => {
    renderHook(() => useStellarWithdrawalQueueTotals({ enabled: false }), {
      wrapper,
    });
    chain.withdrawalQueueId = "";
    renderHook(() => useStellarWithdrawalQueueTotals(), { wrapper });
    expect(client.totalQueued).not.toHaveBeenCalled();
    expect(client.rate).not.toHaveBeenCalled();
  });
});

describe("useStellarWithdrawalRequestQueueState", () => {
  it("reads position and claimable for the request id", async () => {
    const { result } = renderHook(
      () => useStellarWithdrawalRequestQueueState(4n),
      { wrapper },
    );
    await waitFor(() => expect(result.current.claimable).toBe(true));
    await waitFor(() => expect(result.current.position).toBe(77n));
    expect(client.claimable).toHaveBeenCalledWith(4n);
  });

  it("stays idle without a request id or when disabled", () => {
    renderHook(() => useStellarWithdrawalRequestQueueState(undefined), {
      wrapper,
    });
    renderHook(
      () => useStellarWithdrawalRequestQueueState(4n, { enabled: false }),
      { wrapper },
    );
    expect(client.claimable).not.toHaveBeenCalled();
  });
});

describe("useStellarClaimPayout", () => {
  const args = {
    requestId: 4n,
    signatureBytes: new Uint8Array(64),
    deadline: 99n,
    sender: "GSENDER",
  };

  it("returns the simulated payout", async () => {
    const { result } = renderHook(() => useStellarClaimPayout(args), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBe(9_500_000n));
    expect(client.simulateClaimPayout).toHaveBeenCalledWith(
      "GSENDER",
      4n,
      args.signatureBytes,
      99n,
    );
  });

  it("does not simulate while disabled or without a voucher", () => {
    renderHook(() => useStellarClaimPayout({ ...args, enabled: false }), {
      wrapper,
    });
    renderHook(
      () => useStellarClaimPayout({ ...args, signatureBytes: undefined }),
      { wrapper },
    );
    expect(client.simulateClaimPayout).not.toHaveBeenCalled();
  });

  it("exposes undefined data when the simulation fails", async () => {
    client.simulateClaimPayout.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useStellarClaimPayout(args), {
      wrapper,
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeUndefined();
  });
});
