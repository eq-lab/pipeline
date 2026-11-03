// spec: docs/frontend/bank-transfers.md#fundingdetailsmodal
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FundingDetailsModal } from "./FundingDetailsModal";
import type { FundingDetailsView } from "./fundingDetails";
import {
  FUNDING_DETAILS_FIXTURE_ERROR,
  FUNDING_DETAILS_FIXTURE_NOT_LINKED,
  FUNDING_DETAILS_FIXTURE_READY,
} from "../routes/test/-fundingDetailsFixture";

const READY = FUNDING_DETAILS_FIXTURE_READY as Extract<
  FundingDetailsView,
  { status: "ready" }
>;
const READY_TEXT = READY.rows.map((r) => `${r.label}: ${r.value}`).join("\n");

function renderModal(
  overrides: Partial<{
    open: boolean;
    onDismiss: () => void;
    view: FundingDetailsView;
    onOpenAccount: () => void;
    onContactSupport: () => void;
  }> = {},
) {
  const onDismiss = overrides.onDismiss ?? vi.fn();
  const open = overrides.open ?? true;

  const result = render(
    <FundingDetailsModal
      open={open}
      onDismiss={onDismiss}
      view={overrides.view}
      onOpenAccount={overrides.onOpenAccount}
      onContactSupport={overrides.onContactSupport}
    />,
  );

  return { onDismiss, ...result };
}

describe("FundingDetailsModal — not open", () => {
  it("renders nothing when open=false", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("FundingDetailsModal — open, default (loading)", () => {
  it("renders role=dialog, aria-modal, and aria-labelledby resolving to the heading", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("heading", { name: "Funding details" }),
    ).toBeInTheDocument();
  });

  it("renders all six labels with — values", () => {
    renderModal();
    for (const label of [
      "Company Name",
      "Bank Name",
      "Bank Address",
      "Account Number",
      "IBAN",
      "SWIFT / BIC code",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("—")).toHaveLength(9);
  });

  it("disables all three copy buttons and shows no notice while loading", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    expect(screen.getByTestId("funding-details-copy-reference")).toBeDisabled();
    expect(screen.getByTestId("funding-details-copy-wallet")).toBeDisabled();
    expect(screen.queryByTestId("funding-details-notice")).toBeNull();
  });
});

describe("FundingDetailsModal — ready", () => {
  it("renders the served values, reference, instruction and destination rows", () => {
    renderModal({ view: READY });
    for (const row of READY.rows) {
      expect(screen.getByText(row.value)).toBeInTheDocument();
    }
    expect(screen.getByText("Payment reference")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add this reference to your transfer’s reference or remittance field. Without it we can’t match your transfer to your account.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("funding-details-row-network")).toHaveTextContent(
      "Stellar",
    );
    const wallet = screen.getByTestId("funding-details-row-receiving-wallet");
    expect(wallet).toHaveTextContent(
      `${READY.receiverAddress.slice(0, 6)}…${READY.receiverAddress.slice(-4)}`,
    );
    expect(wallet).not.toHaveTextContent(READY.receiverAddress);
    expect(screen.getByTitle(READY.receiverAddress)).toBeInTheDocument();
  });

  it("the wallet and note info glyphs carry their tooltips", () => {
    renderModal({ view: READY });
    const walletInfo = screen.getByTestId("funding-details-wallet-info");
    expect(walletInfo).toHaveAccessibleDescription(
      "Your transfer is credited to this wallet as sPLUSD.",
    );
    const noteInfo = screen.getByTestId("funding-details-note-info");
    expect(noteInfo).toHaveAccessibleDescription(
      "Domestic transfers: Same day or within 1 business day\nInternational transfers: 1–5 business days",
    );
    expect(screen.getAllByRole("tooltip")).toHaveLength(2);
  });
});

describe("FundingDetailsModal — unavailable", () => {
  it("not-linked shows the chain notice and Go to Account calls onOpenAccount", async () => {
    const user = userEvent.setup();
    const onOpenAccount = vi.fn();
    renderModal({ view: FUNDING_DETAILS_FIXTURE_NOT_LINKED, onOpenAccount });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bank details need a Stellar wallet linked to your account. Link it on your Account page, or switch to a wallet you have already linked.",
    );
    expect(screen.getAllByText("—")).toHaveLength(9);
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Go to Account" }));
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
  });

  it("error shows the generic notice without Go to Account", () => {
    renderModal({ view: FUNDING_DETAILS_FIXTURE_ERROR });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bank details are unavailable right now. Close this window and try again, or contact support.",
    );
    expect(screen.queryByRole("button", { name: "Go to Account" })).toBeNull();
  });
});

