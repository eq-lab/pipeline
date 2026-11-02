// spec: docs/product-specs/staking.md#default-pockets
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  chain: { kind: "stellar" as "stellar" | "evm", chainId: 99000001 },
  stellar: { isConnected: true, address: "GHOLDER" as string | undefined },
  evm: { isConnected: false, address: undefined as string | undefined },
  configured: true,
  loans: [] as Array<Record<string, string>>,
  loanBook: vi.fn(),
  reads: {} as Record<string, Record<string, unknown>>,
  readsSpy: vi.fn(),
  claim: {
    claim: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
    loanId: undefined as string | undefined,
    amountRaw: undefined as string | undefined,
    hash: undefined as string | undefined,
    reset: vi.fn(),
  },
  evmDecimals: 18 as number | undefined,
  toast: { show: vi.fn(), update: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("@/api", () => ({
  useLoanBook: (...a: unknown[]) => {
    h.loanBook(...a);
    return { data: { summary: {}, loans: h.loans } };
  },
}));
vi.mock("@/lib/toast", () => ({ useToast: () => h.toast }));
vi.mock("@/wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/wallet")>()),
  useActiveChain: () => h.chain,
  useStellarWallet: () => h.stellar,
  useEvmWallet: () => h.evm,
  isPocketConfigured: () => h.configured,
  usePocketReads: (...a: unknown[]) => {
    h.readsSpy(...a);
    return h.reads;
  },
  usePocketClaim: () => h.claim,
  useEvmStakeDecimals: () => ({ plusd: h.evmDecimals, splusd: 18 }),
}));

import { DefaultPocketsCard } from "./DefaultPocketsCard";

function loan(id: string, status: string, borrower = "Acme") {
  return {
    loan_id: id,
    status,
    borrower,
    commodity: "Copper Concentrate",
  };
}

function read(over: Record<string, unknown> = {}) {
  return {
    exists: true,
    balanceRaw: "50000000000",
    claimableRaw: "12500000",
    claimedRaw: "0",
    error: undefined,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.chain = { kind: "stellar", chainId: 99000001 };
  h.stellar = { isConnected: true, address: "GHOLDER" };
  h.evm = { isConnected: false, address: undefined };
  h.configured = true;
  h.loans = [loan("1", "Default"), loan("2", "Performing")];
  h.reads = { "1": read() };
  h.claim.isPending = false;
  h.claim.isSuccess = false;
  h.claim.error = null;
  h.claim.loanId = undefined;
  h.claim.amountRaw = undefined;
  h.evmDecimals = 18;
});

describe("DefaultPocketsCard visibility", () => {
  it("renders nothing when the wallet is disconnected", () => {
    h.stellar = { isConnected: false, address: undefined };
    render(<DefaultPocketsCard />);
    expect(screen.queryByTestId("default-pockets-card")).toBeNull();
  });

  it("renders nothing when the pocket is not configured", () => {
    h.configured = false;
    render(<DefaultPocketsCard />);
    expect(screen.queryByTestId("default-pockets-card")).toBeNull();
  });

  it("renders nothing without Default or Closed loans", () => {
    h.loans = [loan("2", "Performing"), loan("3", "WatchList")];
    h.reads = {};
    render(<DefaultPocketsCard />);
    expect(screen.queryByTestId("default-pockets-card")).toBeNull();
  });

  it("renders nothing when every pocket is confirmed absent", () => {
    h.reads = { "1": read({ exists: false }) };
    render(<DefaultPocketsCard />);
    expect(screen.queryByTestId("default-pockets-card")).toBeNull();
  });
});

