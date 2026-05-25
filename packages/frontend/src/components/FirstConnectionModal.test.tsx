/**
 * Unit tests for FirstConnectionModal.
 *
 * Covers:
 *  - Renders init state: toggle off, Continue disabled.
 *  - Toggling enables Continue.
 *  - Clicking Continue with toggle on → calls onContinue.
 *  - Continue is NOT called when toggle is off.
 *  - Clicking Disconnect → calls onDismiss.
 *  - Pressing Escape → calls onDismiss.
 *  - Clicking scrim → calls onDismiss.
 *  - Clicking X button → calls onDismiss.
 *  - aria-modal is set.
 *  - When open=false nothing is rendered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FirstConnectionModal } from "./FirstConnectionModal";

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderModal(
  overrides: Partial<{
    open: boolean;
    onContinue: () => void;
    onDismiss: () => void;
  }> = {},
) {
  const onContinue = overrides.onContinue ?? vi.fn();
  const onDismiss = overrides.onDismiss ?? vi.fn();
  const open = overrides.open ?? true;

  const result = render(
    <FirstConnectionModal
      open={open}
      onContinue={onContinue}
      onDismiss={onDismiss}
    />,
  );

  return { onContinue, onDismiss, ...result };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FirstConnectionModal — not open", () => {
  it("renders nothing when open=false", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("FirstConnectionModal — open, init state", () => {
  beforeEach(() => {
    // createPortal renders into document.body; jsdom handles this correctly.
  });

  it("renders the dialog with aria-modal", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("has the correct heading", () => {
    renderModal();
    expect(
      screen.getByRole("heading", { name: "Before you continue" }),
    ).toBeInTheDocument();
  });

  it("renders the jurisdiction bullet", () => {
    renderModal();
    expect(
      screen.getByText(/Pipeline unavailable to US persons/i),
    ).toBeInTheDocument();
  });

  it("renders the sanctions screening bullet", () => {
    renderModal();
    expect(
      screen.getByText(/Wallets are screened for sanctions/i),
    ).toBeInTheDocument();
  });

  it("renders the toggle in unchecked state", () => {
    renderModal();
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("Continue button is disabled (aria-disabled) initially", () => {
    renderModal();
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).toHaveAttribute("aria-disabled", "true");
    expect(continueBtn).toBeDisabled();
  });

  it("renders Terms of Service link with href='#'", () => {
    renderModal();
    const link = screen.getByRole("link", { name: /Terms of Service/i });
    expect(link).toHaveAttribute("href", "#");
  });
});

describe("FirstConnectionModal — toggle interaction", () => {
  it("toggling the switch enables Continue", async () => {
    const user = userEvent.setup();
    renderModal();

    const toggle = screen.getByRole("switch");
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).not.toBeDisabled();
    expect(continueBtn).toHaveAttribute("aria-disabled", "false");
  });

  it("toggling on then off re-disables Continue", async () => {
    const user = userEvent.setup();
    renderModal();

    const toggle = screen.getByRole("switch");
    await user.click(toggle); // on
    await user.click(toggle); // off

    expect(toggle).toHaveAttribute("aria-checked", "false");
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).toBeDisabled();
  });

  it("keyboard Space toggles the switch", async () => {
    const user = userEvent.setup();
    renderModal();

    const toggle = screen.getByRole("switch");
    toggle.focus();
    await user.keyboard(" ");

    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});

describe("FirstConnectionModal — Continue button", () => {
  it("clicking Continue with toggle on calls onContinue", async () => {
    const user = userEvent.setup();
    const { onContinue } = renderModal();

    const toggle = screen.getByRole("switch");
    await user.click(toggle);

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await user.click(continueBtn);

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("clicking Continue with toggle off does NOT call onContinue", async () => {
    const user = userEvent.setup();
    const { onContinue } = renderModal();

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await user.click(continueBtn);

    expect(onContinue).not.toHaveBeenCalled();
  });
});

describe("FirstConnectionModal — dismiss paths", () => {
  it("clicking Disconnect calls onDismiss", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("clicking the X (Close) button calls onDismiss", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("pressing Escape calls onDismiss", async () => {
    const { onDismiss } = renderModal();

    fireEvent.keyDown(document, { key: "Escape", bubbles: true });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("clicking the scrim (backdrop) calls onDismiss", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();

    const scrim = screen.getByTestId("first-connection-modal-scrim");
    await user.click(scrim);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("clicking inside the modal panel does NOT call onDismiss", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();

    const panel = screen.getByTestId("first-connection-modal");
    await user.click(panel);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("FirstConnectionModal — reopen resets toggle", () => {
  it("toggle resets to unchecked each time the modal opens", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal();

    // Toggle on
    await user.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    // Close
    rerender(
      <FirstConnectionModal
        open={false}
        onContinue={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    // Reopen
    rerender(
      <FirstConnectionModal
        open={true}
        onContinue={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
});
