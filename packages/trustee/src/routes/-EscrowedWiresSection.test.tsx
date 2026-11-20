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
import type { CashBookResponse, CashBookWireIn } from "@/api/useCashBook";
import type { LpDetail } from "@/api/useLp";
import type { LpSummary } from "@/api/useLps";

vi.mock("@/api/useCashBook", () => ({ useCashBook: vi.fn() }));
vi.mock("@/api/useLps", () => ({ useLps: vi.fn() }));
vi.mock("@/api/useLp", () => ({ fetchLp: vi.fn() }));
vi.mock("@/auth/sessionStore", () => ({ useSessionState: vi.fn() }));
vi.mock("@/api/useEscrowedWires", () => ({
  useMinterWireIns: vi.fn(),
  useMinterPlusdId: vi.fn(),
  useWireEscrowAccess: vi.fn(),
  useAssignWireIn: vi.fn(),
  useReturnWireIn: vi.fn(),
  fetchMinterWireIn: vi.fn(),
  ensureMinterPlusdId: vi.fn(),
}));
vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: vi.fn(),
  readPlusdAuthorization: vi.fn(),
  readWireInRefHashSeen: vi.fn(),
  wireInReturnRefHash: vi.fn(),
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
import { useLps } from "@/api/useLps";
import { fetchLp } from "@/api/useLp";
import { useSessionState } from "@/auth/sessionStore";
import {
  ensureMinterPlusdId,
  fetchMinterWireIn,
  useAssignWireIn,
  useMinterPlusdId,
  useMinterWireIns,
  useReturnWireIn,
  useWireEscrowAccess,
} from "@/api/useEscrowedWires";
import {
  readPlusdAuthorization,
  readWireInRefHashSeen,
  useStellarWallet,
  wireInReturnRefHash,
} from "@pipeline/wallet-connect";
import { EscrowedWiresSection } from "./-EscrowedWiresSection";

const mockCashBook = vi.mocked(useCashBook);
const mockLps = vi.mocked(useLps);
const mockFetchLp = vi.mocked(fetchLp);
const mockSession = vi.mocked(useSessionState);
const mockReads = vi.mocked(useMinterWireIns);
const mockAccess = vi.mocked(useWireEscrowAccess);
const mockAssignHook = vi.mocked(useAssignWireIn);
const mockReturnHook = vi.mocked(useReturnWireIn);
const mockFetchWire = vi.mocked(fetchMinterWireIn);
const mockEnsurePlusd = vi.mocked(ensureMinterPlusdId);
const mockWallet = vi.mocked(useStellarWallet);
const mockAuth = vi.mocked(readPlusdAuthorization);
const mockSeen = vi.mocked(readWireInRefHashSeen);
const mockHash = vi.mocked(wireInReturnRefHash);
const mockPlusdHook = vi.mocked(useMinterPlusdId);

const assignAsync = vi.fn();
const returnAsync = vi.fn();
const LP_ADDR = "GLPADDR000000000000000000000000000000000000000000000001";
const HASH_A = "ab".repeat(32);
const REF_HASH = "cd".repeat(32);

function wire(over: Partial<CashBookWireIn> = {}): CashBookWireIn {
  return {
    id: 5,
    status: "Escrowed",
    receiver: "CMINTER",
    amount: "1234567.123456",
    value_date: "2026-11-02T00:00:00Z",
    ref_hash: HASH_A,
    recorded_at: "2026-11-03T10:15:00Z",
    ...over,
  };
}

function book(wireIns: CashBookWireIn[], minter = "CMINTER"): CashBookResponse {
  return {
    chain_id: 99_000_001,
    minter,
    summary: { bank_cash: "0", in_flight: "0", complete: true },
    wire_ins: wireIns,
    wire_outs: [],
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

function chainWire(status: string, id = 5) {
  return {
    id,
    amount: "12345671234560",
    receiver: status === "Escrowed" ? "CMINTER" : LP_ADDR,
    refHash: HASH_A,
    returnRef: status === "Returned" ? REF_HASH : "0".repeat(64),
    status,
    valueDate: 1_700_000_000,
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
    })) as unknown as ReturnType<typeof useMinterWireIns>,
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
  } as unknown as ReturnType<typeof useWireEscrowAccess>);
}

