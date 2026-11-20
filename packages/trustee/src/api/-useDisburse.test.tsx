// spec: docs/frontend/trustee-flows.md#disburse-1898
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  disburseConfigured,
  useDisburse,
  useDisburseAccess,
  useEvmMinterBankCash,
  useEvmMinterPaused,
  useLoanDisbursementState,
} from "./useDisburse";
import { useEvmDeal } from "./useDealToken";

const disburseMock = vi.fn();
const readRefHashSeenMock = vi.fn();
const fetchMinterPausedMock = vi.fn();
const signTransactionMock = vi.fn();
const disburseEvmLoanMock = vi.fn();
const readEvmRefHashSeenMock = vi.fn();
const readEvmMinterPausedMock = vi.fn();
const readEvmMinterBankCashMock = vi.fn();
const readEvmCanCallMock = vi.fn();
const readEvmLoanDisbursementStateMock = vi.fn();
const readEvmDealMock = vi.fn();
const EVM_ADDRESS = "0x00000000000000000000000000000000000000c1";
let evmWalletState = { address: EVM_ADDRESS, isConnected: true };
let walletState = {
  address: "GCALLER",
  isConnected: true,
  signTransaction: signTransactionMock,
};

vi.mock("@pipeline/wallet-connect", () => ({
  disburse: (...args: unknown[]) => disburseMock(...args),
  readRefHashSeen: (...args: unknown[]) => readRefHashSeenMock(...args),
  bankReferenceRefHash: async (reference: string) => `hash:${reference.trim()}`,
  readCanCall: vi.fn(),
  readDebtTrustline: vi.fn(),
  readLoanDisbursementState: vi.fn(),
  readLoanOwner: vi.fn(),
  useStellarWallet: () => walletState,
  useEvmWallet: () => evmWalletState,
  disburseEvmLoan: (...args: unknown[]) => disburseEvmLoanMock(...args),
  readEvmRefHashSeen: (...args: unknown[]) => readEvmRefHashSeenMock(...args),
  readEvmMinterPaused: (...args: unknown[]) => readEvmMinterPausedMock(...args),
  readEvmMinterBankCash: (...args: unknown[]) =>
    readEvmMinterBankCashMock(...args),
  readEvmCanCall: (...args: unknown[]) => readEvmCanCallMock(...args),
  readEvmLoanDisbursementState: (...args: unknown[]) =>
    readEvmLoanDisbursementStateMock(...args),
  readEvmDeal: (...args: unknown[]) => readEvmDealMock(...args),
  evmDisburseSelector: () => "0x1d492b02",
  readDeal: vi.fn(),
  readOperationSchedule: vi.fn(),
  registerDeal: vi.fn(),
  registerDealArgs: vi.fn(),
}));
vi.mock("./useConversions", () => ({
  fetchMinterPaused: () => fetchMinterPausedMock(),
  minterPoolStateKey: (id: string) => ["minter-pool-state", id],
}));

const { ENV_CONFIGURED, envMock } = vi.hoisted(() => {
  const configured = {
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_CHAIN_ID: 560_048,
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    STELLAR_YIELD_MINTER_ID: "CMINTER",
    STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CEXEC",
    STELLAR_LOAN_REGISTRY_ID: "CREGISTRY",
    STELLAR_DEAL_TOKEN_FACTORY_ID: "CFACTORY",
    EVM_MINTER_ADDRESS: "0x00000000000000000000000000000000000000e1",
    EVM_ACCESS_MANAGER_ADDRESS: "0x00000000000000000000000000000000000000a1",
    EVM_LOAN_REGISTRY_ADDRESS: "0x00000000000000000000000000000000000000b1",
    EVM_DEAL_TOKEN_FACTORY_ADDRESS:
      "0x00000000000000000000000000000000000000d1",
  };
  return { ENV_CONFIGURED: configured, envMock: { ...configured } };
});
vi.mock("@/lib/env", () => ({ ENV: envMock }));

