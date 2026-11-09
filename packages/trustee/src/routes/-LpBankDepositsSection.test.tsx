import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
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
vi.mock("@/api/useLp", () => ({ useLp: vi.fn(), fetchLp: vi.fn() }));
vi.mock("@/auth/sessionStore", () => ({ useSessionState: vi.fn() }));
vi.mock("@/api/useRecordWireIn", () => ({ useRecordWireIn: vi.fn() }));
vi.mock("@pipeline/wallet-connect", () => ({ useStellarWallet: vi.fn() }));
const roleMock = vi.hoisted(() => ({
  reason: null as string | null,
  calls: [] as { fn: string; enabled: boolean }[],
}));
vi.mock("@/api/useCashReporterAccess", () => ({
  useCashReporterAccess: (fn: string, enabled: boolean) => {
    roleMock.calls.push({ fn, enabled });
    return { reason: enabled ? roleMock.reason : null };
  },
}));

const showToast = vi.fn();
vi.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

const writeText = vi.fn<(value: string) => Promise<void>>();
Object.defineProperty(navigator, "clipboard", {
  value: { writeText },
  configurable: true,
});

const envMock = vi.hoisted(() => ({
  STELLAR_CHAIN_ID: 99_000_001,
  EVM_CHAIN_ID: 560048,
  EVM_CAPITAL_WALLET_ADDRESS: "0xcap0000000000000000000000000000000000001",
  STELLAR_USDC_CUSTODY_ID:
    "GCUSTODY00000000000000000000000000000000000000000000000",
  STELLAR_CAPITAL_WALLET_ID:
    "GCAPITAL00000000000000000000000000000000000000000000000",
  STELLAR_YIELD_MINTER_ID:
    "CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK",
}));

vi.mock("@/lib/env", () => ({
  get ENV() {
    return envMock;
  },
}));

import {
  useLpBankDeposits,
  useRecordBankDeposit,
} from "@/api/useLpBankDeposits";
import { fetchLp, useLp } from "@/api/useLp";
import { useSessionState } from "@/auth/sessionStore";
import { useRecordWireIn } from "@/api/useRecordWireIn";
import { useStellarWallet } from "@pipeline/wallet-connect";
import { LpBankDepositsSection } from "./-LpBankDepositsSection";
import { MINT_PENDING_WINDOW_MS } from "./-useLpBankDeposits";

const mockList = vi.mocked(useLpBankDeposits);
const mockRecord = vi.mocked(useRecordBankDeposit);
const mockLp = vi.mocked(useLp);
const mockFetchLp = vi.mocked(fetchLp);
const mockSession = vi.mocked(useSessionState);
const lpRefetch = vi.fn();
const mockMint = vi.mocked(useRecordWireIn);
const mockWallet = vi.mocked(useStellarWallet);
const mutateAsync = vi.fn();
const reset = vi.fn();
const mintAsync = vi.fn();
const mintReset = vi.fn();

const LP_WALLET = "GLPWALLET0000000000000000000000000000000000000000000000";
const CUSTODY = envMock.STELLAR_USDC_CUSTODY_ID;
const CAPITAL_WALLET = envMock.STELLAR_CAPITAL_WALLET_ID;
const EVM_CAPITAL_WALLET = envMock.EVM_CAPITAL_WALLET_ADDRESS;
const LP_EVM = "0xlp00000000000000000000000000000000000001";
const WALLET_X = "GWALLETX0000000000000000000000000000000000000000000000";
const WALLET_Y = "GWALLETY0000000000000000000000000000000000000000000000";

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

function lpData(overrides: Partial<LpDetail> = {}) {
  return {
    id: 7,
    stellar_address: LP_WALLET,
    address_linked_at: "2026-09-01T00:00:00Z",
    evm_address: null,
    evm_address_linked_at: null,
    ...overrides,
  } as unknown as LpDetail;
}

function lp(overrides: Partial<LpDetail> = {}) {
  const data = lpData(overrides);
  mockLp.mockReturnValue({
    data,
    refetch: lpRefetch,
  } as unknown as ReturnType<typeof useLp>);
  mockFetchLp.mockResolvedValue(data);
}

function session(chainId: number | undefined) {
  mockSession.mockReturnValue({ chainId } as unknown as ReturnType<
    typeof useSessionState
  >);
}

async function openMintDialog() {
  const table = screen.getAllByRole("row")[1]!;
  fireEvent.click(within(table).getByRole("button", { name: "Mint PLUSD" }));
  await screen.findByTestId("lp-mint-receiver").catch(() => undefined);
  return screen.getByTestId("lp-mint-confirm");
}

