import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountWalletCard } from "./AccountWalletCard";

const mockUseActiveWalletAccount = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();

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
      isConnected: true,
      address: "0x8493333333333333333333333333333333b92a",
      truncatedAddress: "0x8493…b92a",
      formattedBalance: "$10,000.00",
      connect: mockConnect,
      disconnect: mockDisconnect,
    });
    render(<AccountWalletCard />);
    expect(screen.getByText("0x8493…b92a")).toBeInTheDocument();
    expect(screen.getByText("$10,000.00")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect Wallet" }),
    ).not.toBeInTheDocument();
    const copyButton = screen.getByRole("button", {
      name: "Copy wallet address",
    });
    expect(copyButton).toHaveClass("size-8");
    expect(copyButton.parentElement).toHaveClass("size-10", "p-1");
  });

  it("renders — when the balance is missing", () => {
    mockUseActiveWalletAccount.mockReturnValue({
      kind: "evm",
      isConnected: true,
      address: "0x8493333333333333333333333333333333b92a",
      truncatedAddress: "0x8493…b92a",
      formattedBalance: undefined,
      connect: mockConnect,
      disconnect: mockDisconnect,
    });
    render(<AccountWalletCard />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the divider and Disconnect row after the wallet rows, which calls disconnect (issue #1458)", async () => {
    mockUseActiveWalletAccount.mockReturnValue({
      kind: "evm",
      isConnected: true,
      address: "0x8493333333333333333333333333333333b92a",
      truncatedAddress: "0x8493…b92a",
      formattedBalance: "$10,000.00",
      connect: mockConnect,
      disconnect: mockDisconnect,
    });
    render(<AccountWalletCard />);
    const row = screen.getByTestId("account-disconnect-row");
    expect(row).toHaveTextContent("Disconnect");
    const rowsContainer = screen.getByTestId(
      "account-disconnect-row",
    ).parentElement;
    expect(rowsContainer).toHaveClass("gap-0");
    await userEvent.click(row);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});

describe("AccountWalletCard — disconnected", () => {
  it("renders the 72px circle and Connect Wallet, which calls connect", async () => {
    mockUseActiveWalletAccount.mockReturnValue({
      kind: "evm",
      isConnected: false,
      address: undefined,
      truncatedAddress: undefined,
      formattedBalance: undefined,
      connect: mockConnect,
      disconnect: mockDisconnect,
    });
    render(<AccountWalletCard />);
    const button = screen.getByRole("button", { name: "Connect Wallet" });
    expect(button).toBeInTheDocument();
    await userEvent.click(button);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("renders no divider and no Disconnect row", () => {
    mockUseActiveWalletAccount.mockReturnValue({
      kind: "evm",
      isConnected: false,
      address: undefined,
      truncatedAddress: undefined,
      formattedBalance: undefined,
      connect: mockConnect,
      disconnect: mockDisconnect,
    });
    render(<AccountWalletCard />);
    expect(
      screen.queryByTestId("account-disconnect-row"),
    ).not.toBeInTheDocument();
  });
});

describe("AccountWalletCard — no namespace tabs (#1512)", () => {
  it.each(["evm", "stellar"])(
    "renders no tablist when %s is connected",
    (kind) => {
      mockUseActiveWalletAccount.mockReturnValue({
        kind,
        isConnected: true,
        address: "0x8493333333333333333333333333333333b92a",
        truncatedAddress: "0x8493…b92a",
        formattedBalance: "$10,000.00",
        connect: mockConnect,
        disconnect: mockDisconnect,
      });
      render(<AccountWalletCard />);
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(screen.queryByRole("tab")).not.toBeInTheDocument();
      expect(screen.queryByText("Ethereum")).not.toBeInTheDocument();
      expect(screen.queryByText("Stellar")).not.toBeInTheDocument();
    },
  );

  it("renders no tablist when disconnected", () => {
    mockUseActiveWalletAccount.mockReturnValue({
      kind: "evm",
      isConnected: false,
      address: undefined,
      truncatedAddress: undefined,
      formattedBalance: undefined,
      connect: mockConnect,
      disconnect: mockDisconnect,
    });
    render(<AccountWalletCard />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});
