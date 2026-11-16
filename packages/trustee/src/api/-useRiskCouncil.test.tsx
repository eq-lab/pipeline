// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  NoLongerScheduledError,
  PendingArgsMismatchError,
  PendingTargetMismatchError,
  RegistryPausedError,
  usePendingOperationExecute,
  useRiskCouncilAccess,
  useRiskCouncilLoanState,
  useRiskCouncilRelay,
  useSecurityInspectors,
} from "./useRiskCouncil";
import {
  _resetRiskCouncilOpsForTests,
  recordScheduledOp,
  useExecutedOperations,
  useScheduledOps,
} from "@/lib/riskCouncilOps";

const mocks = vi.hoisted(() => ({
  relayRiskCouncil: vi.fn(),
  relaySecurityRegistry: vi.fn(),
  readSecurityRegistrySchedule: vi.fn(),
  readSecurityInspectors: vi.fn(),
  readScheduledOperation: vi.fn(),
  executeScheduledOperation: vi.fn(),
  securityRegistryArgsXdr: vi.fn(),
  riskCouncilArgsXdr: vi.fn(),
  readCanCall: vi.fn(),
  readRiskCouncilSchedule: vi.fn(),
  readLoanChainState: vi.fn(),
  readLoanMoney: vi.fn(),
  sign: vi.fn(),
  wallet: { address: "GRC" as string | null, isConnected: true },
}));

vi.mock("@pipeline/wallet-connect", () => ({
  relayRiskCouncil: mocks.relayRiskCouncil,
  relaySecurityRegistry: mocks.relaySecurityRegistry,
  readSecurityRegistrySchedule: mocks.readSecurityRegistrySchedule,
  readSecurityInspectors: mocks.readSecurityInspectors,
  readScheduledOperation: mocks.readScheduledOperation,
  executeScheduledOperation: mocks.executeScheduledOperation,
  securityRegistryArgsXdr: mocks.securityRegistryArgsXdr,
  riskCouncilArgsXdr: mocks.riskCouncilArgsXdr,
  readCanCall: mocks.readCanCall,
  readRiskCouncilSchedule: mocks.readRiskCouncilSchedule,
  readLoanChainState: mocks.readLoanChainState,
  readLoanMoney: mocks.readLoanMoney,
  useStellarWallet: () => ({
    address: mocks.wallet.address,
    isConnected: mocks.wallet.isConnected,
    signTransaction: mocks.sign,
  }),
}));

const envMock = vi.hoisted(() => ({
  STELLAR_CHAIN_ID: 99_000_001,
  EVM_CHAIN_ID: 560_048,
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_LOAN_REGISTRY_ID: "CREGISTRY",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CAM",
  STELLAR_SECURITY_REGISTRY_ID: "CSECURITY",
}));
vi.mock("@/lib/env", () => ({ ENV: envMock }));

const STELLAR = 99_000_001;
const EVM = 560_048;
const SET_DEFAULT = { fn: "set_default", loanId: 4 } as const;
let queryClient: QueryClient;

function makeWrapper() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function keys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map(
    (c) => (c[0] as { queryKey: unknown[] }).queryKey[0],
  );
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => {
    if (typeof m === "function") (m as ReturnType<typeof vi.fn>).mockReset();
  });
  mocks.wallet.address = "GRC";
  mocks.wallet.isConnected = true;
  mocks.relayRiskCouncil.mockResolvedValue({ hash: "H" });
  envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "CAM";
  envMock.STELLAR_LOAN_REGISTRY_ID = "CREGISTRY";
  envMock.STELLAR_SECURITY_REGISTRY_ID = "CSECURITY";
  mocks.relaySecurityRegistry.mockResolvedValue({ hash: "SH" });
  mocks.securityRegistryArgsXdr.mockReturnValue("ARGSXDR");
  mocks.riskCouncilArgsXdr.mockReturnValue("RCARGSXDR");
  _resetRiskCouncilOpsForTests();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function fakeRelayTimers() {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
}

