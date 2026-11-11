// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  hubCallsFor,
  useRiskCouncilAccess,
  useRiskCouncilHubLookups,
  useRiskCouncilLoanState,
  useRiskCouncilRelay,
} from "./useRiskCouncil";
import {
  _resetRiskCouncilOpsForTests,
  recordScheduledOp,
  useScheduledOps,
} from "@/lib/riskCouncilOps";

const mocks = vi.hoisted(() => ({
  relayRiskCouncil: vi.fn(),
  readCanCall: vi.fn(),
  readRiskCouncilSchedule: vi.fn(),
  readLoanChainState: vi.fn(),
  readLoanMoney: vi.fn(),
  sign: vi.fn(),
  wallet: { address: "GRC" as string | null, isConnected: true },
}));

vi.mock("@pipeline/wallet-connect", () => ({
  relayRiskCouncil: mocks.relayRiskCouncil,
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
      "risk-council-hub",
      "loan-book",
      "loan-financials",
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

describe("hub lookups", () => {
  const loans = [
    { loan_id: "1", onchain_status: "Performing" },
    { loan_id: "2", onchain_status: "WatchList" },
    { loan_id: "3", onchain_status: "Default" },
    { loan_id: "4", onchain_status: "Closed" },
  ];

  it("builds calls only for eligible statuses and merges page-local ops", () => {
    recordScheduledOp({
      chainId: STELLAR,
      call: { fn: "set_default", loanId: 1 },
    });
    recordScheduledOp({
      chainId: STELLAR,
      call: { fn: "write_down", loanId: 3, amount: "5" },
    });
    const ops = renderHook(() => useScheduledOps(STELLAR)).result.current;
    const calls = hubCallsFor(loans, ops);
    expect(calls.map((c) => `${c.call.fn}:${c.call.loanId}`)).toEqual([
      "set_default:1",
      "set_default:2",
      "cure:3",
      "write_down:3",
    ]);
    expect(calls[0]!.pageLocal).toBeDefined();
    expect(calls[1]!.pageLocal).toBeUndefined();
  });

  it("runs one schedule read per eligible call and keeps the ready times", async () => {
    mocks.readRiskCouncilSchedule.mockImplementation(
      async ({ call }: { call: { loanId: number } }) => ({
        operationId: "x",
        readyAt: call.loanId === 2 ? 77 : 0,
      }),
    );
    const { result } = renderHook(
      () => useRiskCouncilHubLookups(STELLAR, loans, [], true),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.readRiskCouncilSchedule).toHaveBeenCalledTimes(3);
    expect(
      result.current.lookups.filter((l) => l && l.readyAt > 0),
    ).toHaveLength(1);
  });

  it("does not look anything up when disabled or on EVM", () => {
    renderHook(() => useRiskCouncilHubLookups(STELLAR, loans, [], false), {
      wrapper: makeWrapper(),
    });
    renderHook(() => useRiskCouncilHubLookups(EVM, loans, [], true), {
      wrapper: makeWrapper(),
    });
    expect(mocks.readRiskCouncilSchedule).not.toHaveBeenCalled();
  });
});
