// spec: docs/frontend/trustee-flows.md#security-marks-1859
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useCheckCoverage,
  useRecordExtensionConsent,
  useRevalue,
  useSecurityRegistryAccess,
} from "./useSecurityMarks";

const relayMock = vi.fn();
const checkCoverageMock = vi.fn();
const readCanCallMock = vi.fn();
const signTransactionMock = vi.fn();
let walletState = {
  address: "GCALLER",
  isConnected: true,
  signTransaction: signTransactionMock,
};

vi.mock("@pipeline/wallet-connect", () => ({
  relaySecurityRegistry: (...args: unknown[]) => relayMock(...args),
  checkCoverage: (...args: unknown[]) => checkCoverageMock(...args),
  readCanCall: (...args: unknown[]) => readCanCallMock(...args),
  useStellarWallet: () => walletState,
}));
vi.mock("./useRiskCouncil", () => ({
  SECURITY_NOT_CONFIGURED:
    "On-chain SecurityRegistry actions are not configured for this environment.",
}));

const { ENV_CONFIGURED, envMock } = vi.hoisted(() => {
  const configured = {
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_CHAIN_ID: 560_048,
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CEXEC",
    STELLAR_SECURITY_REGISTRY_ID: "CSEC",
  };
  return { ENV_CONFIGURED: configured, envMock: { ...configured } };
});
vi.mock("@/lib/env", () => ({ ENV: envMock }));

const HASH = "ab".repeat(32);
const STELLAR = 99_000_001;
let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  relayMock.mockReset();
  relayMock.mockResolvedValue({ hash: "TX" });
  checkCoverageMock.mockReset();
  checkCoverageMock.mockResolvedValue({ hash: "TXC" });
  readCanCallMock.mockReset();
  signTransactionMock.mockReset();
  Object.assign(envMock, ENV_CONFIGURED);
  walletState = {
    address: "GCALLER",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
});

describe("useRevalue", () => {
  const input = {
    chainId: STELLAR,
    recordId: 7,
    valuePerUnit: "9600.0000000",
    benchmark: "LME_Cu",
    reportHash: HASH,
  };

  it("executes revalue on the registry through the AccessManager", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRevalue(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(relayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "execute",
        accessManagerId: "CEXEC",
        registryId: "CSEC",
        caller: "GCALLER",
        call: {
          fn: "revalue",
          recordId: 7,
          valuePerUnit: "9600.0000000",
          benchmark: "LME_Cu",
          reportHash: HASH,
        },
      }),
    );
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey?.[0]);
    expect(keys).toEqual(
      expect.arrayContaining(["loan-security", "loan-book", "audit-log"]),
    );
  });

  it("refuses an EVM loan, an unconfigured environment and a missing wallet", async () => {
    const { result } = renderHook(() => useRevalue(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ ...input, chainId: 560_048 }),
      ).rejects.toThrow(/Stellar only/);
    });
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "";
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toThrow(
        /not configured/,
      );
    });
    Object.assign(envMock, ENV_CONFIGURED);
    walletState = {
      address: "",
      isConnected: false,
      signTransaction: signTransactionMock,
    };
    const second = renderHook(() => useRevalue(), { wrapper });
    await act(async () => {
      await expect(second.result.current.mutateAsync(input)).rejects.toThrow(
        "Stellar wallet not connected.",
      );
    });
    expect(relayMock).not.toHaveBeenCalled();
  });

  it("exposes the contract error from a failed relay", async () => {
    relayMock.mockRejectedValue(new Error("Error(Contract, #1)"));
    const { result } = renderHook(() => useRevalue(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toThrow("#1");
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });
});

describe("useRecordExtensionConsent", () => {
  it("executes record_extension_consent with the u64 maturity", async () => {
    const { result } = renderHook(() => useRecordExtensionConsent(), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        chainId: STELLAR,
        loanId: 4488,
        newMaturity: 1798761600,
        consentHash: HASH,
      });
    });
    expect(relayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        call: {
          fn: "record_extension_consent",
          loanId: 4488,
          newMaturity: 1798761600,
          consentHash: HASH,
        },
      }),
    );
  });
});

describe("useCheckCoverage", () => {
  it("invokes check_coverage directly on the registry, needing no AccessManager", async () => {
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "";
    const { result } = renderHook(() => useCheckCoverage(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ chainId: STELLAR, loanId: 4488 });
    });
    expect(checkCoverageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        registryId: "CSEC",
        loanId: 4488,
        caller: "GCALLER",
      }),
    );
    expect(relayMock).not.toHaveBeenCalled();
  });

  it("fails without the registry id", async () => {
    envMock.STELLAR_SECURITY_REGISTRY_ID = "";
    const { result } = renderHook(() => useCheckCoverage(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ chainId: STELLAR, loanId: 1 }),
      ).rejects.toThrow(/not configured/);
    });
  });
});

describe("useSecurityRegistryAccess", () => {
  it("reads can_call for the connected wallet against the registry", async () => {
    readCanCallMock.mockResolvedValue({ immediate: true, delay: 0 });
    const { result } = renderHook(
      () => useSecurityRegistryAccess("revalue", true),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.data).toEqual({ immediate: true, delay: 0 }),
    );
    expect(readCanCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManagerId: "CEXEC",
        caller: "GCALLER",
        target: "CSEC",
        fn: "revalue",
      }),
    );
  });

  it("stays idle when disabled", () => {
    renderHook(() => useSecurityRegistryAccess("revalue", false), {
      wrapper,
    });
    expect(readCanCallMock).not.toHaveBeenCalled();
  });
});
