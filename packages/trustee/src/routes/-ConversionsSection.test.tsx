// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import type { CashBookRamp, CashBookResponse } from "@/api/useCashBook";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
    "data-testid": testId,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
    "data-testid"?: string;
  }) => (
    <a href={to} className={className} data-testid={testId}>
      {children}
    </a>
  ),
}));
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
  wireInReturnRefHash: vi.fn(),
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
  wireInReturnRefHash,
} from "@pipeline/wallet-connect";
import { ConversionsSection } from "./-ConversionsSection";

const MINTER = "CMINTERABCDEFGHIJKLMNOP1234";
const REF_HASH = "cd".repeat(32);
const openAsync = vi.fn();
const closeAsync = vi.fn();
const expenseAsync = vi.fn();
let openStage: string | null = null;

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

function setBook(ramps: CashBookRamp[], minter = MINTER) {
  const data: CashBookResponse = {
    chain_id: 99_000_001,
    minter,
    summary: { bank_cash: "0", in_flight: "0", complete: true },
    wire_ins: [],
    wire_outs: [],
    ramps,
  };
  vi.mocked(useCashBook).mockReturnValue({
    data,
    isPending: false,
    isError: false,
    error: null,
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

function mutation(fn: typeof openAsync, stage: string | null = null) {
  return {
    mutateAsync: fn,
    isPending: false,
    error: null,
    stage,
    reset: vi.fn(),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  openStage = null;
  vi.mocked(useSessionState).mockReturnValue({
    chainId: 99_000_001,
  } as unknown as ReturnType<typeof useSessionState>);
  setBook([
    ramp(),
    ramp({ id: 1, status: "Closed", received: "40", loss: "60" }),
  ]);
  vi.mocked(useMinterRamps).mockReturnValue([
    { data: chainRamp(), isPending: false, isError: false },
  ] as unknown as ReturnType<typeof useMinterRamps>);
  vi.mocked(useMinterPoolState).mockReturnValue({
    data: {
      bankCash: "7341220000000",
      inFlight: "1000000000",
      totalAssets: "7441220000000",
      readFailed: true,
    },
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useMinterPoolState>);
  vi.mocked(useMinterPaused).mockReturnValue({
    data: false,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useMinterPaused>);
  vi.mocked(useConversionAccess).mockReturnValue({
    data: { immediate: true, delay: 0 },
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useConversionAccess>);
  vi.mocked(useStellarWallet).mockReturnValue({
    isConnected: true,
    address: "GTRUSTEE",
  } as unknown as ReturnType<typeof useStellarWallet>);
  vi.mocked(readWireInRefHashSeen).mockResolvedValue(false);
  vi.mocked(wireInReturnRefHash).mockResolvedValue(REF_HASH);
  vi.mocked(fetchMinterPaused).mockResolvedValue(false);
  vi.mocked(fetchMinterRamp).mockResolvedValue(chainRamp() as never);
  openAsync.mockResolvedValue({ hash: "HOPEN" });
  closeAsync.mockResolvedValue({ hash: "HCLOSE" });
  expenseAsync.mockResolvedValue({ hash: "HEXP" });
  vi.mocked(useOpenRamp).mockImplementation(() =>
    mutation(openAsync, openStage),
  );
  vi.mocked(useCloseRamp).mockReturnValue(mutation(closeAsync));
  vi.mocked(useRecordExpense).mockReturnValue(mutation(expenseAsync));
});

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe("summary", () => {
  it("renders the three tiles and the source caption", () => {
    render(<ConversionsSection />);
    expect(screen.getByTestId("pool-summary-bank-cash")).toHaveTextContent(
      "$734,122",
    );
    expect(screen.getByTestId("pool-summary-in-flight")).toHaveTextContent(
      "$100",
    );
    expect(screen.getByTestId("pool-summary-total")).toHaveTextContent(
      "$744,122",
    );
    expect(screen.getByTestId("pool-summary-source")).toHaveTextContent(
      "Read on-chain from the minter CMIN…1234 (pool_state).",
    );
    expect(screen.getByTestId("pool-summary-read-failed")).toHaveTextContent(
      "A custody balance could not be read",
    );
  });

  it("shows an error and no tiles when the read fails", () => {
    vi.mocked(useMinterPoolState).mockReturnValue({
      data: undefined,
      isError: true,
      error: new Error("rpc down"),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMinterPoolState>);
    render(<ConversionsSection />);
    expect(screen.getByTestId("pool-summary-error")).toHaveTextContent(
      "Could not read the minter's pool state.",
    );
    expect(screen.queryByTestId("pool-summary-total")).not.toBeInTheDocument();
  });

  it("shows the EVM reason and no actions", () => {
    vi.mocked(useSessionState).mockReturnValue({
      chainId: 560048,
    } as unknown as ReturnType<typeof useSessionState>);
    render(<ConversionsSection />);
    expect(screen.getByTestId("pool-summary-unsupported")).toHaveTextContent(
      "Conversions and bank charges on Hoodi are not available in the Trustee app yet.",
    );
    expect(screen.getByTestId("conversion-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("conversion-open")).not.toBeInTheDocument();
  });
});

describe("table", () => {
  it("renders served rows with Close only on the Open row", () => {
    render(<ConversionsSection />);
    expect(screen.getByTestId("ramp-row-0")).toHaveTextContent("USD → USDC");
    expect(screen.getByTestId("ramp-row-0-status")).toHaveTextContent("Open");
    expect(screen.getByTestId("ramp-row-0-chain")).toHaveTextContent(
      "Open (confirmed on-chain)",
    );
    expect(screen.getByTestId("ramp-row-0-close")).toBeEnabled();
    expect(screen.getByTestId("ramp-row-1-status")).toHaveTextContent("Closed");
    expect(screen.getByTestId("ramp-row-1-received")).toHaveTextContent("$40");
    expect(screen.getByTestId("ramp-row-1-shortfall")).toHaveTextContent("$60");
    expect(screen.queryByTestId("ramp-row-1-close")).not.toBeInTheDocument();
  });

  it("shows the empty copy", () => {
    setBook([]);
    vi.mocked(useMinterRamps).mockReturnValue([] as never);
    render(<ConversionsSection />);
    expect(screen.getByTestId("conversion-empty")).toHaveTextContent(
      "No conversions on Stellar.",
    );
  });
});

describe("reasons", () => {
  it("shows the role reason on all three actions", () => {
    vi.mocked(useConversionAccess).mockReturnValue({
      data: { immediate: false, delay: 0 },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useConversionAccess>);
    render(<ConversionsSection />);
    expect(screen.getByTestId("conversion-open")).toBeDisabled();
    expect(screen.getByTestId("conversion-open-reason")).toHaveTextContent(
      "Only the Trustee role can open conversions.",
    );
    expect(screen.getByTestId("expense-open-reason")).toHaveTextContent(
      "Only the Trustee role can record bank charges.",
    );
    expect(screen.getByTestId("ramp-row-0-reason")).toHaveTextContent(
      "Only the Trustee role can close conversions.",
    );
  });

  it("shows the minter mismatch and disables everything", () => {
    setBook([ramp()], "COTHER");
    render(<ConversionsSection />);
    expect(screen.getByTestId("conversion-minter-mismatch")).toBeVisible();
    expect(screen.getByTestId("conversion-open")).toBeDisabled();
    expect(screen.getByTestId("expense-open")).toBeDisabled();
    expect(screen.getByTestId("ramp-row-0-close")).toBeDisabled();
  });

  it("paused disables only Open", () => {
    vi.mocked(useMinterPaused).mockReturnValue({
      data: true,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useMinterPaused>);
    render(<ConversionsSection />);
    expect(screen.getByTestId("conversion-open-reason")).toHaveTextContent(
      "The minter is paused; conversions cannot be opened.",
    );
    expect(screen.getByTestId("expense-open")).toBeEnabled();
    expect(screen.getByTestId("ramp-row-0-close")).toBeEnabled();
  });
});

describe("open dialog", () => {
  it("validates, then signs and shows the result", async () => {
    render(<ConversionsSection />);
    fireEvent.click(screen.getByTestId("conversion-open"));
    const dialog = screen.getByTestId("conversion-open-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("conversion-open-validation")).toHaveTextContent(
      "Choose a direction.",
    );
    expect(screen.getByTestId("conversion-open-confirm")).toBeDisabled();
    fireEvent.click(screen.getByTestId("conversion-direction-UsdcToBank"));
    expect(dialog).toHaveTextContent("The custody balance must cover it.");
    expect(screen.getByTestId("conversion-open-validation")).toHaveTextContent(
      "Enter the amount to convert.",
    );
    type("conversion-open-amount", "10");
    expect(screen.getByTestId("conversion-open-validation")).toHaveTextContent(
      "Enter the transfer reference.",
    );
    type("conversion-open-reference", "WIRE-1");
    await waitFor(() =>
      expect(screen.getByTestId("conversion-open-hash")).toHaveTextContent(
        REF_HASH,
      ),
    );
    fireEvent.click(screen.getByTestId("conversion-open-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("conversion-result")).toBeInTheDocument(),
    );
    expect(openAsync).toHaveBeenCalledWith({
      direction: "UsdcToBank",
      amountRaw: "100000000",
      refHash: REF_HASH,
    });
    expect(screen.getByTestId("conversion-result")).toHaveTextContent(
      "Conversion opened on-chain (USDC → USD, 10). Transaction HOPEN.",
    );
    expect(
      screen.queryByTestId("conversion-open-dialog"),
    ).not.toBeInTheDocument();
  });

  it("shows the stage label and blocks Escape and backdrop while pending", async () => {
    openStage = "awaiting-signature";
    openAsync.mockReturnValue(new Promise(() => {}));
    render(<ConversionsSection />);
    fireEvent.click(screen.getByTestId("conversion-open"));
    fireEvent.click(screen.getByTestId("conversion-direction-BankToUsdc"));
    type("conversion-open-amount", "10");
    type("conversion-open-reference", "WIRE-1");
    fireEvent.click(screen.getByTestId("conversion-open-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("conversion-open-confirm")).toHaveTextContent(
        "Awaiting signature…",
      ),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("conversion-open-backdrop"));
    expect(screen.getByTestId("conversion-open-dialog")).toBeInTheDocument();
  });

  it("cancels on Escape when idle", () => {
    render(<ConversionsSection />);
    fireEvent.click(screen.getByTestId("conversion-open"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByTestId("conversion-open-dialog"),
    ).not.toBeInTheDocument();
  });

  it("shows the reused-reference error and does not sign", async () => {
    vi.mocked(readWireInRefHashSeen).mockResolvedValue(true);
    render(<ConversionsSection />);
    fireEvent.click(screen.getByTestId("conversion-open"));
    fireEvent.click(screen.getByTestId("conversion-direction-BankToUsdc"));
    type("conversion-open-amount", "10");
    type("conversion-open-reference", "WIRE-1");
    fireEvent.click(screen.getByTestId("conversion-open-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("conversion-open-error")).toHaveTextContent(
        "already recorded on-chain",
      ),
    );
    expect(openAsync).not.toHaveBeenCalled();
  });
});

describe("close dialog", () => {
  it("shows both amounts, validates received and signs", async () => {
    render(<ConversionsSection />);
    fireEvent.click(screen.getByTestId("ramp-row-0-close"));
    const dialog = await screen.findByTestId("conversion-close-dialog");
    await waitFor(() =>
      expect(
        screen.getByTestId("conversion-close-onchain-amount"),
      ).toHaveTextContent("100"),
    );
    expect(dialog).toHaveTextContent("booked by the contract as an expense");
    expect(screen.getByTestId("conversion-close-validation")).toHaveTextContent(
      "Enter the amount received.",
    );
    type("conversion-close-received", "100.0000001");
    expect(screen.getByTestId("conversion-close-validation")).toHaveTextContent(
      "cannot exceed the opened amount (100)",
    );
    type("conversion-close-received", "0");
    type("conversion-close-reference", "CLOSE-1");
    await waitFor(() =>
      expect(screen.getByTestId("conversion-close-confirm")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("conversion-close-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("conversion-result")).toHaveTextContent(
        "Conversion #0 closed on-chain.",
      ),
    );
    expect(closeAsync).toHaveBeenCalledWith({
      id: 0,
      receivedRaw: "0",
      refHash: REF_HASH,
    });
  });

  it("disables confirm when the ramp is already closed on-chain", async () => {
    vi.mocked(fetchMinterRamp).mockResolvedValue(
      chainRamp({ closed: true }) as never,
    );
    render(<ConversionsSection />);
    fireEvent.click(screen.getByTestId("ramp-row-0-close"));
    expect(
      await screen.findByTestId("conversion-close-phase"),
    ).toHaveTextContent("already closed on-chain");
    expect(screen.getByTestId("conversion-close-confirm")).toBeDisabled();
  });
});

describe("expense dialog", () => {
  it("validates the date, signs and links to the Audit Log", async () => {
    render(<ConversionsSection />);
    fireEvent.click(screen.getByTestId("expense-open"));
    const date = screen.getByTestId("expense-date");
    expect(date).toHaveAttribute("type", "date");
    expect(date).toHaveAttribute("max");
    expect(screen.getByTestId("expense-validation")).toHaveTextContent(
      "Enter the charge amount.",
    );
    type("expense-amount", "5.25");
    type("expense-date", "2999-01-01");
    expect(screen.getByTestId("expense-validation")).toHaveTextContent(
      "The value date cannot be in the future.",
    );
    type("expense-date", "2026-11-09");
    type("expense-reference", "FEE-1");
    await waitFor(() =>
      expect(screen.getByTestId("expense-confirm")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("expense-confirm"));
    const result = await screen.findByTestId("conversion-result");
    expect(result).toHaveTextContent("Bank charge of 5.25 booked on-chain");
    expect(
      within(result).getByTestId("conversion-result-audit-link"),
    ).toHaveAttribute("href", "/audit-log");
  });
});
