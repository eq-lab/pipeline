// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCashReporterAccess } from "./useCashReporterAccess";

const readCanCallMock = vi.fn();
let walletState = { address: "GWALLET" };

vi.mock("@pipeline/wallet-connect", () => ({
  readCanCall: (...args: unknown[]) => readCanCallMock(...args),
  useStellarWallet: () => walletState,
}));

const ENV_CONFIGURED = {
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_YIELD_MINTER_ID: "CMINTER",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CACCESSMANAGER",
};
let envMock = { ...ENV_CONFIGURED };
vi.mock("@/lib/env", () => ({
  get ENV() {
    return envMock;
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  readCanCallMock.mockReset();
  readCanCallMock.mockResolvedValue({ immediate: true, delay: 0 });
  envMock = { ...ENV_CONFIGURED };
  walletState = { address: "GWALLET" };
});

describe("useCashReporterAccess", () => {
  it("reads can_call on the minter with the AccessManager and the wallet", async () => {
    const { result } = renderHook(
      () => useCashReporterAccess("record_income", true),
      { wrapper },
    );
    expect(result.current.reason).toBe(
      "Checking this wallet's Cash reporter role…",
    );
    await waitFor(() => expect(result.current.reason).toBeNull());
    expect(readCanCallMock).toHaveBeenCalledWith({
      accessManagerId: "CACCESSMANAGER",
      caller: "GWALLET",
      target: "CMINTER",
      fn: "record_income",
      rpcUrl: ENV_CONFIGURED.STELLAR_RPC_URL,
      networkPassphrase: ENV_CONFIGURED.STELLAR_NETWORK_PASSPHRASE,
    });
  });

  it("reports the no-role copy when the wallet has no immediate access", async () => {
    readCanCallMock.mockResolvedValue({ immediate: false, delay: 0 });
    const { result } = renderHook(() => useCashReporterAccess("repay", true), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.reason).toBe(
        "Only the Cash reporter can book repayments.",
      ),
    );
  });

  it("fails closed when the read errors", async () => {
    readCanCallMock.mockRejectedValue(new Error("rpc down"));
    const { result } = renderHook(
      () => useCashReporterAccess("record_wire_in", true),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.reason).toBe(
        "Could not verify this wallet's Cash reporter role.",
      ),
    );
  });

  it("does not read when disabled, without a wallet, or with ids unset", () => {
    renderHook(() => useCashReporterAccess("repay", false), { wrapper });
    walletState = { address: "" };
    renderHook(() => useCashReporterAccess("repay", true), { wrapper });
    walletState = { address: "GWALLET" };
    envMock = { ...ENV_CONFIGURED, STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "" };
    renderHook(() => useCashReporterAccess("repay", true), { wrapper });
    envMock = { ...ENV_CONFIGURED, STELLAR_YIELD_MINTER_ID: "" };
    renderHook(() => useCashReporterAccess("repay", true), { wrapper });
    expect(readCanCallMock).not.toHaveBeenCalled();
  });
});
