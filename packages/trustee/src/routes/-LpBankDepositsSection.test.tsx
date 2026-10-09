import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { ApiError } from "@/api/client";
import type { LpBankDeposit } from "@/api/useLpBankDeposits";
import type { LpDetail } from "@/api/useLp";

vi.mock("@/api/useLpBankDeposits", () => ({
  useLpBankDeposits: vi.fn(),
  useRecordBankDeposit: vi.fn(),
  LP_BANK_DEPOSITS_REFETCH_MS: 30_000,
}));
vi.mock("@/api/useLp", () => ({ useLp: vi.fn() }));
vi.mock("@/api/useRecordWireIn", () => ({ useRecordWireIn: vi.fn() }));
vi.mock("@pipeline/wallet-connect", () => ({ useStellarWallet: vi.fn() }));

const envMock = {
  STELLAR_USDC_CUSTODY_ID:
    "GCUSTODY00000000000000000000000000000000000000000000000",
  STELLAR_CAPITAL_WALLET_ID:
    "GCAPITAL00000000000000000000000000000000000000000000000",
  STELLAR_YIELD_MINTER_ID:
    "CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK",
};

vi.mock("@/lib/env", () => ({
  get ENV() {
    return envMock;
  },
}));

import {
  useLpBankDeposits,
  useRecordBankDeposit,
} from "@/api/useLpBankDeposits";
import { useLp } from "@/api/useLp";
import { useRecordWireIn } from "@/api/useRecordWireIn";
import { useStellarWallet } from "@pipeline/wallet-connect";
import { LpBankDepositsSection } from "./-LpBankDepositsSection";
import { MINT_PENDING_WINDOW_MS } from "./-useLpBankDeposits";

const mockList = vi.mocked(useLpBankDeposits);
const mockRecord = vi.mocked(useRecordBankDeposit);
const mockLp = vi.mocked(useLp);
const mockMint = vi.mocked(useRecordWireIn);
const mockWallet = vi.mocked(useStellarWallet);
const mutateAsync = vi.fn();
const reset = vi.fn();
const mintAsync = vi.fn();
const mintReset = vi.fn();

const LP_WALLET = "GLPWALLET0000000000000000000000000000000000000000000000";
const CUSTODY = envMock.STELLAR_USDC_CUSTODY_ID;
const CAPITAL_WALLET = envMock.STELLAR_CAPITAL_WALLET_ID;

const DEPOSIT: LpBankDeposit = {
  id: 3,
  lp_id: 7,
  amount: "1250000.5",
  payment_reference: "WIRE-REF-1",
  ref_hash: "ab".repeat(32),
  occurred_at: "2026-10-05T15:41:00Z",
  is_minted: false,
  recorded_by: "GTRUSTEE",
  created_at: "2026-10-05T16:00:00Z",
};

function list(state: {
  data?: { deposits: LpBankDeposit[] };
  isPending?: boolean;
  error?: Error | null;
}) {
  mockList.mockReturnValue({
    data: state.data,
    isPending: state.isPending ?? false,
    isError: Boolean(state.error),
    isFetching: false,
    error: state.error ?? null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useLpBankDeposits>);
}

function recorder(error: Error | null = null, isPending = false) {
  mockRecord.mockReturnValue({
    mutateAsync,
    reset,
    error,
    isPending,
  } as unknown as ReturnType<typeof useRecordBankDeposit>);
}

function lp(overrides: Partial<LpDetail> = {}) {
  mockLp.mockReturnValue({
    data: {
      id: 7,
      stellar_address: LP_WALLET,
      address_linked_at: "2026-09-01T00:00:00Z",
      ...overrides,
    },
  } as unknown as ReturnType<typeof useLp>);
}

function minter(
  overrides: { error?: Error | null; stage?: string | null } = {},
) {
  mockMint.mockReturnValue({
    mutateAsync: mintAsync,
    reset: mintReset,
    isPending: false,
    isSuccess: false,
    error: overrides.error ?? null,
    stage: overrides.stage ?? null,
  } as unknown as ReturnType<typeof useRecordWireIn>);
}

function wallet(isConnected = true) {
  mockWallet.mockReturnValue({
    address: isConnected ? "GTRUSTEEWALLET" : "",
    isConnected,
    signTransaction: vi.fn(),
  } as unknown as ReturnType<typeof useStellarWallet>);
}

function renderSection() {
  return render(<LpBankDepositsSection lpId={7} legalName="Acme Ltd" />);
}

beforeEach(() => {
  mockList.mockReset();
  mockRecord.mockReset();
  mockLp.mockReset();
  mockMint.mockReset();
  mockWallet.mockReset();
  mutateAsync.mockReset();
  reset.mockReset();
  mintAsync.mockReset();
  mintReset.mockReset();
  envMock.STELLAR_USDC_CUSTODY_ID = CUSTODY;
  envMock.STELLAR_CAPITAL_WALLET_ID = CAPITAL_WALLET;
  envMock.STELLAR_YIELD_MINTER_ID =
    "CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK";
  recorder();
  lp();
  minter();
  wallet();
});

describe("LpBankDepositsSection — list", () => {
  it("shows loading, empty, and error states", () => {
    list({ isPending: true });
    const { rerender } = renderSection();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading bank deposits",
    );

    list({ data: { deposits: [] } });
    rerender(<LpBankDepositsSection lpId={7} legalName="Acme Ltd" />);
    expect(screen.getByText("No bank deposits recorded.")).toBeInTheDocument();

    list({ error: new ApiError("forbidden", 403) });
    rerender(<LpBankDepositsSection lpId={7} legalName="Acme Ltd" />);
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
      "not authorized to record bank deposits",
    );
  });

  it("renders deposit rows", () => {
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();
    const row = screen.getAllByRole("row")[1]!;
    expect(row).toHaveTextContent("5 Oct 2026, 15:41 UTC");
    expect(row).toHaveTextContent("$1,250,000.50");
    expect(row).toHaveTextContent("WIRE-REF-1");
    expect(row).toHaveTextContent("Not minted");
    expect(row).toHaveTextContent("GTRUSTEE");
  });
});

