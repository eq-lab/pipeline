import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthModalShell } from "./AuthModalShell";

function renderShell(open = true) {
  return render(
    <AuthModalShell
      open={open}
      onDismiss={vi.fn()}
      heading="Sign in"
      headingId="sign-in-modal-heading"
      testId="sign-in-modal"
    >
      <p>Left pane content</p>
    </AuthModalShell>,
  );
}

describe("AuthModalShell (#1248)", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("renders nothing when open=false", () => {
    renderShell(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the heading wired to aria-labelledby", () => {
    renderShell();
    const dialog = screen.getByRole("dialog");
    const heading = screen.getByRole("heading", { name: "Sign in" });
    expect(heading).toHaveAttribute("id", "sign-in-modal-heading");
    expect(dialog).toHaveAttribute("aria-labelledby", "sign-in-modal-heading");
  });

  it("renders children in the left pane", () => {
    renderShell();
    expect(screen.getByText("Left pane content")).toBeInTheDocument();
  });

  it("the right image pane is aria-hidden", () => {
    renderShell();
    const dialog = screen.getByRole("dialog");
    const hiddenPane = dialog.querySelector('[aria-hidden="true"]');
    expect(hiddenPane).toBeInTheDocument();
  });

  it("locks body scroll while open and restores it on unmount", () => {
    const { unmount } = renderShell();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
