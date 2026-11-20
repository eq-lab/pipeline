// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { renderHook, act } from "@testing-library/react";
import { ApiError } from "@/api/client";
import type { CashBookRamp, CashBookResponse } from "@/api/useCashBook";

vi.mock("@/api/useCashBook", () => ({ useCashBook: vi.fn() }));
vi.mock("@/auth/sessionStore", () => ({ useSessionState: vi.fn() }));
vi.mock("@/api/useConversions", () => ({
  fetchMinterPaused: vi.fn(),
  fetchMinterRamp: vi.fn(),
  useMinterRamps: vi.fn(),
  useMinterPoolState: vi.fn(),
  useMinterPaused: vi.fn(),
  useConversionAccess: vi.fn(),
  useOpenRamp: vi.fn(),
  useCloseRamp: vi.fn(),
  useRecordExpense: vi.fn(),
}));
vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: vi.fn(),
  readWireInRefHashSeen: vi.fn(),
  wireInReturnRefHash: async (reference: string) =>
    createHash("sha256").update(reference.trim()).digest("hex"),
  parseUsdDollarsToI128: (value: string) => {
    const [whole = "0", frac = ""] = value.trim().split(".");
    if (!/^\d+$/.test(whole) || !/^\d{0,7}$/.test(frac) || value === "") {
      throw new Error("invalid");
    }
    const scaled = BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0"));
    if (scaled <= 0n) throw new Error("zero");
    return scaled;
  },
}));
const envMock = vi.hoisted(() => ({
  STELLAR_CHAIN_ID: 99_000_001,
  EVM_CHAIN_ID: 560048,
  STELLAR_RPC_URL: "https://rpc.test",
  STELLAR_NETWORK_PASSPHRASE: "Test",
  STELLAR_YIELD_MINTER_ID: "CMINTERABCDEFGHIJKLMNOP1234",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CAM",
}));
vi.mock("@/lib/env", () => ({
  get ENV() {
    return envMock;
  },
}));

import { useCashBook } from "@/api/useCashBook";
import { useSessionState } from "@/auth/sessionStore";
import {
  fetchMinterPaused,
  fetchMinterRamp,
  useCloseRamp,
  useConversionAccess,
  useMinterPaused,
  useMinterPoolState,
  useMinterRamps,
  useOpenRamp,
  useRecordExpense,
} from "@/api/useConversions";
import {
  readWireInRefHashSeen,
  useStellarWallet,
} from "@pipeline/wallet-connect";
import {
  CONVERSION_PENDING_REFETCH_MS,
  CONVERSION_PENDING_WINDOW_MS,
  CONVERSION_REFETCH_MS,
  conversionResultMessage,
  useConversionsSection,
} from "./-conversions";

const mockCashBook = vi.mocked(useCashBook);
const mockSession = vi.mocked(useSessionState);
const mockReads = vi.mocked(useMinterRamps);
const mockPool = vi.mocked(useMinterPoolState);
const mockPaused = vi.mocked(useMinterPaused);
const mockAccess = vi.mocked(useConversionAccess);
const mockSeen = vi.mocked(readWireInRefHashSeen);
const mockFetchPaused = vi.mocked(fetchMinterPaused);
const mockFetchRamp = vi.mocked(fetchMinterRamp);
const openAsync = vi.fn();
const closeAsync = vi.fn();
const expenseAsync = vi.fn();
const MINTER = "CMINTERABCDEFGHIJKLMNOP1234";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function ramp(over: Partial<CashBookRamp> = {}): CashBookRamp {
  return {
    id: 0,
    status: "Open",
    direction: "BankToUsdc",
    amount: "100",
    opened_at: "2026-11-03T10:15:00Z",
    open_ref_hash: "ab".repeat(32),
    ...over,
  };
}

function book(ramps: CashBookRamp[], minter = MINTER): CashBookResponse {
  return {
    chain_id: 99_000_001,
    minter,
    summary: { bank_cash: "0", in_flight: "0", complete: true },
    wire_ins: [],
    wire_outs: [],
    ramps,
  };
}

