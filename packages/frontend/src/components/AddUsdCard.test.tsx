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
    variant: "declined",
    heading: "We can’t verify your account",
    subCaption: "Please check and try again.",
    primaryLabel: "View",
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

  it("onViewStatus fires on declined", async () => {
    const onViewStatus = vi.fn();
    const user = userEvent.setup();
    render(<AddUsdCard variant="declined" onViewStatus={onViewStatus} />);
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(onViewStatus).toHaveBeenCalledTimes(1);
  });
});

describe("AddUsdCard — declined variant (#1426)", () => {
  it("renders the Figma heading with its typographic apostrophe (U+2019)", () => {
    render(<AddUsdCard variant="declined" />);
    const heading = screen.getByText(/We can.t verify your account/);
    expect(heading.textContent).toBe("We can’t verify your account");
  });

  it("carries the declined data-variant and data-node-id", () => {
    render(<AddUsdCard variant="declined" />);
    const region = screen.getByRole("region");
    expect(region.getAttribute("data-variant")).toBe("declined");
    expect(region.getAttribute("data-node-id")).toBe("6702:104191");
  });

  it("renders the warning illustration anchored at the card-box offset", () => {
    const { container } = render(<AddUsdCard variant="declined" />);
    const illustration = container.querySelector("[data-tone]");
    expect(illustration?.className).toContain("absolute");
    expect(illustration?.className).toContain("top-[48px]");
    expect(illustration?.className).toContain("left-[128.86px]");
  });

  it("renders no Add Funds control and no Start Verification / View Status label", () => {
    render(<AddUsdCard variant="declined" />);
    expect(
      screen.queryByRole("button", { name: "Add Funds" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start Verification" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View Status" }),
    ).not.toBeInTheDocument();
  });
});

describe("AddUsdCard — Shape B frame and illustration anchor (#1430)", () => {
  it.each([
    { variant: "verify" as const, anchor: ["top-[76px]", "left-[164px]"] },
    { variant: "verifying" as const, anchor: ["top-[66px]", "left-[174px]"] },
  ])(
    "$variant clips a card-anchored illustration inside a 246px frame",
    ({ variant, anchor }) => {
      const { container } = render(<AddUsdCard variant={variant} />);
      const card = screen.getByRole("region");
      expect(card.className).toContain("h-[246px]");
      expect(card.className).toContain("relative");
      expect(card.className).toContain("overflow-hidden");

      const illustration = container.querySelector("[data-tone]");
      expect(illustration?.className).toContain("absolute");
      for (const token of anchor) {
        expect(illustration?.className).toContain(token);
      }
      expect(illustration?.parentElement?.className).not.toContain("relative");
    },
  );

  it.each(["locked", "unlocked", "funded"] as const)(
    "%s keeps the unconstrained horizontal frame",
    (variant) => {
      render(<AddUsdCard variant={variant} />);
      expect(screen.getByRole("region").className).not.toContain("h-[246px]");
    },
  );
});
