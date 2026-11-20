// spec: docs/frontend/trustee-flows.md#security-inspections-1857
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useApproveInspection,
  useRecordInspection,
} from "./useSecurityInspections";

const recordMock = vi.fn();
const approveMock = vi.fn();
const signTransactionMock = vi.fn();
let walletState = {
  address: "GCALLER",
  isConnected: true,
  signTransaction: signTransactionMock,
};

vi.mock("@pipeline/wallet-connect", () => ({
  recordInspection: (...args: unknown[]) => recordMock(...args),
  approveInspection: (...args: unknown[]) => approveMock(...args),
  readCanCall: vi.fn(),
  relaySecurityRegistry: vi.fn(),
  checkCoverage: vi.fn(),
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

const STELLAR = 99_000_001;
const INSPECTION = {
  inspector: "GINSPECTOR",
  kind: "DraftSurvey" as const,
  inspectedAt: 1_798_675_200,
  region: "Santos",
  siteHash: "ab".repeat(32),
  quantity: "10",
  grade: "0",
  certificateHash: "cd".repeat(32),
  certificateNo: "C-1",
};
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
  recordMock.mockReset();
  recordMock.mockResolvedValue({ hash: "TX", inspectionId: 42 });
  approveMock.mockReset();
  approveMock.mockResolvedValue({ hash: "TXA" });
  Object.assign(envMock, ENV_CONFIGURED);
  walletState = {
    address: "GCALLER",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRecordInspection", () => {
  it("calls the registry directly with the wallet as caller and returns the id", async () => {
    const { result } = renderHook(() => useRecordInspection(), { wrapper });
    let done: unknown;
    await act(async () => {
      done = await result.current.mutateAsync({
        chainId: STELLAR,
        recordId: 7,
        inspection: INSPECTION,
      });
    });
    expect(done).toEqual({ hash: "TX", inspectionId: 42 });
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        registryId: "CSEC",
        caller: "GCALLER",
        recordId: 7,
        inspection: INSPECTION,
        signTransaction: signTransactionMock,
      }),
    );
  });

  it("refuses an EVM loan, a missing registry id and a missing wallet", async () => {
    const { result } = renderHook(() => useRecordInspection(), { wrapper });
    const input = { chainId: STELLAR, recordId: 7, inspection: INSPECTION };
    await act(async () => {
      await expect(
        result.current.mutateAsync({ ...input, chainId: 560_048 }),
      ).rejects.toThrow(/Stellar only/);
    });
    envMock.STELLAR_SECURITY_REGISTRY_ID = "";
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toThrow(
        /not configured/,
      );
    });
    Object.assign(envMock, ENV_CONFIGURED);
    walletState = { ...walletState, address: "", isConnected: false };
    const second = renderHook(() => useRecordInspection(), { wrapper });
    await act(async () => {
      await expect(second.result.current.mutateAsync(input)).rejects.toThrow(
        "Stellar wallet not connected.",
      );
    });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("needs no AccessManager id", async () => {
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "";
    const { result } = renderHook(() => useRecordInspection(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        chainId: STELLAR,
        recordId: 7,
        inspection: INSPECTION,
      });
    });
    expect(recordMock).toHaveBeenCalled();
  });
});

describe("useApproveInspection", () => {
  it("approves by id and invalidates the security queries now, at 5 s and at 15 s", async () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useApproveInspection(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ chainId: STELLAR, inspectionId: 12 });
    });
    expect(approveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        registryId: "CSEC",
        caller: "GCALLER",
        inspectionId: 12,
      }),
    );
    const keys = () => invalidate.mock.calls.map((c) => c[0]?.queryKey?.[0]);
    expect(keys()).toEqual(["loan-security", "loan-book", "audit-log"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(keys()).toHaveLength(6);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(keys()).toHaveLength(9);
  });

  it("refuses an EVM loan", async () => {
    const { result } = renderHook(() => useApproveInspection(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ chainId: 560_048, inspectionId: 1 }),
      ).rejects.toThrow(/Stellar only/);
    });
    expect(approveMock).not.toHaveBeenCalled();
  });
});