describe("LpBankDepositsSection — record", () => {
  function openDialog() {
    list({ data: { deposits: [] } });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Record deposit" }));
    return screen.getByRole("dialog", { name: "Record deposit — Acme Ltd" });
  }

  it("validates before submitting", () => {
    const dialog = openDialog();
    fireEvent.click(
      dialog.querySelector('button[type="submit"]') as HTMLButtonElement,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount");
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("submits normalized values and closes on success", async () => {
    mutateAsync.mockResolvedValueOnce(DEPOSIT);
    const dialog = openDialog();
    fireEvent.change(screen.getByLabelText("Amount (USD)"), {
      target: { value: "50,000.00" },
    });
    fireEvent.change(screen.getByLabelText("Payment reference"), {
      target: { value: "  WIRE-REF-2 " },
    });
    fireEvent.change(screen.getByLabelText("Received at (UTC)"), {
      target: { value: "2026-10-01T09:30" },
    });
    fireEvent.click(
      dialog.querySelector('button[type="submit"]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        lpId: 7,
        amount: "50000.00",
        payment_reference: "WIRE-REF-2",
        occurred_at: "2026-10-01T09:30:00Z",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("shows a duplicate-reference error and stays open", async () => {
    recorder(new ApiError("dup", 409));
    const dialog = openDialog();
    expect(dialog).toHaveTextContent(
      "A deposit with this payment reference is already recorded.",
    );
  });
});

describe("LpBankDepositsSection — mint PLUSD", () => {
  it("mints to the LP wallet when the address is linked", async () => {
    mintAsync.mockResolvedValueOnce({ hash: "tx", wireId: 1 });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Mint PLUSD" }));

    await waitFor(() =>
      expect(mintAsync).toHaveBeenCalledWith({
        lpId: 7,
        depositId: 3,
        receiver: LP_WALLET,
        amount: "1250000.5",
        occurredAt: "2026-10-05T15:41:00Z",
        refHash: "ab".repeat(32),
      }),
    );
  });

  it("falls back to the capital wallet when no wallet is linked", async () => {
    lp({ address_linked_at: null });
    mintAsync.mockResolvedValueOnce({ hash: "tx", wireId: 1 });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Mint PLUSD" }));

    await waitFor(() =>
      expect(mintAsync.mock.calls[0]![0].receiver).toBe(CAPITAL_WALLET),
    );
  });

  it("never falls back to the USDC custody account", () => {
    lp({ stellar_address: null, address_linked_at: null });
    envMock.STELLAR_CAPITAL_WALLET_ID = "";
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Mint PLUSD" }));

    expect(envMock.STELLAR_USDC_CUSTODY_ID).toBe(CUSTODY);
    expect(mintAsync).not.toHaveBeenCalled();
  });

  it("shows Minted and no action for a minted row", () => {
    list({ data: { deposits: [{ ...DEPOSIT, is_minted: true }] } });
    renderSection();

    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Minted");
    expect(
      screen.queryByRole("button", { name: "Mint PLUSD" }),
    ).not.toBeInTheDocument();
  });

  it("disables the action with a reason when the wallet is disconnected", () => {
    wallet(false);
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    const button = screen.getByRole("button", { name: "Mint PLUSD" });
    expect(button).toBeDisabled();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent(
      "Connect your trustee wallet to mint PLUSD.",
    );
  });

  it("disables the action when the minter id is unset", () => {
    envMock.STELLAR_YIELD_MINTER_ID = "";
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    expect(screen.getByRole("button", { name: "Mint PLUSD" })).toBeDisabled();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent(
      "On-chain PLUSD minting is not configured for this environment.",
    );
  });

  it("disables the action when the capital wallet is unset and no wallet is linked", () => {
    lp({ stellar_address: null, address_linked_at: null });
    envMock.STELLAR_CAPITAL_WALLET_ID = "";
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    expect(screen.getByRole("button", { name: "Mint PLUSD" })).toBeDisabled();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent(
      "no linked Stellar wallet and no capital wallet is configured",
    );
  });

  it("holds Waiting for the indexer until the served is_minted flips", async () => {
    mintAsync.mockResolvedValueOnce({ hash: "tx", wireId: 1 });
    list({ data: { deposits: [DEPOSIT] } });
    const { rerender } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Mint PLUSD" }));

    await waitFor(() =>
      expect(screen.getByText("Waiting for the indexer")).toBeInTheDocument(),
    );
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Pending");

    list({ data: { deposits: [{ ...DEPOSIT, is_minted: true }] } });
    rerender(<LpBankDepositsSection lpId={7} legalName="Acme Ltd" />);

    await waitFor(() =>
      expect(screen.getAllByRole("row")[1]).toHaveTextContent("Minted"),
    );
    expect(
      screen.queryByText("Waiting for the indexer"),
    ).not.toBeInTheDocument();
  });

  it("surfaces a RefHashSeen trap with its own message and raw details", () => {
    minter({
      error: new Error(
        "recordWireIn simulation error: HostError: Error(Contract, #9) RefHashSeen",
      ),
    });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    const alert = screen.getAllByRole("alert").at(-1)!;
    expect(alert).toHaveTextContent(
      "This deposit's reference has already been minted on-chain. Refresh the list.",
    );
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("RefHashSeen");
  });

  it("maps a PLUSD trustline trap to its own message and keeps the raw details", () => {
    minter({
      error: new Error(
        "recordWireIn simulation error: HostError: Error(Contract, #13)",
      ),
    });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    const alert = screen.getAllByRole("alert").at(-1)!;
    expect(alert).toHaveTextContent(
      "The receiver has no authorized PLUSD trustline.",
    );
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Error(Contract, #13)",
    );
  });

  it("shows the stage label while a mint is in flight", async () => {
    minter({ stage: "awaiting-signature" });
    let resolveMint: (value: unknown) => void = () => {};
    mintAsync.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMint = resolve;
      }),
    );
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Mint PLUSD" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Awaiting signature…" }),
      ).toBeDisabled(),
    );
    resolveMint({ hash: "tx", wireId: 1 });
  });
});

