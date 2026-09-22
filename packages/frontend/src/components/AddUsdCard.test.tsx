// spec: docs/frontend/bank-transfers.md#addusdcard
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddUsdCard } from "./AddUsdCard";
import type { AddUsdCardVariant } from "./addUsdCardState";

interface PresenceCase {
  variant: AddUsdCardVariant;
  heading: string;
  eyebrow?: string;
  subCaption?: string;
  primaryLabel: string;
  hasWithdraw: boolean;
  hasIllustration: boolean;
}

const CASES: PresenceCase[] = [
  {
    variant: "locked",
    heading: "Use a bank transfer",
    eyebrow: "Add USD",
    subCaption: "KYB verification required",
    primaryLabel: "Add Funds",
    hasWithdraw: false,
    hasIllustration: false,
  },
  {
    variant: "verify",
    heading: "Verify your account",
    subCaption: "Complete KYB to unlock bank transfers.",
    primaryLabel: "Start Verification",
    hasWithdraw: false,
    hasIllustration: true,
  },
  {
    variant: "verifying",
    heading: "Verifying account…",
    subCaption: "We are reviewing your documents.",
    primaryLabel: "View Status",
    hasWithdraw: false,
    hasIllustration: true,
  },
  {
    variant: "unlocked",
    heading: "Use a bank transfer",
    eyebrow: "Add USD",
    subCaption: "Transfers unlocked",
    primaryLabel: "Add Funds",
    hasWithdraw: false,
    hasIllustration: false,
  },
  {
    variant: "funded",
    heading: "$1,000.00",
    eyebrow: "USD Balance",
    subCaption: "on Trust account",
    primaryLabel: "Add Funds",
    hasWithdraw: true,
    hasIllustration: false,
  },
];

describe.each(CASES)(
  "AddUsdCard — $variant",
  ({
    variant,
    heading,
    eyebrow,
    subCaption,
    primaryLabel,
    hasWithdraw,
    hasIllustration,
  }) => {
    it("renders the expected heading/eyebrow/sub-caption and control set", () => {
      const { container } = render(
        <AddUsdCard
          variant={variant}
          usdBalanceLabel={variant === "funded" ? "$1,000.00" : undefined}
        />,
      );

      expect(screen.getByText(heading)).toBeInTheDocument();
      if (eyebrow) expect(screen.getByText(eyebrow)).toBeInTheDocument();
      if (subCaption) expect(screen.getByText(subCaption)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: primaryLabel }),
      ).toBeInTheDocument();

      expect(screen.queryByRole("button", { name: "Withdraw" }) !== null).toBe(
        hasWithdraw,
      );
      expect(container.querySelector("[data-tone]") !== null).toBe(
        hasIllustration,
      );
    });

    it("has role=region with a resolvable aria-labelledby", () => {
      render(<AddUsdCard variant={variant} />);
      const region = screen.getByRole("region");
      const labelId = region.getAttribute("aria-labelledby");
      expect(labelId).toBeTruthy();
      expect(document.getElementById(labelId as string)).toBeInTheDocument();
    });

    it("renders with no handlers and clicking every control throws nothing", async () => {
      const user = userEvent.setup();
      render(
        <AddUsdCard
          variant={variant}
          usdBalanceLabel={variant === "funded" ? "$1,000.00" : undefined}
        />,
      );
      for (const btn of screen.getAllByRole("button")) {
        if (!(btn as HTMLButtonElement).disabled) {
          await expect(user.click(btn)).resolves.not.toThrow();
        }
      }
    });
  },
);

describe("AddUsdCard — locked disabled state", () => {
  it("locked's Add Funds is disabled", () => {
    render(<AddUsdCard variant="locked" />);
    expect(screen.getByRole("button", { name: "Add Funds" })).toBeDisabled();
  });

  it("unlocked's Add Funds is not disabled", () => {
    render(<AddUsdCard variant="unlocked" />);
    expect(
      screen.getByRole("button", { name: "Add Funds" }),
    ).not.toBeDisabled();
  });

  it("funded's Add Funds is not disabled", () => {
    render(<AddUsdCard variant="funded" usdBalanceLabel="$1,000.00" />);
    expect(
      screen.getByRole("button", { name: "Add Funds" }),
    ).not.toBeDisabled();
  });
});

describe("AddUsdCard — funded balance seam", () => {
  it("renders — with no usdBalanceLabel", () => {
    render(<AddUsdCard variant="funded" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the supplied label verbatim", () => {
    render(<AddUsdCard variant="funded" usdBalanceLabel="$1,000.00" />);
    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
  });
});

describe("AddUsdCard — seam handlers fire", () => {
  it("onAddFunds fires on locked's action (unlocked variant)", async () => {
    const onAddFunds = vi.fn();
    const user = userEvent.setup();
    render(<AddUsdCard variant="unlocked" onAddFunds={onAddFunds} />);
    await user.click(screen.getByRole("button", { name: "Add Funds" }));
    expect(onAddFunds).toHaveBeenCalledTimes(1);
  });

  it("onWithdraw fires on funded's Withdraw", async () => {
    const onWithdraw = vi.fn();
    const user = userEvent.setup();
    render(
      <AddUsdCard
        variant="funded"
        usdBalanceLabel="$1,000.00"
        onWithdraw={onWithdraw}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(onWithdraw).toHaveBeenCalledTimes(1);
  });

  it("onStartVerification fires on verify", async () => {
    const onStartVerification = vi.fn();
    const user = userEvent.setup();
    render(
      <AddUsdCard variant="verify" onStartVerification={onStartVerification} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Start Verification" }),
    );
    expect(onStartVerification).toHaveBeenCalledTimes(1);
  });

  it("onViewStatus fires on verifying", async () => {
    const onViewStatus = vi.fn();
    const user = userEvent.setup();
    render(<AddUsdCard variant="verifying" onViewStatus={onViewStatus} />);
    await user.click(screen.getByRole("button", { name: "View Status" }));
    expect(onViewStatus).toHaveBeenCalledTimes(1);
  });
});
