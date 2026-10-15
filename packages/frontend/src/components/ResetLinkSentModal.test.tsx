import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResetLinkSentModal } from "./ResetLinkSentModal";

function renderModal(
  overrides: Partial<React.ComponentProps<typeof ResetLinkSentModal>> = {},
) {
  const props = {
    open: true,
    onDismiss: vi.fn(),
    onBackToSignIn: vi.fn(),
    onTryAgain: vi.fn(),
    ...overrides,
  };
  render(<ResetLinkSentModal {...props} />);
  return props;
}

describe("ResetLinkSentModal (#1359)", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("renders nothing when open=false", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("heading, enumeration-safe description with the email, no close button, no image panel", () => {
    renderModal({ email: "lp@example.com" });
    const dialog = screen.getByRole("dialog", { name: "Check your inbox" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByText(
        "If an account exists for lp@example.com, a password reset link is on its way. Follow it to set a new password.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelectorAll("input")).toHaveLength(0);
  });

  it("falls back to 'that address' when no email is known", () => {
    renderModal();
    expect(
      screen.getByText(/If an account exists for that address,/),
    ).toBeInTheDocument();
  });

  it("Back to sign in button and the back arrow both call onBackToSignIn", async () => {
    const user = userEvent.setup();
    const { onBackToSignIn } = renderModal();
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBackToSignIn).toHaveBeenCalledTimes(2);
  });

  it("'Didn’t get it? Try again' calls onTryAgain once", async () => {
    const user = userEvent.setup();
    const { onTryAgain } = renderModal();
    expect(screen.getByText(/Didn’t get it\?/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it("Escape calls onDismiss once", () => {
    const { onDismiss } = renderModal();
    fireEvent.keyDown(document, { key: "Escape", bubbles: true });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
