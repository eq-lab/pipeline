import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddEmailModal } from "./AddEmailModal";

function renderModal(
  overrides: Partial<React.ComponentProps<typeof AddEmailModal>> = {},
) {
  const onBack = overrides.onBack ?? vi.fn();
  const { rerender, ...rest } = render(
    <AddEmailModal
      open={overrides.open ?? true}
      onBack={onBack}
      {...overrides}
    />,
  );
  return {
    onBack,
    rerender: (
      next: Partial<React.ComponentProps<typeof AddEmailModal>> = {},
    ) =>
      rerender(
        <AddEmailModal
          open={next.open ?? overrides.open ?? true}
          onBack={next.onBack ?? onBack}
          {...next}
        />,
      ),
    ...rest,
  };
}

const VALID_PASSWORD = "P@ssw0rd!";

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText("Enter corporate email"),
    "lp@example.com",
  );
  await user.type(screen.getByPlaceholderText("Password"), VALID_PASSWORD);
}

describe("AddEmailModal (#1459)", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("renders nothing when open=false", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("portals into document.body when open", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("role=dialog, aria-modal, and aria-labelledby resolve to the Add email heading", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const heading = screen.getByRole("heading", { name: "Add email" });
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("renders the description below the heading", () => {
    renderModal();
    expect(
      screen.getByText("Enter your corporate email and create a password"),
    ).toBeInTheDocument();
  });

  it("has the add-email-modal testid", () => {
    renderModal();
    expect(screen.getByTestId("add-email-modal")).toBeInTheDocument();
  });

  it("renders no image panel", () => {
    renderModal();
    expect(
      screen.getByTestId("add-email-modal-overlay").querySelector("img"),
    ).not.toBeInTheDocument();
  });

  it("renders no Close button, but a Back button", () => {
    renderModal();
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("renders exactly two inputs — no confirm-password, company field, or checkbox", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("input")).toHaveLength(2);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not render Continue with wallet, OR, or the sign-in footer", () => {
    renderModal();
    expect(
      screen.queryByRole("button", { name: /Continue with wallet/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("OR")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Already have an account\?/),
    ).not.toBeInTheDocument();
  });

  it("submit is disabled with both fields empty", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("stays disabled for a valid email and a weak password", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(
      screen.getByPlaceholderText("Enter corporate email"),
      "lp@example.com",
    );
    await user.type(screen.getByPlaceholderText("Password"), "short1");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("enables once both fields are valid", async () => {
    const user = userEvent.setup();
    renderModal();
    await fillValid(user);
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("the weak-password policy copy appears on blur", async () => {
    const user = userEvent.setup();
    renderModal();
    const passwordField = screen.getByPlaceholderText("Password");
    await user.type(passwordField, "weak");
    fireEvent.blur(passwordField);
    expect(
      screen.getByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).toBeInTheDocument();
  });

  it("the malformed-email copy appears on blur", async () => {
    const user = userEvent.setup();
    renderModal();
    const emailField = screen.getByPlaceholderText("Enter corporate email");
    await user.type(emailField, "nope");
    fireEvent.blur(emailField);
    expect(
      screen.getByText("Enter the correct email address"),
    ).toBeInTheDocument();
  });

  it("the password eye toggle flips the input type and its accessible name", async () => {
    const user = userEvent.setup();
    renderModal();
    const toggle = screen.getByRole("button", { name: "Show password" });
    await user.click(toggle);

    expect(screen.getByPlaceholderText("Password")).toHaveAttribute(
      "type",
      "text",
    );
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toBeInTheDocument();
  });

  it("onBack fires from the arrow", async () => {
    const user = userEvent.setup();
    const { onBack } = renderModal();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("onBack fires from Escape", () => {
    const { onBack } = renderModal();
    fireEvent.keyDown(document, { key: "Escape", bubbles: true });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("clicking Save with valid input calls onSubmit once with { email, password }", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    await fillValid(user);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      email: "lp@example.com",
      password: VALID_PASSWORD,
    });
  });

  it("an async onSubmit disables Save while pending, then re-enables it", async () => {
    const user = userEvent.setup();
    let resolveSubmit!: () => void;
    const onSubmit = vi.fn(
      () => new Promise<void>((resolve) => (resolveSubmit = resolve)),
    );
    renderModal({ onSubmit });
    await fillValid(user);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    resolveSubmit();
    await screen.findByRole("button", { name: "Save" });
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("renders the turnstileSlot when provided", () => {
    renderModal({ turnstileSlot: <div data-testid="turnstile-stub" /> });
    expect(screen.getByTestId("turnstile-stub")).toBeInTheDocument();
  });

  it("valid credentials enable Save while verification is loading", async () => {
    const user = userEvent.setup();
    renderModal({ captchaStatus: "loading" });
    await fillValid(user);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Verification is loading",
    );
  });

  it("a failed verification shows a retry control", async () => {
    const user = userEvent.setup();
    const onCaptchaRetry = vi.fn();
    renderModal({ captchaStatus: "error", onCaptchaRetry });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Verification failed to load",
    );
    await user.click(
      screen.getByRole("button", { name: "Retry verification" }),
    );
    expect(onCaptchaRetry).toHaveBeenCalledTimes(1);
  });

  it("formError renders as a form-level alert", () => {
    renderModal({ formError: "Something went wrong — try again." });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong — try again.",
    );
  });

  it("state resets when open goes false then true", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal();
    await fillValid(user);
    expect(
      (screen.getByPlaceholderText("Enter corporate email") as HTMLInputElement)
        .value,
    ).toBe("lp@example.com");

    rerender({ open: false });
    rerender({ open: true });

    expect(
      (screen.getByPlaceholderText("Enter corporate email") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(
      (screen.getByPlaceholderText("Password") as HTMLInputElement).value,
    ).toBe("");
  });
});
