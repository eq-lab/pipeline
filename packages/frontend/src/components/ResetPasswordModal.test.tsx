import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResetPasswordModal } from "./ResetPasswordModal";

function renderModal(
  overrides: Partial<React.ComponentProps<typeof ResetPasswordModal>> = {},
) {
  const props = {
    open: true,
    view: "form" as const,
    onDismiss: vi.fn(),
    onSignIn: vi.fn(),
    onRequestNewLink: vi.fn(),
    ...overrides,
  };
  render(<ResetPasswordModal {...props} />);
  return props;
}

describe("ResetPasswordModal (#1359) — form view", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("renders the heading, description, one password field and a disabled submit", () => {
    renderModal();
    expect(
      screen.getByRole("dialog", { name: "Set a new password" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Choose a new password for your account."),
    ).toBeInTheDocument();
    const inputs = screen.getByRole("dialog").querySelectorAll("input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAttribute("type", "password");
    expect(inputs[0]).toHaveAttribute("autocomplete", "new-password");
    expect(
      screen.getByRole("button", { name: "Save new password" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("a weak password shows the policy error on blur and keeps submit disabled", async () => {
    const user = userEvent.setup();
    renderModal();
    const input = screen.getByPlaceholderText("New password");
    await user.type(input, "weak");
    fireEvent.blur(input);
    expect(
      screen.getByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save new password" }),
    ).toBeDisabled();
  });

  it("a policy-valid password enables submit and a submit calls onSubmit once with { password }", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    await user.type(screen.getByPlaceholderText("New password"), "P@ssw0rd!");
    const submit = screen.getByRole("button", { name: "Save new password" });
    expect(submit).not.toBeDisabled();
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ password: "P@ssw0rd!" });
  });

  it("submit stays disabled while a pending onSubmit promise is outstanding, re-enables on rejection", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => Promise.reject(new Error("boom")));
    renderModal({ onSubmit });
    await user.type(screen.getByPlaceholderText("New password"), "P@ssw0rd!");
    const submit = screen.getByRole("button", { name: "Save new password" });
    await user.click(submit);
    await waitFor(() => expect(submit).not.toBeDisabled());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("passwordServerError renders under the field and typing calls onPasswordEdit", async () => {
    const user = userEvent.setup();
    const onPasswordEdit = vi.fn();
    renderModal({
      passwordServerError: "password must contain a digit",
      onPasswordEdit,
    });
    expect(
      screen.getByText("password must contain a digit"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("New password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await user.type(screen.getByPlaceholderText("New password"), "x");
    expect(onPasswordEdit).toHaveBeenCalled();
  });

  it("formError renders as an alert", () => {
    renderModal({
      formError: "Network error — check your connection and try again.",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Network error — check your connection and try again.",
    );
  });

  it("Escape and × call onDismiss", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();
    fireEvent.keyDown(document, { key: "Escape", bubbles: true });
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});

describe("ResetPasswordModal (#1359) — expired and done views", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("expired: copy, Request a new link calls onRequestNewLink, Back to sign in calls onSignIn, no input", async () => {
    const user = userEvent.setup();
    const { onRequestNewLink, onSignIn } = renderModal({ view: "expired" });
    expect(
      screen.getByRole("dialog", { name: "This link has expired" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Password reset links work once and expire after a short while. Request a new one to continue.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelectorAll("input")).toHaveLength(
      0,
    );
    await user.click(
      screen.getByRole("button", { name: "Request a new link" }),
    );
    expect(onRequestNewLink).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Remembered it\?/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("done: copy and Sign in calls onSignIn", async () => {
    const user = userEvent.setup();
    const { onSignIn } = renderModal({ view: "done" });
    expect(
      screen.getByRole("dialog", { name: "Password updated" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your password has been changed and every other session was signed out. Sign in with your new password to continue.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelectorAll("input")).toHaveLength(
      0,
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});
