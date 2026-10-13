// spec: docs/frontend/dashboard-components.md#startherecard
import { describe, it, expect, vi } from "vitest";
import type React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartHereCard } from "./StartHereCard";

function renderCard(
  props: Partial<React.ComponentProps<typeof StartHereCard>> = {},
) {
  return render(<StartHereCard layout="compact" {...props} />);
}

describe("StartHereCard — compact default (regression)", () => {
  it("renders 'Start here' / 'Get PLUSD' / 'Convert with USDC 1:1' with no compactVariant prop", () => {
    renderCard();

    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Get PLUSD" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Convert with USDC 1:1")).toBeInTheDocument();
  });

  it("sets data-node-id for the default compact card", () => {
    renderCard();
    expect(screen.getByRole("region")).toHaveAttribute(
      "data-node-id",
      "6701:97660",
    );
  });
});

describe("StartHereCard — compact balance mode (#1424)", () => {
  it("renders the 'PLUSD Balance' eyebrow, the $-stripped heading and the USDC caption", () => {
    renderCard({ compactVariant: "balance", compactBalanceLabel: "$1,000.00" });

    expect(screen.getByText("PLUSD Balance")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "1,000.00" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("plusd-balance-usdc-caption")).toHaveTextContent(
      "$1,000.00 USDC",
    );
  });

  it("renders — for both the heading and the caption when the balance is not served", () => {
    renderCard({ compactVariant: "balance" });

    expect(screen.getByRole("heading", { name: "—" })).toBeInTheDocument();
    expect(screen.getByTestId("plusd-balance-usdc-caption")).toHaveTextContent(
      "— USDC",
    );
  });

  it("sets data-node-id for the balance card and its Buy/Sell buttons", () => {
    renderCard({ compactVariant: "balance" });

    expect(screen.getByRole("region")).toHaveAttribute(
      "data-node-id",
      "6701:97462",
    );
    expect(screen.getByTestId("home-buy-button")).toHaveAttribute(
      "data-node-id",
      "6701:97475",
    );
    expect(screen.getByTestId("home-sell-button")).toHaveAttribute(
      "data-node-id",
      "6701:97476",
    );
  });

  it("renders Buy and Sell both enabled and wires their click handlers", async () => {
    const onBuy = vi.fn();
    const onSell = vi.fn();
    const user = userEvent.setup();
    renderCard({ compactVariant: "balance", onBuy, onSell });

    const buy = screen.getByRole("button", { name: "Buy" });
    const sell = screen.getByRole("button", { name: "Sell" });
    expect(buy).not.toBeDisabled();
    expect(sell).not.toBeDisabled();

    await user.click(buy);
    await user.click(sell);
    expect(onBuy).toHaveBeenCalledOnce();
    expect(onSell).toHaveBeenCalledOnce();
  });

  it("renders no 'Start here' / 'Get PLUSD' copy in balance mode", () => {
    renderCard({ compactVariant: "balance", compactBalanceLabel: "$1,000.00" });

    expect(screen.queryByText("Start here")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Get PLUSD" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Convert with USDC 1:1")).not.toBeInTheDocument();
  });
});
