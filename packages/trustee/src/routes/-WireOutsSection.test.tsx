// spec: docs/frontend/trustee-flows.md#cash-management--bank-wire-outs
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import type { CashBookResponse, CashBookWireOut } from "@/api/useCashBook";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    className,
    "data-testid": testId,
  }: {
    children: React.ReactNode;
    params: { id: string };
    className?: string;
    "data-testid"?: string;
  }) => (
    <a
      href={`/lp-counterparties/${params.id}`}
      className={className}
      data-testid={testId}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/api/useCashBook", () => ({ useCashBook: vi.fn() }));
vi.mock("@/auth/sessionStore", () => ({ useSessionState: vi.fn() }));
vi.mock("@/api/useEscrowedWires", () => ({
  useMinterPlusdId: vi.fn(),
  ensureMinterPlusdId: vi.fn(),
}));
vi.mock("@/api/useWireOuts", () => ({
  useWireOutRecords: vi.fn(),
  useWireOutAccess: vi.fn(),
  useSettleWireOut: vi.fn(),
  useCancelWireOut: vi.fn(),
  fetchWireOutRecord: vi.fn(),
}));
vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: vi.fn(),
  readPlusdAuthorization: vi.fn(),
  readWireInRefHashSeen: vi.fn(),
  wireInReturnRefHash: vi.fn(),
  parseUsdDollarsToI128: (value: string) => {
    const [whole = "0", frac = ""] = value.split(".");
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
  STELLAR_YIELD_MINTER_ID: "CMINTER",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CAM",
}));
vi.mock("@/lib/env", () => ({
  get ENV() {
    return envMock;
  },
}));

import { useCashBook } from "@/api/useCashBook";
import { useSessionState } from "@/auth/sessionStore";
import { ensureMinterPlusdId, useMinterPlusdId } from "@/api/useEscrowedWires";
import {
  fetchWireOutRecord,
  useCancelWireOut,
  useSettleWireOut,
  useWireOutAccess,
  useWireOutRecords,
} from "@/api/useWireOuts";
import {
  readPlusdAuthorization,
  readWireInRefHashSeen,
  useStellarWallet,
  wireInReturnRefHash,
} from "@pipeline/wallet-connect";
import { WireOutsSection } from "./-WireOutsSection";

const mockCashBook = vi.mocked(useCashBook);
const mockSession = vi.mocked(useSessionState);
const mockReads = vi.mocked(useWireOutRecords);
const mockAccess = vi.mocked(useWireOutAccess);
const mockSettleHook = vi.mocked(useSettleWireOut);
const mockCancelHook = vi.mocked(useCancelWireOut);
const mockFetchRecord = vi.mocked(fetchWireOutRecord);
const mockEnsurePlusd = vi.mocked(ensureMinterPlusdId);
const mockWallet = vi.mocked(useStellarWallet);
const mockAuth = vi.mocked(readPlusdAuthorization);
const mockSeen = vi.mocked(readWireInRefHashSeen);
const mockHash = vi.mocked(wireInReturnRefHash);
const mockPlusdHook = vi.mocked(useMinterPlusdId);

const settleAsync = vi.fn();
const cancelAsync = vi.fn();
const LP_ADDR = "GLPADDR000000000000000000000000000000000000000000000001";
const REF_HASH = "cd".repeat(32);
const SERVED_HASH = "ef".repeat(32);

function wireOut(over: Partial<CashBookWireOut> = {}): CashBookWireOut {
  return {
    id: 5,
    status: "Pending",
    lp: LP_ADDR,
    lp_id: 2,
    lp_legal_name: "Zeta Fund",
    amount: "1234567.123456",
    requested_at: "2026-11-03T10:15:00Z",
    ...over,
  };
}

function book(
  wireOuts: CashBookWireOut[],
  minter = "CMINTER",
): CashBookResponse {
  return {
    chain_id: 99_000_001,
    minter,
    summary: { bank_cash: "0", in_flight: "0", complete: true },
    wire_ins: [],
    wire_outs: wireOuts,
    ramps: [],
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

function chainRecord(status: string, id = 5) {
  return {
    id,
    lp: LP_ADDR,
    amount: "12345671234567",
    requestedAt: 1_700_000_000,
    status,
    refHash: "0".repeat(64),
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
    })) as unknown as ReturnType<typeof useWireOutRecords>,
  );
}