describe("useRiskCouncilAccess", () => {
  it("reads can_call only when the wallet can execute at once", async () => {
    mocks.readCanCall.mockResolvedValue({ immediate: true, delay: 0 });
    const { result } = renderHook(
      () => useRiskCouncilAccess(STELLAR, SET_DEFAULT, "set_default"),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.schedule).toBeNull();
    expect(mocks.readRiskCouncilSchedule).not.toHaveBeenCalled();
    expect(mocks.readCanCall).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManagerId: "CAM",
        caller: "GRC",
        target: "CREGISTRY",
        fn: "set_default",
      }),
    );
  });

  it("reads the schedule when delayed and the call is set", async () => {
    mocks.readCanCall.mockResolvedValue({ immediate: false, delay: 86400 });
    mocks.readRiskCouncilSchedule.mockResolvedValue({
      operationId: "x",
      readyAt: 5,
    });
    const { result } = renderHook(
      () => useRiskCouncilAccess(STELLAR, SET_DEFAULT, "set_default"),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data?.schedule).not.toBeNull());
    expect(mocks.readRiskCouncilSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ call: SET_DEFAULT, caller: "GRC" }),
    );
  });

  it("does not read the schedule when the call is null", async () => {
    mocks.readCanCall.mockResolvedValue({ immediate: false, delay: 86400 });
    const { result } = renderHook(
      () => useRiskCouncilAccess(STELLAR, null, "amend_economics"),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.schedule).toBeNull();
    expect(mocks.readRiskCouncilSchedule).not.toHaveBeenCalled();
  });

  it("is disabled for an EVM chain or without an address", () => {
    renderHook(() => useRiskCouncilAccess(EVM, SET_DEFAULT, "set_default"), {
      wrapper: makeWrapper(),
    });
    mocks.wallet.address = null;
    renderHook(
      () => useRiskCouncilAccess(STELLAR, SET_DEFAULT, "set_default"),
      {
        wrapper: makeWrapper(),
      },
    );
    expect(mocks.readCanCall).not.toHaveBeenCalled();
  });

  it("surfaces the not-configured error", async () => {
    envMock.STELLAR_LOAN_REGISTRY_ID = "";
    const { result } = renderHook(
      () => useRiskCouncilAccess(STELLAR, SET_DEFAULT, "set_default"),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toMatch(
      /Risk Council actions are not configured/,
    );
  });
});

const RELEASE = {
  fn: "release_with_consent",
  recordId: 3,
  consentHash: "ab".repeat(32),
} as const;

describe("SecurityRegistry dispatch", () => {
  it("reads can_call against the SecurityRegistry target", async () => {
    mocks.readCanCall.mockResolvedValue({ immediate: false, delay: 86400 });
    mocks.readSecurityRegistrySchedule.mockResolvedValue({
      operationId: "x",
      readyAt: 7,
    });
    const { result } = renderHook(
      () => useRiskCouncilAccess(STELLAR, RELEASE, "release_with_consent"),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data?.schedule).not.toBeNull());
    expect(mocks.readCanCall).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManagerId: "CAM",
        target: "CSECURITY",
        fn: "release_with_consent",
      }),
    );
    expect(mocks.readSecurityRegistrySchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        call: RELEASE,
        registryId: "CSECURITY",
        accessManagerId: "CAM",
      }),
    );
    expect(mocks.readRiskCouncilSchedule).not.toHaveBeenCalled();
  });

  it("surfaces the SecurityRegistry not-configured error and leaves loan calls alone", async () => {
    envMock.STELLAR_SECURITY_REGISTRY_ID = "";
    const sec = renderHook(
      () => useRiskCouncilAccess(STELLAR, RELEASE, "release_with_consent"),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(sec.result.current.error).not.toBeNull());
    expect(sec.result.current.error?.message).toMatch(
      /SecurityRegistry actions are not configured/,
    );
    mocks.readCanCall.mockResolvedValue({ immediate: true, delay: 0 });
    const loan = renderHook(
      () => useRiskCouncilAccess(STELLAR, SET_DEFAULT, "set_default"),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(loan.result.current.data).toBeDefined());
  });

  it("relays a security call through relaySecurityRegistry and keeps the loan context", async () => {
    fakeRelayTimers();
    const relay = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    const ops = renderHook(() => useScheduledOps(STELLAR));
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "schedule",
        call: RELEASE,
        chainId: STELLAR,
        loanId: 9,
      });
    });
    expect(mocks.relaySecurityRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "schedule",
        call: RELEASE,
        registryId: "CSECURITY",
        accessManagerId: "CAM",
        caller: "GRC",
      }),
    );
    expect(mocks.relayRiskCouncil).not.toHaveBeenCalled();
    expect(ops.result.current[0]!.loanId).toBe(9);
  });

  it("rejects a security relay when the SecurityRegistry id is empty", async () => {
    envMock.STELLAR_SECURITY_REGISTRY_ID = "";
    const relay = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    await expect(
      relay.result.current.mutateAsync({
        mode: "execute",
        call: RELEASE,
        chainId: STELLAR,
      }),
    ).rejects.toThrow(/SecurityRegistry actions are not configured/);
    expect(mocks.relaySecurityRegistry).not.toHaveBeenCalled();
  });
});

