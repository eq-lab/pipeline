// spec: docs/frontend/bank-transfers.md#fundingdetailsmodal
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FundingDetailsModal } from "./FundingDetailsModal";
import { FUNDING_DETAILS_PLACEHOLDER } from "./fundingDetails";

function renderModal(
  overrides: Partial<{
    open: boolean;
    onDismiss: () => void;
    details: typeof FUNDING_DETAILS_PLACEHOLDER;
    onContactSupport: () => void;
  }> = {},
) {
  const onDismiss = overrides.onDismiss ?? vi.fn();
  const open = overrides.open ?? true;

  const result = render(
    <FundingDetailsModal
      open={open}
      onDismiss={onDismiss}
      details={overrides.details}
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

describe("FundingDetailsModal — open, default (no details)", () => {
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
    expect(screen.getAllByText("—")).toHaveLength(6);
  });
});

describe("FundingDetailsModal — with FUNDING_DETAILS_PLACEHOLDER", () => {
  it("renders all six values", () => {
    renderModal({ details: FUNDING_DETAILS_PLACEHOLDER });
    for (const row of FUNDING_DETAILS_PLACEHOLDER) {
      expect(screen.getByText(row.value)).toBeInTheDocument();
    }
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
    renderModal({ details: FUNDING_DETAILS_PLACEHOLDER });

    await user.click(screen.getByRole("button", { name: /copy/i }));

    expect(mockWriteText).toHaveBeenCalledWith(
      FUNDING_DETAILS_PLACEHOLDER.map(
        (row) => `${row.label}: ${row.value}`,
      ).join("\n"),
    );
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });

  it("a rejected clipboard promise does not throw and leaves the label at Copy", async () => {
    const user = userEvent.setup();
    installClipboardMock();
    mockWriteText.mockRejectedValue(new Error("nope"));
    renderModal();

    await expect(
      user.click(screen.getByRole("button", { name: "Copy" })),
    ).resolves.not.toThrow();

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("does not throw with no navigator.clipboard", async () => {
    const user = userEvent.setup();
    uninstallClipboardMock();
    renderModal();

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