function setAccess(value: {
  data?: { immediate: boolean; delay: number };
  isPending?: boolean;
  isError?: boolean;
}) {
  mockAccess.mockReturnValue({
    data: value.data,
    isPending: value.isPending ?? false,
    isError: value.isError ?? false,
  } as unknown as ReturnType<typeof useWireOutAccess>);
}

function renderSection() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <WireOutsSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.STELLAR_YIELD_MINTER_ID = "CMINTER";
  envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "CAM";
  mockSession.mockReturnValue({
    status: "authenticated",
    address: "GTRUSTEE",
    chainId: 99_000_001,
  } as unknown as ReturnType<typeof useSessionState>);
  mockWallet.mockReturnValue({
    isConnected: true,
    address: "GTRUSTEE",
  } as unknown as ReturnType<typeof useStellarWallet>);
  mockPlusdHook.mockReturnValue({} as ReturnType<typeof useMinterPlusdId>);
  mockEnsurePlusd.mockResolvedValue("CPLUSD");
  mockSettleHook.mockReturnValue({
    mutateAsync: settleAsync,
    isPending: false,
    error: null,
    stage: null,
    reset: vi.fn(),
  });
  mockCancelHook.mockReturnValue({
    mutateAsync: cancelAsync,
    isPending: false,
    error: null,
    stage: null,
    reset: vi.fn(),
  });
  mockHash.mockResolvedValue(REF_HASH);
  mockAuth.mockResolvedValue("authorized");
  mockSeen.mockResolvedValue(false);
  setBook({
    data: book([
      wireOut(),
      wireOut({
        id: 4,
        status: "Settled",
        lp_id: undefined,
        lp_legal_name: undefined,
        settled_at: "2026-11-04T09:00:00Z",
        value_date: "2026-11-04T00:00:00Z",
        ref_hash: SERVED_HASH,
      }),
      wireOut({
        id: 3,
        status: "Cancelled",
        cancelled_at: "2026-11-02T08:30:00Z",
      }),
    ]),
  });
  setReads([{ data: chainRecord("Pending") }]);
  setAccess({ data: { immediate: true, delay: 0 } });
});