describe("LpBankDepositsSection — mint pending window", () => {
  const SECOND_DEPOSIT: LpBankDeposit = {
    ...DEPOSIT,
    id: 4,
    payment_reference: "WIRE-REF-9",
    ref_hash: "cd".repeat(32),
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function clickMint(index = 0) {
    const buttons = screen.getAllByRole("button", { name: "Mint PLUSD" });
    await act(async () => {
      fireEvent.click(buttons[index]!);
    });
  }

  it("drops the pending flag when the window expires", async () => {
    mintAsync.mockResolvedValueOnce({ hash: "tx", wireId: 1 });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    await clickMint();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Pending");

    act(() => {
      vi.advanceTimersByTime(MINT_PENDING_WINDOW_MS);
    });

    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Not minted");
    expect(
      screen.getByRole("button", { name: "Mint PLUSD" }),
    ).toBeInTheDocument();
  });

  it("drops the pending flag early when the served is_minted flips", async () => {
    mintAsync.mockResolvedValueOnce({ hash: "tx", wireId: 1 });
    list({ data: { deposits: [DEPOSIT] } });
    const { rerender } = renderSection();

    await clickMint();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Pending");

    list({ data: { deposits: [{ ...DEPOSIT, is_minted: true }] } });
    await act(async () => {
      rerender(<LpBankDepositsSection lpId={7} legalName="Acme Ltd" />);
    });

    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Minted");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer armed when unmounted mid-window", async () => {
    mintAsync.mockResolvedValueOnce({ hash: "tx", wireId: 1 });
    list({ data: { deposits: [DEPOSIT] } });
    const { unmount } = renderSection();

    await clickMint();
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not restart an earlier deposit's window when a second mint starts", async () => {
    mintAsync.mockResolvedValue({ hash: "tx", wireId: 1 });
    list({ data: { deposits: [DEPOSIT, SECOND_DEPOSIT] } });
    renderSection();

    await clickMint();

    act(() => {
      vi.advanceTimersByTime(MINT_PENDING_WINDOW_MS / 2);
    });
    await clickMint();

    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Pending");
    expect(screen.getAllByRole("row")[2]).toHaveTextContent("Pending");

    act(() => {
      vi.advanceTimersByTime(MINT_PENDING_WINDOW_MS / 2);
    });

    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Not minted");
    expect(screen.getAllByRole("row")[2]).toHaveTextContent("Pending");
  });
});