describe("DefaultPocketsCard rows", () => {
  it("queries the loan book of the active chain and only Default/Closed loans", () => {
    h.loans = [
      loan("1", "Default"),
      loan("2", "Performing"),
      loan("3", "Closed"),
    ];
    h.reads = { "1": read(), "3": read() };
    render(<DefaultPocketsCard />);
    expect(h.loanBook).toHaveBeenCalledWith({ chainId: 99000001 });
    expect(h.readsSpy).toHaveBeenCalledWith("stellar", ["1", "3"], "GHOLDER");
    expect(screen.getByTestId("default-pocket-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("default-pocket-row-3")).toBeInTheDocument();
    expect(screen.queryByTestId("default-pocket-row-2")).toBeNull();
  });

  it("formats raw values from the chain decimals and lists zero rows", () => {
    h.reads = { "1": read({ claimableRaw: "0", claimedRaw: "0" }) };
    render(<DefaultPocketsCard />);
    const row = screen.getByTestId("default-pocket-row-1");
    expect(row).toHaveTextContent("Loan #1 · Acme");
    expect(
      within(row).getByTestId("default-pocket-balance-1"),
    ).toHaveTextContent("5,000.00");
    expect(
      within(row).getByTestId("default-pocket-claimable-1"),
    ).toHaveTextContent("0.00");
    expect(
      within(row).getByTestId("default-pocket-claimed-1"),
    ).toHaveTextContent("0.00");
  });

  it("uses the EVM wallet, chain id and PLUSD decimals on EVM", () => {
    h.chain = { kind: "evm", chainId: 560048 };
    h.stellar = { isConnected: false, address: undefined };
    h.evm = { isConnected: true, address: "0xabc" };
    h.reads = {
      "1": read({
        balanceRaw: "5000000000000000000000",
        claimableRaw: "1250000000000000000",
      }),
    };
    render(<DefaultPocketsCard />);
    expect(h.loanBook).toHaveBeenCalledWith({ chainId: 560048 });
    expect(h.readsSpy).toHaveBeenCalledWith("evm", ["1"], "0xabc");
    expect(screen.getByTestId("default-pocket-balance-1")).toHaveTextContent(
      "5,000.00",
    );
    expect(screen.getByTestId("default-pocket-claimable-1")).toHaveTextContent(
      "1.25",
    );
  });

  it("shows — for unavailable reads and keeps a pending pocket row", () => {
    h.reads = {
      "1": read({
        exists: undefined,
        balanceRaw: undefined,
        claimableRaw: undefined,
        claimedRaw: undefined,
      }),
    };
    render(<DefaultPocketsCard />);
    expect(screen.getByTestId("default-pocket-balance-1")).toHaveTextContent(
      "—",
    );
    expect(screen.getByTestId("default-pocket-claimable-1")).toHaveTextContent(
      "—",
    );
    expect(screen.getByTestId("default-pocket-claimed-1")).toHaveTextContent(
      "—",
    );
  });
});

describe("DefaultPocketsCard claim", () => {
  it("enables Claim and calls claim(loanId) when claimable is positive", async () => {
    render(<DefaultPocketsCard />);
    const button = screen.getByTestId("default-pocket-claim-1");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(h.claim.claim).toHaveBeenCalledWith("1");
  });

  it.each([
    ["zero", "0"],
    ["unknown", undefined],
  ])("disables Claim when claimable is %s", (_, claimableRaw) => {
    h.reads = { "1": read({ claimableRaw }) };
    render(<DefaultPocketsCard />);
    expect(screen.getByTestId("default-pocket-claim-1")).toBeDisabled();
  });

  it("disables every Claim while one is in flight and labels the active row", () => {
    h.loans = [loan("1", "Default"), loan("3", "Closed")];
    h.reads = { "1": read(), "3": read() };
    h.claim.isPending = true;
    h.claim.loanId = "1";
    render(<DefaultPocketsCard />);
    expect(screen.getByTestId("default-pocket-claim-1")).toBeDisabled();
    expect(screen.getByTestId("default-pocket-claim-1")).toHaveTextContent(
      "Claiming…",
    );
    expect(screen.getByTestId("default-pocket-claim-3")).toBeDisabled();
    expect(screen.getByTestId("default-pocket-claim-3")).toHaveTextContent(
      "Claim",
    );
    expect(h.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "pending" }),
    );
  });

  it("disables Claim while the account needs XLM funding", () => {
    render(<DefaultPocketsCard claimBlocked />);
    expect(screen.getByTestId("default-pocket-claim-1")).toBeDisabled();
  });

  it("toasts the contract-returned amount on success", () => {
    h.claim.isSuccess = true;
    h.claim.amountRaw = "40000000";
    render(<DefaultPocketsCard />);
    expect(h.toast.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tone: "success", title: "Claimed 4.00 PLUSD" }),
    );
  });

  it("falls back to the pre-claim claimable read when no amount is returned", async () => {
    const { rerender } = render(<DefaultPocketsCard />);
    await userEvent.click(screen.getByTestId("default-pocket-claim-1"));
    h.claim.isSuccess = true;
    rerender(<DefaultPocketsCard />);
    expect(h.toast.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tone: "success", title: "Claimed 1.25 PLUSD" }),
    );
  });

  it("surfaces a claim failure inline and in a danger toast", () => {
    h.claim.error = new Error("User rejected");
    render(<DefaultPocketsCard />);
    expect(screen.getByTestId("inline-error")).toHaveTextContent(
      "You cancelled the transaction in your wallet.",
    );
    expect(h.toast.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tone: "danger" }),
    );
  });
});