let queryClient: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const INPUT = {
  chainId: 99_000_001,
  loanId: 0,
  amountRaw: "500000000000",
  valueDate: 1_770_000_000,
  reference: " WIRE-1 ",
};

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  disburseMock.mockReset();
  readRefHashSeenMock.mockReset();
  readRefHashSeenMock.mockResolvedValue(false);
  fetchMinterPausedMock.mockReset();
  fetchMinterPausedMock.mockResolvedValue(false);
  signTransactionMock.mockReset();
  Object.assign(envMock, ENV_CONFIGURED);
  evmWalletState = { address: EVM_ADDRESS, isConnected: true };
  for (const mock of [
    disburseEvmLoanMock,
    readEvmRefHashSeenMock,
    readEvmMinterPausedMock,
    readEvmMinterBankCashMock,
    readEvmCanCallMock,
    readEvmLoanDisbursementStateMock,
    readEvmDealMock,
  ]) {
    mock.mockReset();
  }
  readEvmRefHashSeenMock.mockResolvedValue(false);
  readEvmMinterPausedMock.mockResolvedValue(false);
  walletState = {
    address: "GCALLER",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("useDisburse", () => {
  it("refuses an unknown chain before any chain call", async () => {
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ ...INPUT, chainId: 1234 }),
      ).rejects.toThrow(/Stellar only/);
    });
    expect(disburseMock).not.toHaveBeenCalled();
    expect(disburseEvmLoanMock).not.toHaveBeenCalled();
  });

  it("short-circuits when not configured", async () => {
    envMock.STELLAR_DEAL_TOKEN_FACTORY_ID = "";
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        "Disbursement isn't configured for this environment.",
      );
    });
    expect(disburseMock).not.toHaveBeenCalled();
  });

  it("requires a connected wallet", async () => {
    walletState = {
      address: "",
      isConnected: false,
      signTransaction: signTransactionMock,
    };
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        "Stellar wallet not connected.",
      );
    });
    expect(disburseMock).not.toHaveBeenCalled();
  });

  it("refuses a consumed reference without requesting a signature", async () => {
    readRefHashSeenMock.mockResolvedValue(true);
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        /already recorded on-chain/,
      );
    });
    expect(readRefHashSeenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        minterId: "CMINTER",
        refHash: "hash:WIRE-1",
      }),
    );
    expect(disburseMock).not.toHaveBeenCalled();
    expect(signTransactionMock).not.toHaveBeenCalled();
  });

  it("refuses when the minter is paused", async () => {
    fetchMinterPausedMock.mockResolvedValue(true);
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        /minter is paused/,
      );
    });
    expect(disburseMock).not.toHaveBeenCalled();
  });

  it("disburses with the trimmed-reference hash and env ids, then invalidates", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    disburseMock.mockResolvedValue({ hash: "tx-hash" });
    const { result } = renderHook(() => useDisburse(), { wrapper });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).resolves.toEqual({
        hash: "tx-hash",
      });
    });
    expect(disburseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManagerId: "CEXEC",
        minterId: "CMINTER",
        caller: "GCALLER",
        loanId: 0,
        amountRaw: "500000000000",
        valueDate: 1_770_000_000,
        refHash: "hash:WIRE-1",
        signTransaction: signTransactionMock,
      }),
    );
    for (const key of [
      "loan-disbursement",
      "loan-book",
      "cash-book",
      "audit-log",
      "debt-trustline",
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["minter-pool-state", "CMINTER"],
    });
    const immediate = invalidate.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(invalidate.mock.calls.length).toBe(immediate * 2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(invalidate.mock.calls.length).toBe(immediate * 3);
  });
});

const EVM_INPUT = {
  ...INPUT,
  chainId: 560_048,
  amountRaw: "1000000",
};

describe("useDisburse (EVM arm)", () => {
  it("checks the chain first, with no call", async () => {
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ ...EVM_INPUT, chainId: 1234 }),
      ).rejects.toThrow(/Stellar only/);
    });
    expect(readEvmRefHashSeenMock).not.toHaveBeenCalled();
    expect(disburseEvmLoanMock).not.toHaveBeenCalled();
  });

  it("checks the config before the wallet, with no call", async () => {
    envMock.EVM_DEAL_TOKEN_FACTORY_ADDRESS = "";
    evmWalletState = { address: "", isConnected: false };
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
        "Disbursement isn't configured for this environment.",
      );
    });
    expect(readEvmRefHashSeenMock).not.toHaveBeenCalled();
    expect(disburseEvmLoanMock).not.toHaveBeenCalled();
  });

  it("requires a connected EVM wallet, with no call", async () => {
    evmWalletState = { address: "", isConnected: false };
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
        "EVM wallet not connected.",
      );
    });
    expect(readEvmRefHashSeenMock).not.toHaveBeenCalled();
    expect(disburseEvmLoanMock).not.toHaveBeenCalled();
  });

  it("refuses a consumed reference without requesting a signature", async () => {
    readEvmRefHashSeenMock.mockResolvedValue(true);
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
        /already recorded on-chain/,
      );
    });
    expect(readEvmRefHashSeenMock).toHaveBeenCalledWith({
      minter: ENV_CONFIGURED.EVM_MINTER_ADDRESS,
      refHash: "0xhash:WIRE-1",
    });
    expect(disburseEvmLoanMock).not.toHaveBeenCalled();
  });

  it("refuses when the minter is paused", async () => {
    readEvmMinterPausedMock.mockResolvedValue(true);
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
        /minter is paused/,
      );
    });
    expect(disburseEvmLoanMock).not.toHaveBeenCalled();
  });

  it("disburses through the AccessManager with the 0x-prefixed reference hash, then invalidates the EVM keys", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    disburseEvmLoanMock.mockResolvedValue({ hash: "0xtx" });
    const { result } = renderHook(() => useDisburse(), { wrapper });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await expect(result.current.mutateAsync(EVM_INPUT)).resolves.toEqual({
        hash: "0xtx",
      });
    });
    expect(disburseEvmLoanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManager: ENV_CONFIGURED.EVM_ACCESS_MANAGER_ADDRESS,
        minter: ENV_CONFIGURED.EVM_MINTER_ADDRESS,
        caller: EVM_ADDRESS,
        chainId: 560_048,
        loanId: 0,
        amountRaw: "1000000",
        valueDate: 1_770_000_000,
        refHash: "0xhash:WIRE-1",
      }),
    );
    expect(disburseMock).not.toHaveBeenCalled();
    for (const key of ["evm-minter-bank-cash", "evm-minter-paused"]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });
});