describe("list and states", () => {
  it("renders served rows verbatim in served order", () => {
    renderSection();
    expect(
      screen.getByTestId("cash-management-wireouts-chain"),
    ).toHaveTextContent("Stellar");
    const row = screen.getByTestId("wireout-row-5");
    expect(row).toHaveTextContent("1,234,567.123456 PLUSD");
    expect(row).toHaveTextContent("3 Nov 2026");
    expect(row).toHaveTextContent("Pending (confirmed on-chain)");
    expect(within(row).getByTestId("wireout-row-5-lender")).toHaveAttribute(
      "href",
      "/lp-counterparties/2",
    );
    expect(within(row).getByTitle(LP_ADDR)).toBeInTheDocument();
    const settled = screen.getByTestId("wireout-row-4");
    expect(settled).toHaveTextContent("—");
    expect(
      within(settled).getByTestId("wireout-row-4-lender"),
    ).toHaveTextContent("—");
    expect(
      within(settled).getByTestId("wireout-row-4-settled"),
    ).toHaveTextContent("Settled 4 Nov 2026, 09:00 UTC");
    expect(within(settled).getByTitle(SERVED_HASH)).toBeInTheDocument();
    expect(screen.getByTestId("wireout-row-3-cancelled")).toHaveTextContent(
      "Cancelled 2 Nov 2026, 08:30 UTC",
    );
    expect(screen.queryByTestId("wireout-row-4-settle")).toBeNull();
    expect(screen.queryByTestId("wireout-row-3-cancel")).toBeNull();
  });

  it("shows the empty state", () => {
    setBook({ data: book([]) });
    setReads([]);
    renderSection();
    expect(screen.getByTestId("wireout-empty")).toHaveTextContent(
      "No bank wire-outs on Stellar.",
    );
  });

  it("shows loading skeletons", () => {
    setBook({ isPending: true });
    setReads([]);
    renderSection();
    expect(screen.getByTestId("wireout-loading")).toBeInTheDocument();
  });

  it("maps 404 minter_not_configured and 403", () => {
    setBook({ error: new ApiError("minter_not_configured", 404) });
    setReads([]);
    const first = renderSection();
    expect(screen.getByTestId("wireout-error")).toHaveTextContent(
      "The cash book is not configured for Stellar on this server.",
    );
    first.unmount();
    setBook({ error: new ApiError("forbidden", 403) });
    renderSection();
    expect(screen.getByTestId("wireout-error")).toHaveTextContent(
      "Your trustee account is not authorized to view the cash book.",
    );
  });

  it("shows the EVM reason and does not fetch", () => {
    mockSession.mockReturnValue({
      status: "authenticated",
      address: "0xabc",
      chainId: 560048,
    } as unknown as ReturnType<typeof useSessionState>);
    setBook({ isPending: true });
    setReads([]);
    renderSection();
    expect(
      screen.getByTestId("cash-management-wireouts-chain"),
    ).toHaveTextContent("Hoodi");
    expect(screen.getByTestId("wireout-unsupported")).toHaveTextContent(
      "Bank wire-outs on Hoodi are not available in the Trustee app yet.",
    );
    expect(mockCashBook.mock.calls[0]![1]).toMatchObject({ enabled: false });
  });

  it("only requests on-chain reads for Pending ids", () => {
    renderSection();
    expect(mockReads.mock.calls[0]![0]).toEqual([5]);
  });
});

describe("row gating", () => {
  it("disables actions on a minter mismatch", () => {
    setBook({ data: book([wireOut()], "COTHER") });
    renderSection();
    expect(screen.getByTestId("wireout-row-5-settle")).toBeDisabled();
    expect(screen.getByTestId("wireout-minter-mismatch")).toBeInTheDocument();
    expect(screen.getByTestId("wireout-row-5-reason")).toHaveTextContent(
      "The app's minter differs from the server's cash-book minter.",
    );
  });

  it("explains a disconnected wallet and an unconfigured environment", () => {
    mockWallet.mockReturnValue({
      isConnected: false,
      address: undefined,
    } as unknown as ReturnType<typeof useStellarWallet>);
    const first = renderSection();
    expect(screen.getByTestId("wireout-row-5-reason")).toHaveTextContent(
      "Connect your trustee wallet to act on bank wire-outs.",
    );
    first.unmount();
    mockWallet.mockReturnValue({
      isConnected: true,
      address: "GTRUSTEE",
    } as unknown as ReturnType<typeof useStellarWallet>);
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "";
    renderSection();
    expect(screen.getByTestId("wireout-row-5-reason")).toHaveTextContent(
      "Bank wire-out actions are not configured for this environment.",
    );
  });

  it.each([
    [{ isPending: true }, "Checking this wallet's Trustee role…"],
    [{ isError: true }, "Could not verify this wallet's Trustee role."],
    [
      { data: { immediate: false, delay: 0 } },
      "Only the Trustee role can settle bank wire-outs.",
    ],
    [
      { data: { immediate: false, delay: 7200 } },
      "This wallet holds the Trustee role with a 2 h delay; the app does not schedule wire-out settlements.",
    ],
  ])("access %j", (access, reason) => {
    setAccess(access);
    renderSection();
    expect(screen.getByTestId("wireout-row-5-settle")).toBeDisabled();
    expect(screen.getByTestId("wireout-row-5-cancel")).toBeDisabled();
    expect(screen.getByTestId("wireout-row-5-reason")).toHaveTextContent(
      reason,
    );
  });

  it("shows waiting for the indexer when the chain says Settled", () => {
    setReads([{ data: chainRecord("Settled") }]);
    renderSection();
    expect(screen.getByTestId("wireout-row-5-chain")).toHaveTextContent(
      "Settled on-chain — waiting for the indexer",
    );
    expect(screen.getByTestId("wireout-row-5-settle")).toBeDisabled();
    expect(screen.getByTestId("wireout-row-5-cancel")).toBeDisabled();
  });

  it("disables actions when the on-chain read failed", () => {
    setReads([{ isError: true }]);
    renderSection();
    expect(screen.getByTestId("wireout-row-5-chain")).toHaveTextContent(
      "Could not confirm on-chain",
    );
    expect(screen.getByTestId("wireout-row-5-settle")).toBeDisabled();
  });
});

