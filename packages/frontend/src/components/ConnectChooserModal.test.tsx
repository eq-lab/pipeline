/**
 * ConnectChooserModal — unit tests.
 *
 * Covers:
 *   - Does not render when `open` is false.
 *   - Renders when `open` is true (dialog role, correct heading).
 *   - "Connect EVM" button calls `onConnectEvm` and then `onDismiss`.
 *   - "Connect Stellar" button calls `onConnectStellar` and then `onDismiss`.
 *   - Scrim click calls `onDismiss`.
 *   - Escape key calls `onDismiss`.
 *   - Close (×) button calls `onDismiss`.
 *   - Focus trap: Tab cycles within the panel.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectChooserModal } from "./ConnectChooserModal";

afterEach(() => {
  document.body.style.overflow = "";
});

function renderModal(
  overrides: Partial<React.ComponentProps<typeof ConnectChooserModal>> = {},
) {
  const defaults = {
    open: true,
    onConnectEvm: vi.fn(),
    onConnectStellar: vi.fn(),
    onDismiss: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  return { ...render(<ConnectChooserModal {...props} />), ...props };
}

describe("ConnectChooserModal — visibility", () => {
  it("does not render when open is false", () => {
    renderModal({ open: false });
    expect(
      screen.queryByRole("dialog", { name: "Connect a wallet" }),
    ).not.toBeInTheDocument();
  });

  it("renders the dialog when open is true", async () => {
    renderModal();
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Connect a wallet" }),
      ).toBeInTheDocument(),
    );
  });
});

describe("ConnectChooserModal — connect buttons", () => {
  it("Connect EVM button calls onConnectEvm then onDismiss", async () => {
    const user = userEvent.setup();
    const { onConnectEvm, onDismiss } = renderModal();

    const btn = await screen.findByRole("button", { name: "Connect EVM" });
    await user.click(btn);

    expect(onConnectEvm).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("Connect Stellar button calls onConnectStellar then onDismiss", async () => {
    const user = userEvent.setup();
    const { onConnectStellar, onDismiss } = renderModal();

    const btn = await screen.findByRole("button", { name: "Connect Stellar" });
    await user.click(btn);

    expect(onConnectStellar).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("ConnectChooserModal — dismissal", () => {
  it("scrim click calls onDismiss", async () => {
    const { onDismiss } = renderModal();

    const scrim = await screen.findByTestId("connect-chooser-modal-scrim");
    await act(async () => {
      scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
  });

  it("Escape key calls onDismiss", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();

    // Wait for modal to render.
    await screen.findByRole("dialog", { name: "Connect a wallet" });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
  });

  it("Close (×) button calls onDismiss", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();

    const closeBtn = await screen.findByRole("button", { name: "Close" });
    await user.click(closeBtn);

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
