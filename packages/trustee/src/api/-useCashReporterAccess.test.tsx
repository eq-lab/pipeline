// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCashReporterAccess } from "./useCashReporterAccess";

const hoisted = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const readCanCallMock = vi.fn();
const readEvmCanCallMock = vi.fn();
let walletState = { address: "GWALLET", isConnected: true };
let evmWalletState = {
  address: "0x00000000000000000000000000000000000000c1" as string | undefined,
  isConnected: true,
};
const EVM_CHAIN = 560048;

vi.mock("@pipeline/wallet-connect", () => ({
  readCanCall: (...args: unknown[]) => readCanCallMock(...args),
  readEvmCanCall: (...args: unknown[]) => readEvmCanCallMock(...args),
  evmRepaySelector: () => "0x87d2050a",
  useStellarWallet: () => walletState,
  useEvmWallet: () => evmWalletState,
}));

const ENV_CONFIGURED = {
  STELLAR_CHAIN_ID: 1000,
  EVM_CHAIN_ID: EVM_CHAIN,
  EVM_MINTER_ADDRESS: "0x00000000000000000000000000000000000000e1",
  EVM_ACCESS_MANAGER_ADDRESS: "0x00000000000000000000000000000000000000a1",
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_YIELD_MINTER_ID: "CMINTER",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CACCESSMANAGER",
};
hoisted.env = { ...ENV_CONFIGURED };
vi.mock("@/lib/env", () => ({
  get ENV() {
    return hoisted.env;
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
  hoisted.env = { ...ENV_CONFIGURED };
  walletState = { address: "GWALLET", isConnected: true };
  evmWalletState = {
    address: "0x00000000000000000000000000000000000000c1",
    isConnected: true,
  };
  readEvmCanCallMock.mockReset();
  readEvmCanCallMock.mockResolvedValue({ immediate: true, delay: 0 });
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
    walletState = { address: "", isConnected: false };
    renderHook(() => useCashReporterAccess("repay", true), { wrapper });
    walletState = { address: "GWALLET", isConnected: true };
    hoisted.env = { ...ENV_CONFIGURED, STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "" };
    renderHook(() => useCashReporterAccess("repay", true), { wrapper });
    hoisted.env = { ...ENV_CONFIGURED, STELLAR_YIELD_MINTER_ID: "" };
    renderHook(() => useCashReporterAccess("repay", true), { wrapper });
    expect(readCanCallMock).not.toHaveBeenCalled();
  });
});

describe("useCashReporterAccess (EVM)", () => {
  it("reads canCall on the EVM AccessManager with the repay selector", async () => {
    const { result } = renderHook(
      () => useCashReporterAccess("repay", true, EVM_CHAIN),
      { wrapper },
    );
    await waitFor(() => expect(result.current.reason).toBeNull());
    expect(readEvmCanCallMock).toHaveBeenCalledWith({
      accessManager: ENV_CONFIGURED.EVM_ACCESS_MANAGER_ADDRESS,
      caller: "0x00000000000000000000000000000000000000c1",
      target: ENV_CONFIGURED.EVM_MINTER_ADDRESS,
      selector: "0x87d2050a",
    });
    expect(readCanCallMock).not.toHaveBeenCalled();
  });

  it("reports the no-role copy for (false, 0)", async () => {
    readEvmCanCallMock.mockResolvedValue({ immediate: false, delay: 0 });
    const { result } = renderHook(
      () => useCashReporterAccess("repay", true, EVM_CHAIN),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.reason).toBe(
        "Only the Cash reporter can book repayments.",
      ),
    );
  });

  it("reports the delay copy when the role is delayed", async () => {
    readEvmCanCallMock.mockResolvedValue({ immediate: false, delay: 7200 });
    const { result } = renderHook(
      () => useCashReporterAccess("repay", true, EVM_CHAIN),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.reason).toBe(
        "This wallet holds the Cash reporter role with a 2 h delay; the minter accepts only immediate calls.",
      ),
    );
  });

  it("asks to connect when there is no EVM address", () => {
    evmWalletState = { address: undefined, isConnected: false };
    const { result } = renderHook(
      () => useCashReporterAccess("repay", true, EVM_CHAIN),
      { wrapper },
    );
    expect(result.current.reason).toBe(
      "Connect your trustee wallet to check the Cash reporter role.",
    );
    expect(readEvmCanCallMock).not.toHaveBeenCalled();
  });

  it("never reads for a function with no EVM selector or unset addresses", () => {
    renderHook(() => useCashReporterAccess("record_wire_in", true, EVM_CHAIN), {
      wrapper,
    });
    hoisted.env = { ...ENV_CONFIGURED, EVM_ACCESS_MANAGER_ADDRESS: "" };
    renderHook(() => useCashReporterAccess("repay", true, EVM_CHAIN), {
      wrapper,
    });
    hoisted.env = { ...ENV_CONFIGURED, EVM_MINTER_ADDRESS: "" };
    renderHook(() => useCashReporterAccess("repay", true, EVM_CHAIN), {
      wrapper,
    });
    expect(readEvmCanCallMock).not.toHaveBeenCalled();
  });
});