async function confirmMint() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("lp-mint-confirm-submit"));
  });
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
  mockFetchLp.mockReset();
  mockSession.mockReset();
  roleMock.reason = null;
  roleMock.calls = [];
  lpRefetch.mockReset();
  session(undefined);
  mutateAsync.mockReset();
  reset.mockReset();
  mintAsync.mockReset();
  mintReset.mockReset();
  showToast.mockReset();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  envMock.STELLAR_USDC_CUSTODY_ID = CUSTODY;
  envMock.STELLAR_CAPITAL_WALLET_ID = CAPITAL_WALLET;
  envMock.EVM_CAPITAL_WALLET_ADDRESS = EVM_CAPITAL_WALLET;
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
    const headers = screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      "Received",
      "Amount",
      "Payment reference",
      "Recorded by",
      "PLUSD",
    ]);
    const row = screen.getAllByRole("row")[1]!;
    expect(row).toHaveTextContent("5 Oct 2026, 15:41 UTC");
    expect(row).toHaveTextContent("$1,250,000.50");
    expect(row).toHaveTextContent("WIRE-REF-1");
    expect(
      within(row).getByRole("button", { name: "Mint PLUSD" }),
    ).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "…USTEE" })).toHaveAttribute(
      "title",
      "GTRUSTEE",
    );
  });

  it("copies recorded_by to the clipboard and toasts instead of revealing inline", async () => {
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "…USTEE" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("GTRUSTEE"));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Address copied"),
    );
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")[1]).not.toHaveTextContent("GTRUSTEE");
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
  it("shows the scope line with the LP receiver", () => {
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();
    const scope = screen.getByTestId("lp-deposits-mint-scope");
    expect(scope).toHaveTextContent("Mints on Stellar to");
    expect(screen.getByTestId("lp-deposits-receiver")).toHaveAttribute(
      "title",
      LP_WALLET,
    );
    expect(scope).not.toHaveTextContent("capital wallet");
  });

  it("shows the capital-wallet text when the LP has no Stellar address", () => {
    lp({ stellar_address: null, address_linked_at: null });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();
    const scope = screen.getByTestId("lp-deposits-mint-scope");
    expect(screen.getByTestId("lp-deposits-receiver")).toHaveAttribute(
      "title",
      CAPITAL_WALLET,
    );
    expect(scope).toHaveTextContent(
      "capital wallet — this LP has no Stellar settlement address",
    );
  });

  it("re-reads before and after the dialog, then mints to the shown receiver", async () => {
    mintAsync.mockResolvedValueOnce({ hash: "tx", wireId: 1 });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    const dialog = await openMintDialog();
    expect(mockFetchLp).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveTextContent("Mint PLUSD — Acme Ltd");
    expect(screen.getByTestId("lp-mint-receiver")).toHaveTextContent(LP_WALLET);
    expect(screen.queryByTestId("lp-mint-receiver-changed")).toBeNull();

    await confirmMint();

    expect(mockFetchLp).toHaveBeenCalledTimes(2);
    expect(mockFetchLp.mock.invocationCallOrder[1]!).toBeLessThan(
      mintAsync.mock.invocationCallOrder[0]!,
    );
    expect(mintAsync).toHaveBeenCalledWith({
      lpId: 7,
      depositId: 3,
      receiver: LP_WALLET,
      amount: "1250000.5",
      occurredAt: "2026-10-05T15:41:00Z",
      refHash: "ab".repeat(32),
    });
    await waitFor(() =>
      expect(screen.queryByTestId("lp-mint-confirm")).toBeNull(),
    );
  });

  it("falls back to the capital wallet when no wallet is linked", async () => {
    lp({ address_linked_at: null });
    mintAsync.mockResolvedValueOnce({ hash: "tx", wireId: 1 });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    await openMintDialog();
    expect(screen.getByTestId("lp-mint-confirm")).toHaveTextContent(
      "Capital wallet",
    );
    await confirmMint();

    expect(mintAsync.mock.calls[0]![0].receiver).toBe(CAPITAL_WALLET);
  });

  it("shows the changed notice and mints to the new address only after the ack", async () => {
    lp({ stellar_address: WALLET_X });
    mockFetchLp.mockResolvedValue(lpData({ stellar_address: WALLET_Y }));
    mintAsync.mockResolvedValueOnce({ hash: "tx", wireId: 1 });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    await openMintDialog();

    const notice = screen.getByTestId("lp-mint-receiver-changed");
    expect(notice).toHaveTextContent(`Previously shown: ${WALLET_X}`);
    expect(notice).toHaveTextContent(`Now minting to: ${WALLET_Y}`);
    expect(screen.getByTestId("lp-mint-receiver")).toHaveTextContent(WALLET_Y);
    expect(lpRefetch).toHaveBeenCalled();
    const submit = screen.getByTestId("lp-mint-confirm-submit");
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByTestId("lp-mint-ack"));
    expect(submit).toBeEnabled();
    await confirmMint();

    expect(mintAsync).toHaveBeenCalledTimes(1);
    expect(mintAsync.mock.calls[0]![0].receiver).toBe(WALLET_Y);
  });

  it("blocks the mint when the LP relinks while the dialog is open", async () => {
    lp({ stellar_address: WALLET_X });
    mockFetchLp
      .mockResolvedValueOnce(lpData({ stellar_address: WALLET_X }))
      .mockResolvedValueOnce(lpData({ stellar_address: WALLET_Y }))
      .mockResolvedValueOnce(lpData({ stellar_address: WALLET_Y }));
    mintAsync.mockResolvedValueOnce({ hash: "tx", wireId: 1 });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    await openMintDialog();
    expect(screen.queryByTestId("lp-mint-receiver-changed")).toBeNull();

    await confirmMint();

    expect(mintAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("lp-mint-receiver-changed")).toHaveTextContent(
      `Previously shown: ${WALLET_X}`,
    );
    expect(screen.getByTestId("lp-mint-receiver")).toHaveTextContent(WALLET_Y);
    expect(screen.getByTestId("lp-mint-ack")).not.toBeChecked();
    expect(lpRefetch).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("lp-mint-ack"));
    await confirmMint();

    expect(mockFetchLp).toHaveBeenCalledTimes(3);
    expect(mintAsync).toHaveBeenCalledTimes(1);
    expect(mintAsync.mock.calls[0]![0].receiver).toBe(WALLET_Y);
  });

  it("requires the ack when the LP relinks to the capital wallet", async () => {
    mockFetchLp.mockResolvedValue(lpData({ address_linked_at: null }));
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    await openMintDialog();

    expect(screen.getByTestId("lp-mint-receiver-changed")).toBeInTheDocument();
    expect(screen.getByTestId("lp-mint-confirm")).toHaveTextContent(
      "Capital wallet",
    );
    expect(screen.getByTestId("lp-mint-confirm-submit")).toBeDisabled();
  });

  it("blocks the mint and offers Retry when the fresh read fails", async () => {
    mockFetchLp.mockRejectedValueOnce(new ApiError("boom", 500));
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    const dialog = await openMintDialog();

    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "Could not re-read this LP's settlement address. Try again.",
      ),
    );
    expect(screen.getByTestId("lp-mint-confirm-submit")).toBeDisabled();
    expect(mintAsync).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByTestId("lp-mint-receiver")).toHaveTextContent(
        LP_WALLET,
      ),
    );
    expect(mockFetchLp).toHaveBeenCalledTimes(2);
  });

  it("blocks the mint when the confirm-time read fails", async () => {
    mockFetchLp
      .mockResolvedValueOnce(lpData())
      .mockRejectedValueOnce(new ApiError("boom", 500));
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    await openMintDialog();
    await confirmMint();

    expect(mintAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("lp-mint-confirm")).toHaveTextContent(
      "Could not re-read this LP's settlement address.",
    );
  });

  it("drops a read that resolves after the dialog was closed", async () => {
    let resolveRead: (value: LpDetail) => void = () => {};
    mockFetchLp.mockReturnValueOnce(
      new Promise<LpDetail>((resolve) => {
        resolveRead = resolve;
      }),
    );
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    fireEvent.click(
      within(screen.getAllByRole("row")[1]!).getByRole("button", {
        name: "Mint PLUSD",
      }),
    );
    expect(screen.getByTestId("lp-mint-confirm")).toHaveTextContent(
      "Reading the LP's current settlement address",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("lp-mint-confirm")).toBeNull();

    await act(async () => {
      resolveRead(lpData());
    });

    expect(screen.queryByTestId("lp-mint-confirm")).toBeNull();
    expect(mintAsync).not.toHaveBeenCalled();
  });

  it("disables the action and never reads or mints on an EVM session", () => {
    session(560048);
    lp({
      evm_address: LP_EVM,
      evm_address_linked_at: "2026-09-01T00:00:00Z",
    });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    expect(screen.getByTestId("lp-deposits-mint-scope")).toHaveTextContent(
      "Mints on Hoodi to",
    );
    expect(screen.getByTestId("lp-deposits-receiver")).toHaveAttribute(
      "title",
      LP_EVM,
    );
    const button = screen.getByRole("button", { name: "Mint PLUSD" });
    expect(button).toBeDisabled();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent(
      "PLUSD minting on Hoodi is not available in the Trustee app yet.",
    );
    fireEvent.click(button);
    expect(mockFetchLp).not.toHaveBeenCalled();
    expect(mintAsync).not.toHaveBeenCalled();
  });

  it("resolves the EVM capital wallet for an EVM session with no EVM address", () => {
    session(560048);
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();
    expect(screen.getByTestId("lp-deposits-receiver")).toHaveAttribute(
      "title",
      EVM_CAPITAL_WALLET,
    );
    expect(screen.getByTestId("lp-deposits-mint-scope")).toHaveTextContent(
      "no EVM settlement address",
    );
  });

  it("never falls back to the USDC custody account", () => {
    lp({ stellar_address: null, address_linked_at: null });
    envMock.STELLAR_CAPITAL_WALLET_ID = "";
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    expect(screen.getByRole("button", { name: "Mint PLUSD" })).toBeDisabled();
    expect(envMock.STELLAR_USDC_CUSTODY_ID).toBe(CUSTODY);
    expect(screen.getByTestId("lp-deposits-mint-scope")).toHaveTextContent(
      "no receiver",
    );
  });

  it("shows a positive Minted chip and no action for a minted row", () => {
    list({ data: { deposits: [{ ...DEPOSIT, is_minted: true }] } });
    renderSection();

    const chip = screen.getByTestId("lp-deposit-minted");
    expect(chip).toHaveTextContent("Minted");
    expect(chip).toHaveAttribute("data-band", "positive");
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

  it.each([
    "Only the Cash reporter can book incoming wires.",
    "Checking this wallet's Cash reporter role…",
    "Could not verify this wallet's Cash reporter role.",
  ])("disables the action with the role reason: %s", (reason) => {
    roleMock.reason = reason;
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    expect(screen.getByRole("button", { name: "Mint PLUSD" })).toBeDisabled();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent(reason);
    expect(roleMock.calls.at(-1)).toEqual({
      fn: "record_wire_in",
      enabled: true,
    });
  });

  it("does not run the role read on an EVM session", () => {
    session(560048);
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();

    expect(roleMock.calls.every((c) => c.enabled === false)).toBe(true);
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

    await openMintDialog();
    await confirmMint();

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

  it("surfaces a RefHashSeen trap with its own message and raw details", async () => {
    minter({
      error: new Error(
        "recordWireIn simulation error: HostError: Error(Contract, #9) RefHashSeen",
      ),
    });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();
    await openMintDialog();

    const alert = screen.getAllByRole("alert").at(-1)!;
    expect(alert).toHaveTextContent(
      "This deposit's reference has already been minted on-chain. Refresh the list.",
    );
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(screen.getAllByRole("dialog").at(-1)).toHaveTextContent(
      "RefHashSeen",
    );
  });

  it("maps a PLUSD trustline trap to its own message and keeps the raw details", async () => {
    minter({
      error: new Error(
        "recordWireIn simulation error: HostError: Error(Contract, #13)",
      ),
    });
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();
    await openMintDialog();

    const alert = screen.getAllByRole("alert").at(-1)!;
    expect(alert).toHaveTextContent(
      "The receiver has no authorized PLUSD trustline.",
    );
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(screen.getAllByRole("dialog").at(-1)).toHaveTextContent(
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

    await openMintDialog();
    await confirmMint();

    await waitFor(() =>
      expect(screen.getByTestId("lp-mint-confirm-submit")).toHaveTextContent(
        "Awaiting signature…",
      ),
    );
    expect(screen.getByTestId("lp-mint-confirm-submit")).toBeDisabled();
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
    await act(async () => {
      fireEvent.click(screen.getByTestId("lp-mint-confirm-submit"));
    });
    act(() => {
      vi.advanceTimersByTime(0);
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

    expect(screen.queryByTestId("lp-deposit-pending")).not.toBeInTheDocument();
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

    expect(
      within(screen.getAllByRole("row")[1]!).getByRole("button", {
        name: "Mint PLUSD",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("row")[2]).toHaveTextContent("Pending");
  });
});