function setBook(state: {
  data?: CashBookResponse;
  isPending?: boolean;
  error?: Error | null;
}) {
  mockCashBook.mockReturnValue({
    data: state.data,
    isPending: state.isPending ?? false,
    isError: Boolean(state.error),
    error: state.error ?? null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCashBook>);
}

function chainRamp(over: Record<string, unknown> = {}) {
  return {
    id: 0,
    direction: "BankToUsdc",
    amount: "1000000000",
    openedAt: 1,
    closed: false,
    closedAt: 0,
    received: "0",
    ...over,
  };
}

function setReads(
  entries: { data?: unknown; isPending?: boolean; isError?: boolean }[],
) {
  mockReads.mockReturnValue(
    entries.map((e) => ({
      data: e.data,
      isPending: e.isPending ?? false,
      isError: e.isError ?? false,
    })) as unknown as ReturnType<typeof useMinterRamps>,
  );
}

function setPool(value: {
  data?: unknown;
  isError?: boolean;
  error?: Error | null;
}) {
  mockPool.mockReturnValue({
    data: value.data,
    isError: value.isError ?? false,
    error: value.error ?? null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useMinterPoolState>);
}

function setPaused(data: boolean | undefined, over: object = {}) {
  mockPaused.mockReturnValue({
    data,
    isPending: data === undefined,
    isError: false,
    ...over,
  } as unknown as ReturnType<typeof useMinterPaused>);
}

function setAccess(allowed: Partial<Record<string, boolean>> = {}) {
  mockAccess.mockImplementation(
    (fn) =>
      ({
        data: { immediate: allowed[fn] ?? true, delay: 0 },
        isPending: false,
        isError: false,
      }) as unknown as ReturnType<typeof useConversionAccess>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.STELLAR_YIELD_MINTER_ID = MINTER;
  mockSession.mockReturnValue({
    chainId: 99_000_001,
  } as unknown as ReturnType<typeof useSessionState>);
  setBook({ data: book([ramp()]) });
  setReads([{ data: chainRamp() }]);
  setPool({
    data: {
      bankCash: "7341220000000",
      inFlight: "0",
      totalAssets: "7341220000000",
      readFailed: false,
    },
  });
  setPaused(false);
  setAccess();
  vi.mocked(useStellarWallet).mockReturnValue({
    isConnected: true,
    address: "GTRUSTEE",
  } as unknown as ReturnType<typeof useStellarWallet>);
  mockSeen.mockResolvedValue(false);
  mockFetchPaused.mockResolvedValue(false);
  mockFetchRamp.mockResolvedValue(chainRamp() as never);
  const mutation = (fn: typeof openAsync) => ({
    mutateAsync: fn,
    isPending: false,
    error: null,
    stage: null,
    reset: vi.fn(),
  });
  openAsync.mockResolvedValue({ hash: "HOPEN" });
  closeAsync.mockResolvedValue({ hash: "HCLOSE" });
  expenseAsync.mockResolvedValue({ hash: "HEXP" });
  vi.mocked(useOpenRamp).mockReturnValue(mutation(openAsync));
  vi.mocked(useCloseRamp).mockReturnValue(mutation(closeAsync));
  vi.mocked(useRecordExpense).mockReturnValue(mutation(expenseAsync));
});

afterEach(() => {
  vi.useRealTimers();
});

function lastRefetchMs(): number {
  const calls = mockCashBook.mock.calls;
  return calls[calls.length - 1]![1].refetchMs;
}

function render() {
  return renderHook(() => useConversionsSection());
}

describe("EVM session", () => {
  it("is unsupported, fetches nothing and reads nothing from the chain", () => {
    mockSession.mockReturnValue({
      chainId: 560048,
    } as unknown as ReturnType<typeof useSessionState>);
    const { result } = render();
    expect(result.current.state).toBe("unsupported");
    expect(result.current.summary.state).toBe("unsupported");
    expect(result.current.unsupportedReason).toBe(
      "Conversions and bank charges on Hoodi are not available in the Trustee app yet.",
    );
    expect(mockCashBook.mock.calls.every((c) => c[1].enabled === false)).toBe(
      true,
    );
    expect(mockPool).toHaveBeenCalledWith(false);
    expect(mockPaused).toHaveBeenCalledWith(false);
    expect(mockReads.mock.calls.every((c) => c[1] === false)).toBe(true);
  });
});

describe("pool summary", () => {
  it("renders the raw chain values exactly", () => {
    const { result } = render();
    expect(result.current.summary).toMatchObject({
      state: "ready",
      bankCash: "$734,122",
      inFlight: "$0",
      totalAssets: "$734,122",
      readFailed: false,
      sourceMinter: "CMIN…1234",
    });
  });

  it("passes read_failed through and keeps fractions", () => {
    setPool({
      data: {
        bankCash: "12345670",
        inFlight: "5",
        totalAssets: "12345675",
        readFailed: true,
      },
    });
    const { summary } = render().result.current;
    expect(summary.bankCash).toBe("$1.234567");
    expect(summary.inFlight).toBe("$0.0000005");
    expect(summary.totalAssets).toBe("$1.2345675");
    expect(summary.readFailed).toBe(true);
  });

  it("shows the pool-state error copy with details", () => {
    setPool({ isError: true, error: new Error("rpc down") });
    const { summary } = render().result.current;
    expect(summary.state).toBe("error");
    expect(summary.error).toEqual({
      message: "Could not read the minter's pool state.",
      details: "rpc down",
      isSpecific: true,
    });
  });

  it("is loading before the first read", () => {
    setPool({});
    expect(render().result.current.summary.state).toBe("loading");
  });
});

describe("list", () => {
  it("maps served fields verbatim and reads only Open ids on-chain", () => {
    setBook({
      data: book([
        ramp({ id: 0 }),
        ramp({
          id: 1,
          status: "Closed",
          direction: "UsdcToBank",
          amount: "50.5",
          received: "40",
          loss: "10.5",
          closed_at: "2026-11-04T09:00:00Z",
          close_ref_hash: "cd".repeat(32),
        }),
      ]),
    });
    setReads([{ data: chainRamp() }]);
    const { result } = render();
    expect(mockReads.mock.calls.at(-1)![0]).toEqual([0]);
    const [open, closed] = result.current.rows;
    expect(open).toMatchObject({
      id: 0,
      directionLabel: "USD → USDC",
      amount: "$100",
      received: "—",
      shortfall: "—",
      chainState: "confirmed",
    });
    expect(closed).toMatchObject({
      id: 1,
      directionLabel: "USDC → USD",
      amount: "$50.5",
      received: "$40",
      shortfall: "$10.5",
      closeRefHash: "cd".repeat(32),
      chainState: null,
      chainLabel: "—",
    });
  });

  it("never derives the shortfall from amount and received", () => {
    setBook({
      data: book([
        ramp({
          status: "Closed",
          amount: "100",
          received: "60",
          loss: "0",
        }),
      ]),
    });
    setReads([]);
    expect(render().result.current.rows[0]!.shortfall).toBe("$0");
  });

  it("is empty, loading or an error with the cash-book copy", () => {
    setBook({ data: book([]) });
    setReads([]);
    const empty = render().result.current;
    expect(empty.state).toBe("empty");
    expect(empty.emptyMessage).toBe("No conversions on Stellar.");
    setBook({ isPending: true });
    expect(render().result.current.state).toBe("loading");
    for (const [status, message, text] of [
      [404, "minter_not_configured", "not configured for Stellar"],
      [403, "forbidden", "not authorized to view the cash book"],
      [401, "unauthorized", "session expired"],
    ] as const) {
      setBook({ error: new ApiError(message, status) });
      const view = render().result.current;
      expect(view.state).toBe("error");
      expect(view.error!.message).toContain(text);
    }
  });
});

describe("gating", () => {
  it("lets every action through for a Trustee on a matching minter", () => {
    const { result } = render();
    expect(result.current.actionReason("open_ramp")).toBeNull();
    expect(result.current.actionReason("record_expense")).toBeNull();
    expect(
      result.current.actionReason("close_ramp", result.current.rows[0]),
    ).toBeNull();
  });

  it("explains a missing wallet, a missing config and a minter mismatch in order", () => {
    vi.mocked(useStellarWallet).mockReturnValue({
      isConnected: false,
      address: undefined,
    } as unknown as ReturnType<typeof useStellarWallet>);
    expect(render().result.current.actionReason("open_ramp")).toMatch(
      /Connect your trustee wallet/,
    );
    vi.mocked(useStellarWallet).mockReturnValue({
      isConnected: true,
      address: "GTRUSTEE",
    } as unknown as ReturnType<typeof useStellarWallet>);
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "";
    expect(render().result.current.actionReason("open_ramp")).toMatch(
      /not configured for this environment/,
    );
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "CAM";
    setBook({ data: book([ramp()], "COTHER") });
    const { result } = render();
    expect(result.current.minterMismatch).toBe(true);
    for (const fn of ["open_ramp", "record_expense"] as const) {
      expect(result.current.actionReason(fn)).toBe(
        "The app's minter differs from the server's cash-book minter.",
      );
    }
    expect(
      result.current.actionReason("close_ramp", result.current.rows[0]),
    ).toBe("The app's minter differs from the server's cash-book minter.");
  });

  it("needs the cash book loaded to check the minter", () => {
    setBook({ isPending: true });
    expect(render().result.current.actionReason("record_expense")).toBe(
      "Checking the server's cash-book minter…",
    );
    setBook({ error: new ApiError("boom", 500) });
    expect(render().result.current.actionReason("record_expense")).toBe(
      "Could not verify the server's cash-book minter.",
    );
  });

  it("reports the role per function", () => {
    setAccess({ close_ramp: false });
    const { result } = render();
    expect(result.current.actionReason("open_ramp")).toBeNull();
    expect(
      result.current.actionReason("close_ramp", result.current.rows[0]),
    ).toBe("Only the Trustee role can close conversions.");
  });

  it("paused disables Open only", () => {
    setPaused(true);
    const { result } = render();
    expect(result.current.actionReason("open_ramp")).toBe(
      "The minter is paused; conversions cannot be opened.",
    );
    expect(result.current.actionReason("record_expense")).toBeNull();
    expect(
      result.current.actionReason("close_ramp", result.current.rows[0]),
    ).toBeNull();
    setPaused(undefined);
    expect(render().result.current.actionReason("open_ramp")).toBe(
      "Checking whether the minter is paused…",
    );
  });

  it("Close needs the row's on-chain state to be confirmed", () => {
    setReads([{ data: chainRamp({ closed: true }) }]);
    const { result } = render();
    expect(result.current.rows[0]!.chainState).toBe("closed-pending-index");
    expect(
      result.current.actionReason("close_ramp", result.current.rows[0]),
    ).toBe("Submitted — waiting for the indexer to update this list.");
  });
});

describe("polling", () => {
  it("polls slowly, goes fast after an open and falls back after the window", async () => {
    vi.useFakeTimers();
    const { result } = render();
    expect(lastRefetchMs()).toBe(CONVERSION_REFETCH_MS);
    act(() => result.current.openOpen());
    act(() => {
      result.current.setOpenDirection("BankToUsdc");
      result.current.setOpenAmount("10");
      result.current.setOpenReference("WIRE-1");
    });
    await act(async () => {
      await result.current.confirmOpen();
    });
    expect(lastRefetchMs()).toBe(CONVERSION_PENDING_REFETCH_MS);
    act(() => {
      vi.advanceTimersByTime(CONVERSION_PENDING_WINDOW_MS + 1);
    });
    expect(lastRefetchMs()).toBe(CONVERSION_REFETCH_MS);
  });
});

describe("open flow", () => {
  async function fill(
    result: ReturnType<typeof render>["result"],
    over: { amount?: string; reference?: string } = {},
  ) {
    act(() => result.current.openOpen());
    act(() => {
      result.current.setOpenDirection("UsdcToBank");
      result.current.setOpenAmount(over.amount ?? "10.5");
      result.current.setOpenReference(over.reference ?? "  WIRE-1  ");
    });
  }

  it("blocks a seen reference before signing", async () => {
    mockSeen.mockResolvedValue(true);
    const { result } = render();
    await fill(result);
    await act(async () => {
      await result.current.confirmOpen();
    });
    expect(openAsync).not.toHaveBeenCalled();
    expect(result.current.openDialog!.error!.message).toMatch(
      /already recorded on-chain/,
    );
  });

  it("blocks when the minter is paused on the re-read", async () => {
    mockFetchPaused.mockResolvedValue(true);
    const { result } = render();
    await fill(result);
    await act(async () => {
      await result.current.confirmOpen();
    });
    expect(openAsync).not.toHaveBeenCalled();
    expect(result.current.openDialog!.error!.message).toBe(
      "The minter is paused; conversions cannot be opened.",
    );
  });

  it("does not submit an invalid form", async () => {
    const { result } = render();
    await fill(result, { amount: "0" });
    await act(async () => {
      await result.current.confirmOpen();
    });
    expect(openAsync).not.toHaveBeenCalled();
    expect(mockSeen).not.toHaveBeenCalled();
  });

  it("signs the raw amount and the sha256 of the trimmed reference", async () => {
    const { result } = render();
    await fill(result);
    await act(async () => {
      await result.current.confirmOpen();
    });
    expect(openAsync).toHaveBeenCalledWith({
      direction: "UsdcToBank",
      amountRaw: "105000000",
      refHash: sha("WIRE-1"),
    });
    expect(result.current.openDialog).toBeNull();
    expect(result.current.lastResult).toEqual({
      kind: "opened",
      hash: "HOPEN",
      direction: "UsdcToBank",
      amount: "10.5",
    });
    expect(conversionResultMessage(result.current.lastResult!)).toBe(
      "Conversion opened on-chain (USDC → USD, 10.5). Transaction HOPEN. It appears in the list once indexed.",
    );
  });

  it("maps a signing failure", async () => {
    openAsync.mockRejectedValue(
      new Error("simulation error: HostError: Error(Contract, #18)"),
    );
    const { result } = render();
    await fill(result);
    await act(async () => {
      await result.current.confirmOpen();
    });
    expect(result.current.openDialog!.error!.message).toBe(
      "Custody USDC on-chain is below this amount.",
    );
    expect(result.current.openDialog!.submitting).toBe(false);
  });
});

describe("close flow", () => {
  async function openDialog(result: ReturnType<typeof render>["result"]) {
    await act(async () => {
      await result.current.openClose(result.current.rows[0]!);
    });
  }

  it("reads the ramp on open and reports a closed one", async () => {
    mockFetchRamp.mockResolvedValue(chainRamp({ closed: true }) as never);
    const { result } = render();
    await openDialog(result);
    expect(mockFetchRamp).toHaveBeenCalledWith(0);
    expect(result.current.closeDialog!.phase).toBe("closed");
  });

  it("reports a read error", async () => {
    mockFetchRamp.mockRejectedValue(new Error("rpc down"));
    const { result } = render();
    await openDialog(result);
    expect(result.current.closeDialog!.phase).toBe("read-error");
    expect(result.current.closeDialog!.error!.details).toBe("rpc down");
  });

  it("blocks received above the on-chain amount before signing", async () => {
    const { result } = render();
    await openDialog(result);
    act(() => {
      result.current.setReceivedInput("100.0000001");
      result.current.setCloseReference("CLOSE-1");
    });
    await act(async () => {
      await result.current.confirmClose();
    });
    expect(closeAsync).not.toHaveBeenCalled();
    expect(mockSeen).not.toHaveBeenCalled();
  });

  it("stops when the re-read shows the ramp closed", async () => {
    const { result } = render();
    await openDialog(result);
    act(() => {
      result.current.setReceivedInput("100");
      result.current.setCloseReference("CLOSE-1");
    });
    mockFetchRamp.mockResolvedValue(chainRamp({ closed: true }) as never);
    await act(async () => {
      await result.current.confirmClose();
    });
    expect(closeAsync).not.toHaveBeenCalled();
    expect(result.current.closeDialog!.error!.message).toBe(
      "This conversion is already closed. Refresh the list.",
    );
  });

  it("blocks a seen closing reference", async () => {
    mockSeen.mockResolvedValue(true);
    const { result } = render();
    await openDialog(result);
    act(() => {
      result.current.setReceivedInput("100");
      result.current.setCloseReference("CLOSE-1");
    });
    await act(async () => {
      await result.current.confirmClose();
    });
    expect(closeAsync).not.toHaveBeenCalled();
    expect(result.current.closeDialog!.error!.message).toMatch(
      /already recorded on-chain/,
    );
  });

  it("signs received 0 for a typed 0 and reports the on-chain received", async () => {
    const { result } = render();
    await openDialog(result);
    act(() => {
      result.current.setReceivedInput("0");
      result.current.setCloseReference(" CLOSE-1 ");
    });
    mockFetchRamp.mockResolvedValue(
      chainRamp({ closed: false, received: "0" }) as never,
    );
    await act(async () => {
      await result.current.confirmClose();
    });
    expect(closeAsync).toHaveBeenCalledWith({
      id: 0,
      receivedRaw: "0",
      refHash: sha("CLOSE-1"),
    });
    expect(result.current.closeDialog).toBeNull();
    expect(conversionResultMessage(result.current.lastResult!)).toBe(
      "Conversion #0 closed on-chain. Received 0; any shortfall is booked as an expense and shows in this list once indexed. Transaction HCLOSE.",
    );
  });

  it("uses the unverified variant when the re-read fails", async () => {
    const { result } = render();
    await openDialog(result);
    act(() => {
      result.current.setReceivedInput("40");
      result.current.setCloseReference("CLOSE-1");
    });
    mockFetchRamp
      .mockResolvedValueOnce(chainRamp() as never)
      .mockRejectedValueOnce(new Error("rpc down"));
    await act(async () => {
      await result.current.confirmClose();
    });
    expect(closeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ receivedRaw: "400000000" }),
    );
    expect(result.current.lastResult).toEqual({
      kind: "close-unverified",
      id: 0,
      hash: "HCLOSE",
    });
  });
});