async function openSettle() {
  renderSection();
  fireEvent.click(screen.getByTestId("wireout-row-5-settle"));
  return screen.findByTestId("wireout-settle-dialog");
}

function fillReference(value = "WIRE-OUT-9") {
  fireEvent.change(screen.getByTestId("wireout-settle-reference"), {
    target: { value },
  });
}

describe("settle", () => {
  it("shows the summary, the destination placeholder and the pre-filled amount", async () => {
    const dialog = await openSettle();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("wireout-settle-destination")).toHaveTextContent(
      "—",
    );
    expect(
      screen.getByTestId("wireout-settle-destination-hint"),
    ).toHaveTextContent(
      "The API does not serve the lender's bank account yet.",
    );
    expect(screen.getByTestId("wireout-settle-amount")).toHaveValue(
      "1234567.1234567",
    );
    expect(screen.getByTestId("wireout-settle-confirm")).toBeDisabled();
    fillReference();
    await waitFor(() =>
      expect(screen.getByTestId("wireout-settle-hash")).toHaveTextContent(
        REF_HASH,
      ),
    );
    expect(screen.getByTestId("wireout-settle-confirm")).toBeEnabled();
  });

  it("blocks an amount that differs from the requested amount", async () => {
    await openSettle();
    fillReference();
    fireEvent.change(screen.getByTestId("wireout-settle-amount"), {
      target: { value: "1234567.123456" },
    });
    expect(screen.getByTestId("wireout-settle-validation")).toHaveTextContent(
      "The minter settles only the full requested amount (1234567.1234567 PLUSD).",
    );
    expect(screen.getByTestId("wireout-settle-confirm")).toBeDisabled();
    expect(settleAsync).not.toHaveBeenCalled();
  });

  it("blocks a future value date and a missing reference", async () => {
    await openSettle();
    expect(screen.getByTestId("wireout-settle-validation")).toHaveTextContent(
      "Enter the outgoing wire's bank reference.",
    );
    fireEvent.change(screen.getByTestId("wireout-settle-date"), {
      target: { value: "2999-01-01" },
    });
    expect(screen.getByTestId("wireout-settle-validation")).toHaveTextContent(
      "The value date cannot be in the future.",
    );
  });

  it("settles with the on-chain raw amount and the hash of the reference", async () => {
    mockFetchRecord
      .mockResolvedValueOnce(chainRecord("Pending") as never)
      .mockResolvedValueOnce(chainRecord("Settled") as never);
    settleAsync.mockResolvedValue({ hash: "TXHASH" });
    await openSettle();
    fillReference();
    fireEvent.change(screen.getByTestId("wireout-settle-date"), {
      target: { value: "2026-11-05" },
    });
    fireEvent.click(screen.getByTestId("wireout-settle-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("wireout-result")).toBeInTheDocument(),
    );
    expect(mockSeen).toHaveBeenCalledWith(
      expect.objectContaining({ minterId: "CMINTER", refHash: REF_HASH }),
    );
    expect(settleAsync).toHaveBeenCalledWith({
      id: 5,
      amountRaw: "12345671234567",
      valueDate: 1_793_836_800,
      refHash: REF_HASH,
    });
    expect(screen.getByTestId("wireout-result")).toHaveTextContent(
      "Wire-out #5 settled on-chain. Status Settled; the escrowed PLUSD was burned. Transaction TXHASH. It updates in this list once indexed.",
    );
    expect(screen.queryByTestId("wireout-settle-dialog")).toBeNull();
  });

  it("reports an unverified result when the re-read fails", async () => {
    mockFetchRecord
      .mockResolvedValueOnce(chainRecord("Pending") as never)
      .mockRejectedValueOnce(new Error("rpc down"));
    settleAsync.mockResolvedValue({ hash: "TXHASH" });
    await openSettle();
    fillReference();
    fireEvent.click(screen.getByTestId("wireout-settle-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("wireout-result")).toHaveTextContent(
        "settled on-chain, but the result could not be re-read",
      ),
    );
  });

  it("blocks a reused reference without signing", async () => {
    mockSeen.mockResolvedValue(true);
    await openSettle();
    fillReference();
    fireEvent.click(screen.getByTestId("wireout-settle-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("wireout-settle-error")).toHaveTextContent(
        "This bank reference is already recorded on-chain.",
      ),
    );
    expect(settleAsync).not.toHaveBeenCalled();
  });

  it("aborts when the wire-out is no longer pending", async () => {
    mockFetchRecord.mockResolvedValue(chainRecord("Settled") as never);
    await openSettle();
    fillReference();
    fireEvent.click(screen.getByTestId("wireout-settle-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("wireout-settle-error")).toHaveTextContent(
        "This wire-out is no longer pending. Refresh the list.",
      ),
    );
    expect(settleAsync).not.toHaveBeenCalled();
  });

  it("aborts when the fresh on-chain amount differs from the form", async () => {
    mockFetchRecord.mockResolvedValue({
      ...chainRecord("Pending"),
      amount: "12345671234568",
    } as never);
    await openSettle();
    fillReference();
    fireEvent.click(screen.getByTestId("wireout-settle-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("wireout-settle-error")).toHaveTextContent(
        "The minter settles only the full requested amount",
      ),
    );
    expect(settleAsync).not.toHaveBeenCalled();
  });

  it("maps a contract error and keeps the verbatim details", async () => {
    mockFetchRecord.mockResolvedValue(chainRecord("Pending") as never);
    settleAsync.mockRejectedValue(
      new Error("simulation error: Error(Contract, #8)"),
    );
    await openSettle();
    fillReference();
    fireEvent.click(screen.getByTestId("wireout-settle-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("wireout-settle-error")).toHaveTextContent(
        "The minter's bank cash is below this amount.",
      ),
    );
    fireEvent.click(screen.getByText(/view details/i));
    expect(screen.getByTestId("wireout-settle-error")).toHaveTextContent(
      "Error(Contract, #8)",
    );
  });

  it("shows the stage label while signing", async () => {
    mockFetchRecord.mockResolvedValue(chainRecord("Pending") as never);
    settleAsync.mockReturnValue(new Promise(() => {}));
    mockSettleHook.mockReturnValue({
      mutateAsync: settleAsync,
      isPending: true,
      error: null,
      stage: "awaiting-signature",
      reset: vi.fn(),
    });
    await openSettle();
    fillReference();
    fireEvent.click(screen.getByTestId("wireout-settle-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("wireout-settle-confirm")).toHaveTextContent(
        "Awaiting signature…",
      ),
    );
  });

  it("Escape and backdrop cancel, and are blocked while pending", async () => {
    await openSettle();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("wireout-settle-dialog")).toBeNull();
    mockFetchRecord.mockResolvedValue(chainRecord("Pending") as never);
    settleAsync.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByTestId("wireout-row-5-settle"));
    await screen.findByTestId("wireout-settle-dialog");
    fillReference();
    fireEvent.click(screen.getByTestId("wireout-settle-confirm"));
    await waitFor(() => expect(settleAsync).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("wireout-settle-backdrop"));
    expect(screen.getByTestId("wireout-settle-dialog")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("wireout-settle-dialog")).getByRole("button", {
        name: "Cancel",
      }),
    ).toBeDisabled();
  });
});