describe("FundingDetailsModal — Copy", () => {
  const mockWriteText = vi.fn();

  function installClipboardMock() {
    mockWriteText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get() {
        return { writeText: mockWriteText };
      },
    });
  }

  function uninstallClipboardMock() {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get() {
        return undefined;
      },
    });
  }

  it("writes the serialized rows to the clipboard and flips the label to Copied", async () => {
    const user = userEvent.setup();
    installClipboardMock();
    renderModal({ view: READY });

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(mockWriteText).toHaveBeenCalledWith(READY_TEXT);
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });

  it("the reference button copies only the reference", async () => {
    const user = userEvent.setup();
    installClipboardMock();
    renderModal({ view: READY });
    await user.click(screen.getByTestId("funding-details-copy-reference"));
    expect(mockWriteText).toHaveBeenCalledWith("PL-0000-0000-0000");
  });

  it("the wallet button copies the full receiving address", async () => {
    const user = userEvent.setup();
    installClipboardMock();
    renderModal({ view: READY });
    await user.click(screen.getByTestId("funding-details-copy-wallet"));
    expect(mockWriteText).toHaveBeenCalledWith(READY.receiverAddress);
    expect(
      await within(
        screen.getByTestId("funding-details-row-receiving-wallet"),
      ).findByText("Copied"),
    ).toBeInTheDocument();
  });

  it("a rejected clipboard promise does not throw and leaves the label at Copy", async () => {
    const user = userEvent.setup();
    installClipboardMock();
    mockWriteText.mockRejectedValue(new Error("nope"));
    renderModal({ view: READY });

    await expect(
      user.click(screen.getByRole("button", { name: "Copy" })),
    ).resolves.not.toThrow();

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("falls back to execCommand and shows Copied when navigator.clipboard is unavailable (#1317)", async () => {
    const user = userEvent.setup();
    uninstallClipboardMock();
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: exec,
    });
    renderModal({ view: READY });

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(exec).toHaveBeenCalledWith("copy");
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
    Reflect.deleteProperty(document, "execCommand");
  });

  it("does not throw with no navigator.clipboard", async () => {
    const user = userEvent.setup();
    uninstallClipboardMock();
    renderModal({ view: READY });

    await expect(
      user.click(screen.getByRole("button", { name: "Copy" })),
    ).resolves.not.toThrow();
  });
});

describe("FundingDetailsModal — dismiss paths", () => {
  it("Escape calls onDismiss", () => {
    const { onDismiss } = renderModal();
    fireEvent.keyDown(document, { key: "Escape", bubbles: true });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("clicking the X calls onDismiss", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("clicking the scrim calls onDismiss", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();
    await user.click(screen.getByTestId("funding-details-modal-scrim"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("clicking inside the panel does not call onDismiss", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();
    await user.click(screen.getByTestId("funding-details-modal"));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("FundingDetailsModal — Contact Support inert seam", () => {
  it("clicking Contact Support with no handler wired does not throw", async () => {
    const user = userEvent.setup();
    renderModal();
    await expect(
      user.click(screen.getByRole("button", { name: "Contact Support" })),
    ).resolves.not.toThrow();
  });

  it("clicking Contact Support calls the supplied handler", async () => {
    const onContactSupport = vi.fn();
    const user = userEvent.setup();
    renderModal({ onContactSupport });
    await user.click(screen.getByRole("button", { name: "Contact Support" }));
    expect(onContactSupport).toHaveBeenCalledTimes(1);
  });
});

describe("FundingDetailsModal — body scroll lock", () => {
  it("locks scroll while open and restores it on unmount", () => {
    const { unmount } = renderModal();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