describe("EVM disbursement reads", () => {
  it("disburseConfigured needs all four EVM keys", () => {
    expect(disburseConfigured(560_048)).toBe(true);
    envMock.EVM_DEAL_TOKEN_FACTORY_ADDRESS = "";
    expect(disburseConfigured(560_048)).toBe(false);
    expect(disburseConfigured(99_000_001)).toBe(true);
  });

  it("reads the loan state, deal, bank cash, paused and role only on the EVM chain", async () => {
    readEvmLoanDisbursementStateMock.mockResolvedValue({ status: "Approved" });
    readEvmDealMock.mockResolvedValue({ debt: "0xdebt" });
    readEvmMinterBankCashMock.mockResolvedValue("5");
    readEvmMinterPausedMock.mockResolvedValue(false);
    readEvmCanCallMock.mockResolvedValue({ immediate: true, delay: 0 });
    const { result } = renderHook(
      () => ({
        loan: useLoanDisbursementState(560_048, 3),
        deal: useEvmDeal(560_048, 3),
        cash: useEvmMinterBankCash(true),
        paused: useEvmMinterPaused(true),
        access: useDisburseAccess(560_048, true),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.loan.isSuccess).toBe(true);
      expect(result.current.deal.isSuccess).toBe(true);
      expect(result.current.cash.isSuccess).toBe(true);
      expect(result.current.paused.isSuccess).toBe(true);
      expect(result.current.access.isSuccess).toBe(true);
    });
    expect(readEvmLoanDisbursementStateMock).toHaveBeenCalledWith({
      registry: ENV_CONFIGURED.EVM_LOAN_REGISTRY_ADDRESS,
      loanId: 3,
    });
    expect(readEvmDealMock).toHaveBeenCalledWith({
      factory: ENV_CONFIGURED.EVM_DEAL_TOKEN_FACTORY_ADDRESS,
      loanId: 3,
    });
    expect(readEvmCanCallMock).toHaveBeenCalledWith({
      accessManager: ENV_CONFIGURED.EVM_ACCESS_MANAGER_ADDRESS,
      caller: EVM_ADDRESS,
      target: ENV_CONFIGURED.EVM_MINTER_ADDRESS,
      selector: "0x1d492b02",
    });
  });

  it("reads nothing for an unknown chain", () => {
    const { result } = renderHook(
      () => ({
        loan: useLoanDisbursementState(1234, 3),
        deal: useEvmDeal(1234, 3),
        access: useDisburseAccess(1234, false),
      }),
      { wrapper },
    );
    expect(result.current.loan.fetchStatus).toBe("idle");
    expect(result.current.deal.fetchStatus).toBe("idle");
    expect(result.current.access.fetchStatus).toBe("idle");
    expect(readEvmLoanDisbursementStateMock).not.toHaveBeenCalled();
    expect(readEvmDealMock).not.toHaveBeenCalled();
  });

  it("the deal and role reads stay idle when the factory is unset", () => {
    envMock.EVM_DEAL_TOKEN_FACTORY_ADDRESS = "";
    const { result } = renderHook(
      () => ({
        deal: useEvmDeal(560_048, 3),
        access: useDisburseAccess(560_048, true),
      }),
      { wrapper },
    );
    expect(result.current.deal.fetchStatus).toBe("idle");
    expect(result.current.access.fetchStatus).toBe("idle");
  });
});
