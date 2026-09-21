import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountWalletCard } from "./AccountWalletCard";

const mockUseActiveWalletAccount = vi.fn();
const mockConnect = vi.fn();
const setKind = vi.fn();

vi.mock("@/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/wallet")>();
  return {
    ...actual,
    useActiveWalletAccount: () => mockUseActiveWalletAccount(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AccountWalletCard — connected", () => {
  it("renders the truncated address and the USDC balance", () => {
    mockUseActiveWalletAccount.mockReturnValue({
      kind: "evm",
      setKind,
      isConnected: true,
      address: "0x8493333333333333333333333333333333b92a",
      truncatedAddress: "0x8493…b92a",
      formattedBalance: "$10,000.00",
      connect: mockConnect,
    });
    render(<AccountWalletCard />);
    expect(screen.getByText("0x8493…b92a")).toBeInTheDocument();
    expect(screen.getByText("$10,000.00")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect Wallet" }),
    ).not.toBeInTheDocument();
  });

  it("renders — when the balance is missing", () => {
    mockUseActiveWalletAccount.mockReturnValue({
      kind: "evm",
      setKind,
      isConnected: true,
      address: "0x8493333333333333333333333333333333b92a",
      truncatedAddress: "0x8493…b92a",
      formattedBalance: undefined,
      connect: mockConnect,
    });
    render(<AccountWalletCard />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("AccountWalletCard — disconnected", () => {
  it("renders the 72px circle and Connect Wallet, which calls connect", async () => {
    mockUseActiveWalletAccount.mockReturnValue({
      kind: "evm",
      setKind,
      isConnected: false,
      address: undefined,
      truncatedAddress: undefined,
      formattedBalance: undefined,
      connect: mockConnect,
    });
    render(<AccountWalletCard />);
    const button = screen.getByRole("button", { name: "Connect Wallet" });
    expect(button).toBeInTheDocument();
    await userEvent.click(button);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});

describe("AccountWalletCard — namespace tabs", () => {
  it("selecting the Stellar tab calls setKind and never calls disconnect", async () => {
    mockUseActiveWalletAccount.mockReturnValue({
      kind: "evm",
      setKind,
      isConnected: false,
      address: undefined,
      truncatedAddress: undefined,
      formattedBalance: undefined,
      connect: mockConnect,
    });
    render(<AccountWalletCard />);
    await userEvent.click(screen.getByRole("tab", { name: "Stellar" }));
    expect(setKind).toHaveBeenCalledWith("stellar");
  });
});
