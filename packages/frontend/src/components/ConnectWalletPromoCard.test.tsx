// spec: docs/frontend/dashboard-components.md#connectwalletpromocard
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectWalletPromoCard } from "./ConnectWalletPromoCard";

describe("ConnectWalletPromoCard", () => {
  it("default variant renders Connect Wallet heading and Connect CTA", () => {
    render(<ConnectWalletPromoCard />);
    expect(
      screen.getByRole("heading", { name: "Connect Wallet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("get-started variant renders Get Started heading and Sign Up CTA", () => {
    render(<ConnectWalletPromoCard variant="get-started" />);
    expect(
      screen.getByRole("heading", { name: "Get Started" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign Up" })).toBeInTheDocument();
  });

  it("both variants share the same sub-line copy", () => {
    const { rerender } = render(<ConnectWalletPromoCard />);
    expect(
      screen.getByText("Access real-world yield on-chain"),
    ).toBeInTheDocument();

    rerender(<ConnectWalletPromoCard variant="get-started" />);
    expect(
      screen.getByText("Access real-world yield on-chain"),
    ).toBeInTheDocument();
  });

  it("get-started CTA calls onConnect", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(
      <ConnectWalletPromoCard variant="get-started" onConnect={onConnect} />,
    );

    await user.click(screen.getByRole("button", { name: "Sign Up" }));

    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});