describe("expense flow", () => {
  function fill(
    result: ReturnType<typeof render>["result"],
    valueDate?: string,
  ) {
    act(() => result.current.openExpense());
    act(() => {
      result.current.setExpenseAmount("5.25");
      if (valueDate) result.current.setExpenseDate(valueDate);
      result.current.setExpenseReference("FEE-1");
    });
  }

  it("blocks a future value date", async () => {
    const { result } = render();
    fill(result, "2999-01-01");
    await act(async () => {
      await result.current.confirmExpense();
    });
    expect(expenseAsync).not.toHaveBeenCalled();
  });

  it("signs the raw delta and the value date in seconds", async () => {
    const { result } = render();
    fill(result, "2026-11-09");
    await act(async () => {
      await result.current.confirmExpense();
    });
    expect(expenseAsync).toHaveBeenCalledWith({
      deltaRaw: "52500000",
      valueDate: Date.parse("2026-11-09T00:00:00Z") / 1000,
      refHash: sha("FEE-1"),
    });
    expect(conversionResultMessage(result.current.lastResult!)).toBe(
      "Bank charge of 5.25 booked on-chain, value date 2026-11-09; it was burned from the vault. Transaction HEXP. It appears in the Audit Log once indexed.",
    );
  });

  it("blocks a seen reference and maps #2 to the generic copy", async () => {
    mockSeen.mockResolvedValueOnce(true);
    const { result } = render();
    fill(result, "2026-11-09");
    await act(async () => {
      await result.current.confirmExpense();
    });
    expect(expenseAsync).not.toHaveBeenCalled();
    mockSeen.mockResolvedValue(false);
    expenseAsync.mockRejectedValue(
      new Error("simulation error: HostError: Error(Contract, #2)"),
    );
    await act(async () => {
      await result.current.confirmExpense();
    });
    expect(result.current.expenseDialog!.error!.message).not.toMatch(
      /bank cash|already recorded/,
    );
    expect(result.current.expenseDialog!.error!.details).toContain("#2");
  });
});

describe("action gating while busy", () => {
  it("disables the other actions while a dialog submits", async () => {
    let release: (value: { hash: string }) => void = () => {};
    openAsync.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { result } = render();
    act(() => result.current.openOpen());
    act(() => {
      result.current.setOpenDirection("BankToUsdc");
      result.current.setOpenAmount("1");
      result.current.setOpenReference("R");
    });
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.confirmOpen();
      await Promise.resolve();
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.actionReason("record_expense")).toBe(
      "Another action is in flight. Wait for it to finish.",
    );
    await act(async () => {
      release({ hash: "H" });
      await pending;
    });
    expect(result.current.busy).toBe(false);
  });
});
