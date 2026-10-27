// spec: docs/frontend/wallet-flows.md#business-rules

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStellarDepositManagerMinDeposit } from "./useStellarDepositManagerMinDeposit";

const { mockSimulateTransaction, mockIsSimulationError, mockContractCall } =
  vi.hoisted(() => ({
    mockSimulateTransaction: vi.fn(),
    mockIsSimulationError: vi.fn().mockReturnValue(false),
    mockContractCall: vi.fn((method: string) => ({ _method: method })),
  }));

vi.mock("@stellar/stellar-sdk", () => {
  class MockContract {
    call(method: string) {
      return mockContractCall(method);
    }
  }
  class MockServer {
    simulateTransaction(tx: unknown) {
      return mockSimulateTransaction(tx);
    }
  }
  class MockAccount {
    constructor(
      public _id: string,
      public _seq: string,
    ) {}
  }
  class MockTransactionBuilder {
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return {};
    }
  }
  return {
    Contract: MockContract,
    Account: MockAccount,
    rpc: {
      Server: MockServer,
      Api: { isSimulationError: mockIsSimulationError },
    },
    TransactionBuilder: MockTransactionBuilder,
    BASE_FEE: "100",
    scValToNative: vi.fn((val) => val?._value ?? val),
  };
});

const mockDepositManagerId = { value: "" };

vi.mock("./chain", () => ({
  get depositManagerId() {
    return mockDepositManagerId.value;
  },
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  READ_SIMULATION_SOURCE:
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
}));

const DM_ID = "CDMMJ2UOAJG7B6U5WT5LCVNJI4Y5ELQQRIYUYTIZFZ523KNEFJPLHWZT";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useStellarDepositManagerMinDeposit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSimulationError.mockReturnValue(false);
    mockDepositManagerId.value = DM_ID;
  });

  it("returns undefined and makes no RPC call when the contract id is unconfigured", () => {
    mockDepositManagerId.value = "";
    const { result } = renderHook(() => useStellarDepositManagerMinDeposit(), {
      wrapper,
    });
    expect(result.current.minDeposit).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it("reads min_deposit() and returns the i128 as a bigint", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { _value: 10_000_000_000n } },
    });
    const { result } = renderHook(() => useStellarDepositManagerMinDeposit(), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.minDeposit).toBe(10_000_000_000n);
    });
    expect(mockContractCall).toHaveBeenCalledWith("min_deposit");
  });

  it("surfaces a simulation error and leaves minDeposit undefined", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "HostError" });
    const { result } = renderHook(() => useStellarDepositManagerMinDeposit(), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.minDeposit).toBeUndefined();
  });
});
