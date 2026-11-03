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

  it("disables every row copy button, has no copy-all button and shows no notice while loading", () => {
    renderModal();
    const rowButtons = screen.getAllByRole("button", { name: /^Copy / });
    expect(rowButtons).toHaveLength(8);
    for (const b of rowButtons) expect(b).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
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
    expect(
      screen.getByRole("button", { name: "Copy Payment reference" }),
    ).toBeDisabled();
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

describe("FundingDetailsModal — per-row copy", () => {
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

  it("clicking a bank row copies that row's value and shows Copied in that row only", async () => {
    const user = userEvent.setup();
    installClipboardMock();
    renderModal({ view: READY });
    const iban = READY.rows.find((r) => r.label === "IBAN")!;
    await user.click(screen.getByRole("button", { name: "Copy IBAN" }));
    expect(mockWriteText).toHaveBeenCalledWith(iban.value);
    const row = screen.getByTestId("funding-details-row-iban");
    expect(await within(row).findByText("Copied")).toBeInTheDocument();
    expect(screen.getAllByText("Copied")).toHaveLength(1);
  });

  it("the reference row copies only the reference", async () => {
    const user = userEvent.setup();
    installClipboardMock();
    renderModal({ view: READY });
    await user.click(
      screen.getByRole("button", { name: "Copy Payment reference" }),
    );
    expect(mockWriteText).toHaveBeenCalledWith("PL-0000-0000-0000");
  });

  it("the wallet row copies the full receiving address", async () => {
    const user = userEvent.setup();
    installClipboardMock();
    renderModal({ view: READY });
    await user.click(
      screen.getByRole("button", { name: "Copy Receiving wallet" }),
    );
    expect(mockWriteText).toHaveBeenCalledWith(READY.receiverAddress);
    expect(
      await within(
        screen.getByTestId("funding-details-row-receiving-wallet"),
      ).findByText("Copied"),
    ).toBeInTheDocument();
  });

  it("a rejected clipboard promise does not throw and shows no Copied", async () => {
    const user = userEvent.setup();
    installClipboardMock();
    mockWriteText.mockRejectedValue(new Error("nope"));
    renderModal({ view: READY });
    await expect(
      user.click(screen.getByRole("button", { name: "Copy IBAN" })),
    ).resolves.not.toThrow();
    expect(screen.queryByText("Copied")).toBeNull();
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
    await user.click(screen.getByRole("button", { name: "Copy IBAN" }));
    expect(exec).toHaveBeenCalledWith("copy");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    Reflect.deleteProperty(document, "execCommand");
  });

  it("a touch press held for 500 ms copies the row, and the release click does not copy twice", () => {
    vi.useFakeTimers();
    try {
      installClipboardMock();
      renderModal({ view: READY });
      const btn = screen.getByRole("button", { name: "Copy IBAN" });
      fireEvent.pointerDown(btn, { pointerType: "touch" });
      vi.advanceTimersByTime(499);
      expect(mockWriteText).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(mockWriteText).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(btn, { pointerType: "touch" });
      fireEvent.click(btn);
      expect(mockWriteText).toHaveBeenCalledTimes(1);
      fireEvent.click(btn);
      expect(mockWriteText).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a touch press released before 500 ms does not copy by itself, and a mouse press never arms the hold", () => {
    vi.useFakeTimers();
    try {
      installClipboardMock();
      renderModal({ view: READY });
      const btn = screen.getByRole("button", { name: "Copy IBAN" });
      fireEvent.pointerDown(btn, { pointerType: "touch" });
      vi.advanceTimersByTime(200);
      fireEvent.pointerUp(btn, { pointerType: "touch" });
      vi.advanceTimersByTime(1000);
      expect(mockWriteText).not.toHaveBeenCalled();
      fireEvent.pointerDown(btn, { pointerType: "mouse" });
      vi.advanceTimersByTime(1000);
      expect(mockWriteText).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rows render no copy glyph — the value itself is the pointer target", () => {
    renderModal({ view: READY });
    const btn = screen.getByRole("button", { name: "Copy IBAN" });
    expect(btn.querySelector("svg")).toBeNull();
    expect(btn.className).toContain("cursor-pointer");
  });

  it("does not throw with no navigator.clipboard", async () => {
    const user = userEvent.setup();
    uninstallClipboardMock();
    renderModal({ view: READY });
    await expect(
      user.click(screen.getByRole("button", { name: "Copy IBAN" })),
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