describe("useSecurityInspectors", () => {
  it("reads the current panel on chain", async () => {
    mocks.readSecurityInspectors.mockResolvedValue(["GA", "GB"]);
    const { result } = renderHook(() => useSecurityInspectors(STELLAR), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual(["GA", "GB"]));
    expect(mocks.readSecurityInspectors).toHaveBeenCalledWith(
      expect.objectContaining({ registryId: "CSECURITY" }),
    );
  });

  it("errors when not configured and is disabled on EVM", async () => {
    envMock.STELLAR_SECURITY_REGISTRY_ID = "";
    const a = renderHook(() => useSecurityInspectors(STELLAR), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(a.result.current.error).not.toBeNull());
    renderHook(() => useSecurityInspectors(EVM), { wrapper: makeWrapper() });
    expect(mocks.readSecurityInspectors).not.toHaveBeenCalled();
  });
});

describe("useRiskCouncilLoanState", () => {
  it("returns raw chain values and is Stellar only", async () => {
    mocks.readLoanChainState.mockResolvedValue({ status: "Default" });
    mocks.readLoanMoney.mockResolvedValue({ outstanding: "0" });
    const { result } = renderHook(() => useRiskCouncilLoanState(STELLAR, 4), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({
      chain: { status: "Default" },
      money: { outstanding: "0" },
    });
    renderHook(() => useRiskCouncilLoanState(EVM, 4), {
      wrapper: makeWrapper(),
    });
    expect(mocks.readLoanChainState).toHaveBeenCalledTimes(1);
  });
});

describe("useRiskCouncilRelay", () => {
  it("relays schedule and execute with the right params", async () => {
    fakeRelayTimers();
    const { result } = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    for (const mode of ["schedule", "execute"] as const) {
      await act(async () => {
        await result.current.mutateAsync({
          mode,
          call: SET_DEFAULT,
          chainId: STELLAR,
        });
      });
      expect(mocks.relayRiskCouncil).toHaveBeenLastCalledWith(
        expect.objectContaining({
          mode,
          call: SET_DEFAULT,
          accessManagerId: "CAM",
          registryId: "CREGISTRY",
          caller: "GRC",
        }),
      );
    }
    await waitFor(() => expect(result.current.hash).toBe("H"));
  });

  it("invalidates the listed keys now, at 5 s and at 15 s", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync({
        mode: "execute",
        call: SET_DEFAULT,
        chainId: STELLAR,
      });
    });
    const expected = [
      "risk-council-access",
      "risk-council-loan",
      "risk-council-inspectors",
      "loan-book",
      "loan-financials",
      "loan-security",
      "audit-log",
    ];
    expect(keys(spy)).toEqual(expected);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(keys(spy)).toEqual([...expected, ...expected]);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(keys(spy)).toHaveLength(expected.length * 3);
  });

  it("records a schedule into the store and marks an execute", async () => {
    fakeRelayTimers();
    const wrapper = makeWrapper();
    const relay = renderHook(() => useRiskCouncilRelay(), { wrapper });
    const ops = renderHook(() => useScheduledOps(STELLAR));
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "schedule",
        call: SET_DEFAULT,
        chainId: STELLAR,
      });
    });
    expect(ops.result.current).toHaveLength(1);
    expect(ops.result.current[0]!.executedHere).toBe(false);
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "execute",
        call: SET_DEFAULT,
        chainId: STELLAR,
      });
    });
    expect(ops.result.current[0]!.executedHere).toBe(true);
  });

  it("marks the scheduled operation id executed when the form executes", async () => {
    fakeRelayTimers();
    mocks.readRiskCouncilSchedule.mockResolvedValue({
      operationId: "OPX",
      readyAt: 7,
    });
    const relay = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    const executed = renderHook(() => useExecutedOperations(STELLAR));
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "schedule",
        call: SET_DEFAULT,
        chainId: STELLAR,
      });
    });
    expect(executed.result.current.size).toBe(0);
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "execute",
        call: SET_DEFAULT,
        chainId: STELLAR,
      });
    });
    expect(executed.result.current.get("OPX")).toMatchObject({ readyAt: 7 });
  });

  it("rejects when not configured, not connected or on EVM", async () => {
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "";
    const a = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    await expect(
      a.result.current.mutateAsync({
        mode: "execute",
        call: SET_DEFAULT,
        chainId: STELLAR,
      }),
    ).rejects.toThrow(/not configured for this environment/);

    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "CAM";
    mocks.wallet.isConnected = false;
    const b = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    await expect(
      b.result.current.mutateAsync({
        mode: "execute",
        call: SET_DEFAULT,
        chainId: STELLAR,
      }),
    ).rejects.toThrow(/wallet not connected/);

    mocks.wallet.isConnected = true;
    const c = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    await expect(
      c.result.current.mutateAsync({
        mode: "execute",
        call: SET_DEFAULT,
        chainId: EVM,
      }),
    ).rejects.toThrow(/Stellar only/);
    expect(mocks.relayRiskCouncil).not.toHaveBeenCalled();
  });

  it("exposes the stage reported by the relay", async () => {
    fakeRelayTimers();
    mocks.relayRiskCouncil.mockImplementation(
      async ({ onStageChange }: { onStageChange: (s: string) => void }) => {
        onStageChange("confirming");
        return { hash: "H" };
      },
    );
    const { result } = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({
        mode: "schedule",
        call: SET_DEFAULT,
        chainId: STELLAR,
      });
    });
    expect(result.current.stage).toBe("confirming");
  });
});

