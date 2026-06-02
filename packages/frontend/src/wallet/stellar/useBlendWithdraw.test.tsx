/**
 * Unit tests for `useBlendWithdraw`.
 *
 * All Soroban RPC calls are mocked — no real network.
 *
 * Scenarios:
 *   1. Mock key set → write returns { hash }, isPending→isSuccess, submitBlendTx NOT called.
 *   2. Disconnected → write sets "not connected" error, no submit call.
 *   3. Real path → write calls submitBlendTx with WithdrawCollateral, isPending→isSuccess.
 *   4. Real path error → error is surfaced via `error`.
 *   5. reset() clears state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBlendWithdraw } from "./useBlendWithdraw";

// ── Hoisted spies ─────────────────────────────────────────────────────────────

const { mockSubmitBlendTx, mockBuildSubmitOpXdr } = vi.hoisted(() => ({
  mockSubmitBlendTx: vi.fn(),
  mockBuildSubmitOpXdr: vi.fn().mockReturnValue("op-xdr"),
}));

// ── Mock ./blendPool ──────────────────────────────────────────────────────────

vi.mock("./blendPool", () => ({
  buildSubmitOpXdr: mockBuildSubmitOpXdr,
  submitBlendTx: mockSubmitBlendTx,
  RequestType: {
    SupplyCollateral: 2,
    WithdrawCollateral: 3,
  },
}));

// ── Mock ./useStellarWallet ───────────────────────────────────────────────────

const { mockSignTransaction, mockStellarWallet } = vi.hoisted(() => {
  const mockSignTransaction = vi.fn();
  return {
    mockSignTransaction,
    mockStellarWallet: {
      address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" as
        | string
        | undefined,
      isConnected: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      signTransaction: mockSignTransaction,
    },
  };
});

vi.mock("./useStellarWallet", () => ({
  useStellarWallet: () => ({ ...mockStellarWallet }),
}));

// ── Mock ./chain ──────────────────────────────────────────────────────────────

vi.mock("./chain", () => ({
  blendXlmId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  blendPoolId: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
  blendNetwork: {
    rpc: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
  },
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const WITHDRAW_MOCK_KEY = "pipeline.mock.wallet.stellar.blend.withdraw";
const STELLAR_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const MOCK_HASH = "0xdeadbeef789";

function wrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useBlendWithdraw — mock key set", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockSubmitBlendTx.mockClear();
    localStorage.setItem(
      WITHDRAW_MOCK_KEY,
      JSON.stringify({ hash: MOCK_HASH }),
    );
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("settles isSuccess=true and data={hash} from mock; submitBlendTx is never called", async () => {
    const { result } = renderHook(() => useBlendWithdraw(), { wrapper });

    act(() => {
      result.current.write(10_000_000n);
    });

    expect(result.current.isPending).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ hash: MOCK_HASH });
    // Lock-in guard
    expect(mockSubmitBlendTx).not.toHaveBeenCalled();
  });
});

describe("useBlendWithdraw — disconnected", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = undefined;
    mockStellarWallet.isConnected = false;
    mockSubmitBlendTx.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
  });

  it("sets 'not connected' error and never calls submitBlendTx", () => {
    const { result } = renderHook(() => useBlendWithdraw(), { wrapper });

    act(() => {
      result.current.write(10_000_000n);
    });

    expect(result.current.error?.message).toMatch(/not connected/i);
    expect(mockSubmitBlendTx).not.toHaveBeenCalled();
  });
});

describe("useBlendWithdraw — real path", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockSubmitBlendTx.mockResolvedValue({ hash: MOCK_HASH });
    mockBuildSubmitOpXdr.mockReturnValue("op-xdr");
    mockSignTransaction.mockResolvedValue({ signedTxXdr: "signed" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("calls submitBlendTx with WithdrawCollateral and transitions isPending→isSuccess", async () => {
    const { result } = renderHook(() => useBlendWithdraw(), { wrapper });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ hash: MOCK_HASH });

    // WithdrawCollateral = 3
    expect(mockBuildSubmitOpXdr).toHaveBeenCalledWith(
      expect.objectContaining({ requestType: 3 }),
    );
    expect(mockSubmitBlendTx).toHaveBeenCalledOnce();
  });

  it("surfaces errors via error field", async () => {
    mockSubmitBlendTx.mockRejectedValue(new Error("tx failed"));

    const { result } = renderHook(() => useBlendWithdraw(), { wrapper });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe("tx failed");
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isPending).toBe(false);
  });

  it("reset() clears all state", async () => {
    const { result } = renderHook(() => useBlendWithdraw(), { wrapper });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