const LPS: LpSummary[] = [
  {
    id: 2,
    legal_name: "Zeta Fund",
    stellar_address: LP_ADDR,
    address_linked_at: "2026-10-01T00:00:00Z",
  },
  {
    id: 1,
    legal_name: "Alpha Capital",
    stellar_address: "GALPHA000000000000000000000000000000000000000000000002",
    address_linked_at: "2026-10-01T00:00:00Z",
  },
  {
    id: 3,
    legal_name: "No Wallet LP",
    stellar_address: null,
    address_linked_at: null,
  },
] as LpSummary[];

function renderSection() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <EscrowedWiresSection />
    </QueryClientProvider>,
  );
}

function happyState() {
  setBook({ data: book([wire(), wire({ id: 4, status: "Assigned" })]) });
  setReads([{ data: chainWire("Escrowed") }]);
  setAccess({ data: { immediate: true, delay: 0 } });
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
  mockLps.mockReturnValue({
    data: { lps: LPS },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockPlusdHook.mockReturnValue({} as ReturnType<typeof useMinterPlusdId>);
  mockEnsurePlusd.mockResolvedValue("CPLUSD");
  mockAssignHook.mockReturnValue({
    mutateAsync: assignAsync,
    isPending: false,
    error: null,
    stage: null,
    reset: vi.fn(),
  });
  mockReturnHook.mockReturnValue({
    mutateAsync: returnAsync,
    isPending: false,
    error: null,
    stage: null,
    reset: vi.fn(),
  });
  mockHash.mockResolvedValue(REF_HASH);
  mockAuth.mockResolvedValue("authorized");
  mockSeen.mockResolvedValue(false);
  happyState();
});

describe("list and states", () => {
  it("renders only Escrowed rows with served values verbatim", () => {
    renderSection();
    expect(
      screen.getByTestId("cash-management-escrow-chain"),
    ).toHaveTextContent("Stellar");
    const row = screen.getByTestId("escrow-row-5");
    expect(row).toHaveTextContent("$1,234,567.123456");
    expect(row).toHaveTextContent("2 Nov 2026");
    expect(row).toHaveTextContent("3 Nov 2026");
    expect(row).toHaveTextContent("Escrowed (confirmed on-chain)");
    expect(within(row).getByTitle(HASH_A)).toBeInTheDocument();
    expect(screen.queryByTestId("escrow-row-4")).toBeNull();
  });

  it("shows the empty state", () => {
    setBook({ data: book([wire({ status: "Direct" })]) });
    setReads([]);
    renderSection();
    expect(screen.getByTestId("escrow-empty")).toHaveTextContent(
      "No incoming wires are in escrow.",
    );
  });

  it("shows loading skeletons", () => {
    setBook({ isPending: true });
    setReads([]);
    renderSection();
    expect(screen.getByTestId("escrow-loading")).toBeInTheDocument();
  });

  it("maps 404 minter_not_configured and 403", () => {
    setBook({ error: new ApiError("minter_not_configured", 404) });
    setReads([]);
    const first = renderSection();
    expect(screen.getByTestId("escrow-error")).toHaveTextContent(
      "The cash book is not configured for Stellar on this server.",
    );
    first.unmount();
    setBook({ error: new ApiError("forbidden", 403) });
    renderSection();
    expect(screen.getByTestId("escrow-error")).toHaveTextContent(
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
      screen.getByTestId("cash-management-escrow-chain"),
    ).toHaveTextContent("Hoodi");
    expect(screen.getByTestId("escrow-unsupported")).toHaveTextContent(
      "Escrowed wires on Hoodi are not available in the Trustee app yet.",
    );
    expect(mockCashBook.mock.calls[0]![1]).toMatchObject({ enabled: false });
  });
});

describe("row gating", () => {
  it("disables actions on a minter mismatch", () => {
    setBook({ data: book([wire()], "COTHER") });
    renderSection();
    expect(screen.getByTestId("escrow-row-5-assign")).toBeDisabled();
    expect(screen.getByTestId("escrow-row-5-reason")).toHaveTextContent(
      "The app's minter differs from the server's cash-book minter.",
    );
  });

  it("explains a disconnected wallet", () => {
    mockWallet.mockReturnValue({
      isConnected: false,
      address: undefined,
    } as unknown as ReturnType<typeof useStellarWallet>);
    renderSection();
    expect(screen.getByTestId("escrow-row-5-reason")).toHaveTextContent(
      "Connect your trustee wallet to act on escrowed wires.",
    );
  });

  it.each([
    [{ isPending: true }, "Checking this wallet's Trustee role…"],
    [{ isError: true }, "Could not verify this wallet's Trustee role."],
    [
      { data: { immediate: false, delay: 0 } },
      "Only the Trustee role can assign escrowed wires.",
    ],
    [
      { data: { immediate: false, delay: 7200 } },
      "This wallet holds the Trustee role with a 2 h delay; the app does not schedule wire assignments.",
    ],
  ])("access %j", (access, reason) => {
    setAccess(access);
    renderSection();
    expect(screen.getByTestId("escrow-row-5-assign")).toBeDisabled();
    expect(screen.getByTestId("escrow-row-5-return")).toBeDisabled();
    expect(screen.getByTestId("escrow-row-5-reason")).toHaveTextContent(reason);
  });

  it("disables actions when the chain says Direct", () => {
    setReads([{ data: chainWire("Direct") }]);
    renderSection();
    expect(screen.getByTestId("escrow-row-5-assign")).toBeDisabled();
    expect(screen.getByTestId("escrow-row-5-chain")).toHaveTextContent(
      "On-chain status Direct differs from the cash book",
    );
  });

  it("shows waiting for the indexer when the chain says Assigned", () => {
    setReads([{ data: chainWire("Assigned") }]);
    renderSection();
    expect(screen.getByTestId("escrow-row-5-chain")).toHaveTextContent(
      "Assigned on-chain — waiting for the indexer",
    );
    expect(screen.getByTestId("escrow-row-5-assign")).toBeDisabled();
    expect(screen.getByTestId("escrow-row-5-return")).toBeDisabled();
  });

  it("disables actions when the on-chain read failed", () => {
    setReads([{ isError: true }]);
    renderSection();
    expect(screen.getByTestId("escrow-row-5-chain")).toHaveTextContent(
      "Could not confirm on-chain",
    );
    expect(screen.getByTestId("escrow-row-5-assign")).toBeDisabled();
  });
});

async function openAssign() {
  renderSection();
  fireEvent.click(screen.getByTestId("escrow-row-5-assign"));
  return screen.findByTestId("escrow-assign-dialog");
}

async function selectLp(id: string) {
  fireEvent.change(screen.getByTestId("escrow-assign-lp"), {
    target: { value: id },
  });
}

describe("assign", () => {
  const FRESH = {
    id: 2,
    legal_name: "Zeta Fund",
    stellar_address: LP_ADDR,
    address_linked_at: "2026-10-01T00:00:00Z",
  } as LpDetail;

  it("lists only linked Stellar LPs sorted by name", async () => {
    const dialog = await openAssign();
    const options = within(dialog).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Select a lender…",
      expect.stringContaining("Alpha Capital"),
      expect.stringContaining("Zeta Fund"),
    ]);
  });

  it("assigns after the authorisation, LP and wire re-reads", async () => {
    mockFetchLp.mockResolvedValue(FRESH);
    mockFetchWire
      .mockResolvedValueOnce(chainWire("Escrowed") as never)
      .mockResolvedValueOnce(chainWire("Assigned") as never);
    assignAsync.mockResolvedValue({ hash: "TXHASH" });
    await openAssign();
    await selectLp("2");
    await waitFor(() =>
      expect(screen.getByTestId("escrow-assign-auth")).toHaveTextContent(
        "authorised to hold PLUSD",
      ),
    );
    expect(screen.getByTestId("escrow-assign-receiver")).toHaveTextContent(
      LP_ADDR,
    );
    fireEvent.click(screen.getByTestId("escrow-assign-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("escrow-result")).toBeInTheDocument(),
    );
    expect(assignAsync).toHaveBeenCalledWith({ id: 5, receiver: LP_ADDR });
    expect(mockFetchLp).toHaveBeenCalledWith(2);
    expect(screen.getByTestId("escrow-result")).toHaveTextContent(
      `Wire #5 assigned on-chain to Zeta Fund (${LP_ADDR}). Status Assigned. Transaction TXHASH. It leaves this list once indexed.`,
    );
    expect(screen.queryByTestId("escrow-assign-dialog")).toBeNull();
  });

  it.each([
    ["not-authorized", "not authorised to hold PLUSD. It cannot receive"],
    ["no-trustline", "has no PLUSD trustline"],
  ] as const)("blocks %s", async (phase, copy) => {
    mockAuth.mockResolvedValue(phase);
    await openAssign();
    await selectLp("2");
    await waitFor(() =>
      expect(screen.getByTestId("escrow-assign-auth")).toHaveTextContent(copy),
    );
    expect(screen.getByTestId("escrow-assign-confirm")).toBeDisabled();
  });

  it("returns to select when the settlement address changed", async () => {
    mockFetchLp.mockResolvedValue({
      ...FRESH,
      stellar_address: "GNEWADDR0000000000000000000000000000000000000000000009",
    });
    await openAssign();
    await selectLp("2");
    await waitFor(() =>
      expect(screen.getByTestId("escrow-assign-confirm")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("escrow-assign-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("escrow-assign-notice")).toHaveTextContent(
        "settlement address changed",
      ),
    );
    expect(assignAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("escrow-assign-confirm")).toBeDisabled();
  });

  it("aborts when the wire is no longer escrowed", async () => {
    mockFetchLp.mockResolvedValue(FRESH);
    mockFetchWire.mockResolvedValue(chainWire("Assigned") as never);
    await openAssign();
    await selectLp("2");
    await waitFor(() =>
      expect(screen.getByTestId("escrow-assign-confirm")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("escrow-assign-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("escrow-assign-error")).toHaveTextContent(
        "This wire is no longer in escrow. Refresh the list.",
      ),
    );
    expect(assignAsync).not.toHaveBeenCalled();
  });

  it("shows the wallet rejection copy", async () => {
    mockFetchLp.mockResolvedValue(FRESH);
    mockFetchWire.mockResolvedValue(chainWire("Escrowed") as never);
    assignAsync.mockRejectedValue(new Error("User rejected the request"));
    await openAssign();
    await selectLp("2");
    await waitFor(() =>
      expect(screen.getByTestId("escrow-assign-confirm")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("escrow-assign-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("escrow-assign-error")).toHaveTextContent(
        "You cancelled the transaction in your wallet.",
      ),
    );
  });

  it("Escape and backdrop cancel without confirming", async () => {
    await openAssign();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("escrow-assign-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("escrow-row-5-assign"));
    fireEvent.click(await screen.findByTestId("escrow-assign-backdrop"));
    expect(screen.queryByTestId("escrow-assign-dialog")).toBeNull();
    expect(assignAsync).not.toHaveBeenCalled();
  });

  it("blocks cancel while a step is pending", async () => {
    mockFetchLp.mockResolvedValue(FRESH);
    mockFetchWire.mockResolvedValue(chainWire("Escrowed") as never);
    assignAsync.mockReturnValue(new Promise(() => {}));
    await openAssign();
    await selectLp("2");
    await waitFor(() =>
      expect(screen.getByTestId("escrow-assign-confirm")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("escrow-assign-confirm"));
    await waitFor(() => expect(assignAsync).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("escrow-assign-backdrop"));
    expect(screen.getByTestId("escrow-assign-dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});

describe("return", () => {
  async function openReturn() {
    renderSection();
    fireEvent.click(screen.getByTestId("escrow-row-5-return"));
    return screen.findByTestId("escrow-return-dialog");
  }

  it("validates the reference and shows the hash", async () => {
    await openReturn();
    const confirm = screen.getByTestId("escrow-return-confirm");
    expect(confirm).toBeDisabled();
    const input = screen.getByTestId("escrow-return-reference");
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByTestId("escrow-return-validation")).toHaveTextContent(
      "Enter the outgoing wire's bank reference.",
    );
    fireEvent.change(input, { target: { value: "x".repeat(141) } });
    expect(screen.getByTestId("escrow-return-validation")).toHaveTextContent(
      "at most 140",
    );
    fireEvent.change(input, { target: { value: "WIRE-OUT-9" } });
    await waitFor(() =>
      expect(screen.getByTestId("escrow-return-hash")).toHaveTextContent(
        REF_HASH,
      ),
    );
    expect(confirm).toBeEnabled();
  });

  it("returns after ref_hash_seen is false", async () => {
    mockFetchWire
      .mockResolvedValueOnce(chainWire("Escrowed") as never)
      .mockResolvedValueOnce(chainWire("Returned") as never);
    returnAsync.mockResolvedValue({ hash: "RTX" });
    await openReturn();
    fireEvent.change(screen.getByTestId("escrow-return-reference"), {
      target: { value: "WIRE-OUT-9" },
    });
    fireEvent.click(screen.getByTestId("escrow-return-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("escrow-result")).toBeInTheDocument(),
    );
    expect(mockSeen).toHaveBeenCalledWith(
      expect.objectContaining({ minterId: "CMINTER", refHash: REF_HASH }),
    );
    expect(returnAsync).toHaveBeenCalledWith({ id: 5, refHash: REF_HASH });
    expect(screen.getByTestId("escrow-result")).toHaveTextContent(
      `Wire #5 returned on-chain. Status Returned, return reference ${REF_HASH}. Transaction RTX. It leaves this list once indexed.`,
    );
  });

  it("blocks a reused reference without signing", async () => {
    mockSeen.mockResolvedValue(true);
    await openReturn();
    fireEvent.change(screen.getByTestId("escrow-return-reference"), {
      target: { value: "WIRE-OUT-9" },
    });
    fireEvent.click(screen.getByTestId("escrow-return-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("escrow-return-error")).toHaveTextContent(
        "This bank reference is already recorded on-chain.",
      ),
    );
    expect(returnAsync).not.toHaveBeenCalled();
  });

  it("aborts when the wire is no longer escrowed", async () => {
    mockFetchWire.mockResolvedValue(chainWire("Returned") as never);
    await openReturn();
    fireEvent.change(screen.getByTestId("escrow-return-reference"), {
      target: { value: "WIRE-OUT-9" },
    });
    fireEvent.click(screen.getByTestId("escrow-return-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("escrow-return-error")).toHaveTextContent(
        "no longer in escrow",
      ),
    );
    expect(returnAsync).not.toHaveBeenCalled();
  });

  it("Escape cancels and blocks while pending", async () => {
    await openReturn();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("escrow-return-dialog")).toBeNull();
    mockFetchWire.mockResolvedValue(chainWire("Escrowed") as never);
    returnAsync.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByTestId("escrow-row-5-return"));
    await screen.findByTestId("escrow-return-dialog");
    fireEvent.change(screen.getByTestId("escrow-return-reference"), {
      target: { value: "WIRE-OUT-9" },
    });
    fireEvent.click(screen.getByTestId("escrow-return-confirm"));
    await waitFor(() => expect(returnAsync).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("escrow-return-backdrop"));
    expect(screen.getByTestId("escrow-return-dialog")).toBeInTheDocument();
  });
});