describe("useRiskCouncilRelay schedule bridge", () => {
  it("records the operation id and ready time from the follow-up read", async () => {
    fakeRelayTimers();
    mocks.readSecurityRegistrySchedule.mockResolvedValue({
      operationId: "OP1",
      readyAt: 1_800_000_000,
    });
    const relay = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    const ops = renderHook(() => useScheduledOps(STELLAR));
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "schedule",
        call: RELEASE,
        chainId: STELLAR,
        loanId: 9,
      });
    });
    expect(ops.result.current[0]).toMatchObject({
      operationId: "OP1",
      readyAt: 1_800_000_000,
      caller: "GRC",
      target: "CSECURITY",
      argsXdr: "ARGSXDR",
      loanId: 9,
    });
    await waitFor(() => expect(relay.result.current.hash).toBe("SH"));
  });

  it("still records the operation without an id when the follow-up read fails", async () => {
    fakeRelayTimers();
    mocks.readSecurityRegistrySchedule.mockRejectedValue(new Error("rpc down"));
    const relay = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    const ops = renderHook(() => useScheduledOps(STELLAR));
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "schedule",
        call: RELEASE,
        chainId: STELLAR,
      });
    });
    expect(ops.result.current).toHaveLength(1);
    expect(ops.result.current[0]!.operationId).toBeUndefined();
  });

  it("reads the schedule before an execute, never after it", async () => {
    fakeRelayTimers();
    const order: string[] = [];
    mocks.readSecurityRegistrySchedule.mockImplementation(async () => {
      order.push("read");
      return { operationId: "OPS", readyAt: 5 };
    });
    mocks.relaySecurityRegistry.mockImplementation(async () => {
      order.push("relay");
      return { hash: "SH" };
    });
    const relay = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "execute",
        call: RELEASE,
        chainId: STELLAR,
      });
    });
    expect(order).toEqual(["read", "relay"]);
  });

  it("marks an operation scheduled in another session executed by its id", async () => {
    fakeRelayTimers();
    mocks.readRiskCouncilSchedule.mockResolvedValue({
      operationId: "OTHERSESSION",
      readyAt: 9,
    });
    const relay = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    const executed = renderHook(() => useExecutedOperations(STELLAR));
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "execute",
        call: SET_DEFAULT,
        chainId: STELLAR,
      });
    });
    expect(executed.result.current.get("OTHERSESSION")).toMatchObject({
      hash: "H",
      readyAt: 9,
    });
  });

  it("marks nothing when the pre-read fails or the schedule is empty, and still executes", async () => {
    fakeRelayTimers();
    const relay = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    const executed = renderHook(() => useExecutedOperations(STELLAR));
    mocks.readRiskCouncilSchedule.mockRejectedValue(new Error("rpc"));
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "execute",
        call: SET_DEFAULT,
        chainId: STELLAR,
      });
    });
    mocks.readRiskCouncilSchedule.mockResolvedValue({
      operationId: "ZERO",
      readyAt: 0,
    });
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "execute",
        call: SET_DEFAULT,
        chainId: STELLAR,
      });
    });
    expect(mocks.relayRiskCouncil).toHaveBeenCalledTimes(2);
    expect(executed.result.current.size).toBe(0);
  });

  it("records the riskCouncilArgsXdr of an amend_economics schedule", async () => {
    fakeRelayTimers();
    const amend = {
      fn: "amend_economics",
      loanId: 4,
      rateBps: 1450,
      maturity: 1_816_128_000,
    } as const;
    mocks.readRiskCouncilSchedule.mockResolvedValue({
      operationId: "OP3",
      readyAt: 9,
    });
    const relay = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    const ops = renderHook(() => useScheduledOps(STELLAR));
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "schedule",
        call: amend,
        chainId: STELLAR,
      });
    });
    expect(mocks.riskCouncilArgsXdr).toHaveBeenCalledWith(amend);
    expect(ops.result.current[0]).toMatchObject({
      operationId: "OP3",
      argsXdr: "RCARGSXDR",
    });
  });

  it("records the encoded argsXdr for a LoanRegistry call", async () => {
    fakeRelayTimers();
    mocks.readRiskCouncilSchedule.mockResolvedValue({
      operationId: "OP2",
      readyAt: 5,
    });
    const relay = renderHook(() => useRiskCouncilRelay(), {
      wrapper: makeWrapper(),
    });
    const ops = renderHook(() => useScheduledOps(STELLAR));
    await act(async () => {
      await relay.result.current.mutateAsync({
        mode: "schedule",
        call: SET_DEFAULT,
        chainId: STELLAR,
      });
    });
    expect(mocks.riskCouncilArgsXdr).toHaveBeenCalledWith(SET_DEFAULT);
    expect(ops.result.current[0]!.argsXdr).toBe("RCARGSXDR");
  });
});