describe("cancel", () => {
  async function openCancel() {
    renderSection();
    fireEvent.click(screen.getByTestId("wireout-row-5-cancel"));
    return screen.findByTestId("wireout-cancel-dialog");
  }

  it("cancels after the authorisation and wire-out re-reads", async () => {
    mockFetchRecord
      .mockResolvedValueOnce(chainRecord("Pending") as never)
      .mockResolvedValueOnce(chainRecord("Cancelled") as never);
    cancelAsync.mockResolvedValue({ hash: "CTX" });
    await openCancel();
    await waitFor(() =>
      expect(screen.getByTestId("wireout-cancel-auth")).toHaveTextContent(
        "authorised to hold PLUSD",
      ),
    );
    expect(mockAuth).toHaveBeenCalledWith(
      expect.objectContaining({ plusdId: "CPLUSD", address: LP_ADDR }),
    );
    expect(
      screen.getByText("The escrowed PLUSD returns to the lender's address."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wireout-cancel-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("wireout-result")).toBeInTheDocument(),
    );
    expect(cancelAsync).toHaveBeenCalledWith({ id: 5 });
    expect(screen.getByTestId("wireout-result")).toHaveTextContent(
      `Wire-out #5 cancelled on-chain. Status Cancelled; the PLUSD was returned to ${LP_ADDR}. Transaction CTX.`,
    );
  });

  it.each([
    ["not-authorized", "Cancel is blocked until it is authorised again."],
    ["no-trustline", "has no PLUSD trustline"],
  ] as const)("blocks %s", async (phase, copy) => {
    mockAuth.mockResolvedValue(phase);
    await openCancel();
    await waitFor(() =>
      expect(screen.getByTestId("wireout-cancel-auth")).toHaveTextContent(copy),
    );
    expect(screen.getByTestId("wireout-cancel-confirm")).toBeDisabled();
  });

  it("shows a read error and blocks confirm", async () => {
    mockAuth.mockRejectedValue(new Error("rpc down"));
    await openCancel();
    await waitFor(() =>
      expect(screen.getByTestId("wireout-cancel-error")).toHaveTextContent(
        "Could not check the lender's PLUSD authorisation.",
      ),
    );
    expect(screen.getByTestId("wireout-cancel-confirm")).toBeDisabled();
  });

  it("shows the mapped #16 message with the verbatim details", async () => {
    mockFetchRecord.mockResolvedValue(chainRecord("Pending") as never);
    cancelAsync.mockRejectedValue(
      new Error("simulation error: Error(Contract, #16)"),
    );
    await openCancel();
    await waitFor(() =>
      expect(screen.getByTestId("wireout-cancel-confirm")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("wireout-cancel-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("wireout-cancel-error")).toHaveTextContent(
        "This lender's address is not authorised to hold PLUSD, so the PLUSD cannot be returned.",
      ),
    );
    fireEvent.click(screen.getByText(/view details/i));
    expect(screen.getByTestId("wireout-cancel-error")).toHaveTextContent(
      "Error(Contract, #16)",
    );
  });

  it("aborts when the wire-out is no longer pending", async () => {
    mockFetchRecord.mockResolvedValue(chainRecord("Cancelled") as never);
    await openCancel();
    await waitFor(() =>
      expect(screen.getByTestId("wireout-cancel-confirm")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("wireout-cancel-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("wireout-cancel-error")).toHaveTextContent(
        "no longer pending",
      ),
    );
    expect(cancelAsync).not.toHaveBeenCalled();
  });

  it("blocks when the authorisation changed before signing", async () => {
    mockFetchRecord.mockResolvedValue(chainRecord("Pending") as never);
    await openCancel();
    await waitFor(() =>
      expect(screen.getByTestId("wireout-cancel-confirm")).toBeEnabled(),
    );
    mockAuth.mockResolvedValue("not-authorized");
    fireEvent.click(screen.getByTestId("wireout-cancel-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("wireout-cancel-auth")).toHaveTextContent(
        "Cancel is blocked",
      ),
    );
    expect(cancelAsync).not.toHaveBeenCalled();
  });

  it("Escape cancels the dialog", async () => {
    await openCancel();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("wireout-cancel-dialog")).toBeNull();
  });
});