describe("usePendingOperationExecute", () => {
  const INPUT = {
    chainId: STELLAR,
    operationId: "OP1",
    caller: "GRC",
    target: "CSECURITY",
    expectedTarget: "CSECURITY",
    paused: false,
    fn: "set_terms",
    argsXdr: "AAAA",
  };

  beforeEach(() => {
    mocks.readScheduledOperation.mockResolvedValue({
      operationId: "OP1",
      readyAt: 1_800_000_000,
    });
    mocks.executeScheduledOperation.mockResolvedValue({ hash: "EH" });
  });

  it("rejects another wallet without touching the network", async () => {
    mocks.wallet.address = "GOTHER";
    const { result } = renderHook(() => usePendingOperationExecute(), {
      wrapper: makeWrapper(),
    });
    await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
      /Only the scheduling wallet/,
    );
    expect(mocks.readScheduledOperation).not.toHaveBeenCalled();
    expect(mocks.executeScheduledOperation).not.toHaveBeenCalled();
  });

  it("refuses a target other than the expected one before any RPC call", async () => {
    const { result } = renderHook(() => usePendingOperationExecute(), {
      wrapper: makeWrapper(),
    });
    const error = await result.current
      .mutateAsync({ ...INPUT, expectedTarget: "COTHER" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PendingTargetMismatchError);
    expect((error as PendingTargetMismatchError).target).toBe("CSECURITY");
    expect(mocks.readScheduledOperation).not.toHaveBeenCalled();
    expect(mocks.executeScheduledOperation).not.toHaveBeenCalled();
  });

  it("refuses while the registry is paused before any RPC call", async () => {
    const { result } = renderHook(() => usePendingOperationExecute(), {
      wrapper: makeWrapper(),
    });
    await expect(
      result.current.mutateAsync({ ...INPUT, paused: true }),
    ).rejects.toBeInstanceOf(RegistryPausedError);
    expect(mocks.readScheduledOperation).not.toHaveBeenCalled();
    expect(mocks.executeScheduledOperation).not.toHaveBeenCalled();
  });

  it("rejects a disconnected wallet, a missing AccessManager id and an EVM chain", async () => {
    mocks.wallet.isConnected = false;
    const a = renderHook(() => usePendingOperationExecute(), {
      wrapper: makeWrapper(),
    });
    await expect(a.result.current.mutateAsync(INPUT)).rejects.toThrow(
      /wallet not connected/,
    );
    mocks.wallet.isConnected = true;
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "";
    const b = renderHook(() => usePendingOperationExecute(), {
      wrapper: makeWrapper(),
    });
    await expect(b.result.current.mutateAsync(INPUT)).rejects.toThrow(
      /not configured for this environment/,
    );
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "CAM";
    const c = renderHook(() => usePendingOperationExecute(), {
      wrapper: makeWrapper(),
    });
    await expect(
      c.result.current.mutateAsync({ ...INPUT, chainId: EVM }),
    ).rejects.toThrow();
    expect(mocks.executeScheduledOperation).not.toHaveBeenCalled();
  });

  it("aborts when the recomputed operation id differs", async () => {
    mocks.readScheduledOperation.mockResolvedValue({
      operationId: "OTHER",
      readyAt: 1_800_000_000,
    });
    const { result } = renderHook(() => usePendingOperationExecute(), {
      wrapper: makeWrapper(),
    });
    await expect(result.current.mutateAsync(INPUT)).rejects.toBeInstanceOf(
      PendingArgsMismatchError,
    );
    expect(mocks.executeScheduledOperation).not.toHaveBeenCalled();
  });

  it("aborts when the operation is no longer scheduled", async () => {
    mocks.readScheduledOperation.mockResolvedValue({
      operationId: "OP1",
      readyAt: 0,
    });
    const { result } = renderHook(() => usePendingOperationExecute(), {
      wrapper: makeWrapper(),
    });
    await expect(result.current.mutateAsync(INPUT)).rejects.toBeInstanceOf(
      NoLongerScheduledError,
    );
    expect(mocks.executeScheduledOperation).not.toHaveBeenCalled();
  });

  it("executes with the scheduled arguments, marks the id and invalidates", async () => {
    fakeRelayTimers();
    const { result } = renderHook(() => usePendingOperationExecute(), {
      wrapper: makeWrapper(),
    });
    const executed = renderHook(() => useExecutedOperations(STELLAR));
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });
    expect(mocks.readScheduledOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManagerId: "CAM",
        caller: "GRC",
        target: "CSECURITY",
        fn: "set_terms",
        argsXdr: "AAAA",
      }),
    );
    expect(mocks.executeScheduledOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManagerId: "CAM",
        caller: "GRC",
        target: "CSECURITY",
        fn: "set_terms",
        argsXdr: "AAAA",
        signTransaction: mocks.sign,
      }),
    );
    expect(executed.result.current.get("OP1")).toMatchObject({
      hash: "EH",
      readyAt: 1_800_000_000,
    });
    expect(keys(spy)).toContain("loan-security");
    await waitFor(() => expect(result.current.hash).toBe("EH"));
  });

  it("also invalidates the repayment recovery and waterfall keys now, at 5 s and at 15 s", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePendingOperationExecute(), {
      wrapper: makeWrapper(),
    });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });
    const extra = [
      "repayment-recovery",
      "repayment-recovery-access",
      "loan-waterfall",
    ];
    for (const key of [...extra, "loan-book"]) {
      expect(keys(spy)).toContain(key);
    }
    const now = keys(spy).length;
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(keys(spy)).toHaveLength(now * 3);
    expect(keys(spy).filter((key) => key === "loan-waterfall")).toHaveLength(3);
  });

  it("flags matching session operations as executed here", async () => {
    fakeRelayTimers();
    recordScheduledOp({
      chainId: STELLAR,
      call: RELEASE,
      operationId: "OP1",
      readyAt: 5,
    });
    const { result } = renderHook(() => usePendingOperationExecute(), {
      wrapper: makeWrapper(),
    });
    const ops = renderHook(() => useScheduledOps(STELLAR));
    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });
    expect(ops.result.current[0]!.executedHere).toBe(true);
  });
});
