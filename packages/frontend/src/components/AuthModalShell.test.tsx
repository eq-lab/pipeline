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

describe("AuthModalShell — new optional props (#1250)", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("defaults are unchanged: no description, image pane present, close button present, no back button, no my-auto", () => {
    renderShell();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    const hiddenPane = dialog.querySelector('[aria-hidden="true"]');
    expect(hiddenPane).toBeInTheDocument();

    const column = screen.getByRole("heading", { name: "Sign in" })
      .parentElement?.parentElement;
    expect(column?.className).not.toContain("my-auto");
  });

  it("description renders a <p> under the heading", () => {
    render(
      <AuthModalShell
        open
        onDismiss={vi.fn()}
        heading="Check your inbox"
        headingId="otp-modal-heading"
        testId="otp-modal"
        description="We’ve sent a passcode to user@email.io"
      >
        <p>Content</p>
      </AuthModalShell>,
    );
    expect(
      screen.getByText("We’ve sent a passcode to user@email.io"),
    ).toBeInTheDocument();
  });

  it("showImagePanel={false} removes the image pane", () => {
    render(
      <AuthModalShell
        open
        onDismiss={vi.fn()}
        heading="Sign in"
        headingId="sign-in-modal-heading"
        testId="sign-in-modal"
        showImagePanel={false}
      >
        <p>Content</p>
      </AuthModalShell>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")).not.toBeInTheDocument();
  });

  it("showCloseButton={false} removes the close button", () => {
    render(
      <AuthModalShell
        open
        onDismiss={vi.fn()}
        heading="Sign in"
        headingId="sign-in-modal-heading"
        testId="sign-in-modal"
        showCloseButton={false}
      >
        <p>Content</p>
      </AuthModalShell>,
    );
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
  });

  it("onBack renders the labelled back button", async () => {
    const onBack = vi.fn();
    render(
      <AuthModalShell
        open
        onDismiss={vi.fn()}
        heading="Check your inbox"
        headingId="otp-modal-heading"
        testId="otp-modal"
        onBack={onBack}
      >
        <p>Content</p>
      </AuthModalShell>,
    );
    const backButton = screen.getByRole("button", { name: "Back" });
    expect(backButton).toBeInTheDocument();
  });

  it("align=center applies my-auto to the content column", () => {
    render(
      <AuthModalShell
        open
        onDismiss={vi.fn()}
        heading="Check your inbox"
        headingId="otp-modal-heading"
        testId="otp-modal"
        align="center"
      >
        <p>Content</p>
      </AuthModalShell>,
    );
    const column = screen.getByRole("heading", { name: "Check your inbox" })
      .parentElement?.parentElement;
    expect(column?.className).toContain("my-auto");
  });
});

describe("AuthModalShell — stepLabel prop (#1251)", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("omitting stepLabel renders no badge", () => {
    renderShell();
    expect(screen.queryByText(/^Step /)).not.toBeInTheDocument();
  });

  it("stepLabel renders the two-tone Step N/total badge", () => {
    render(
      <AuthModalShell
        open
        onDismiss={vi.fn()}
        heading="Finish account setup"
        headingId="company-docs-modal-heading"
        testId="company-docs-modal"
        stepLabel={{ current: 1, total: 2 }}
      >
        <p>Content</p>
      </AuthModalShell>,
    );
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByText("/2")).toBeInTheDocument();
  });

  it("stepLabel renders with a different run (Step 2/2)", () => {
    render(
      <AuthModalShell
        open
        onDismiss={vi.fn()}
        heading="Owners"
        headingId="owners-modal-heading"
        testId="owners-modal"
        stepLabel={{ current: 2, total: 2 }}
      >
        <p>Content</p>
      </AuthModalShell>,
    );
    expect(screen.getByText("Step 2")).toBeInTheDocument();
    expect(screen.getByText("/2")).toBeInTheDocument();
  });
});

describe("AuthModalShell — new optional props (#1253)", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("omitting icon renders no icon wrapper, omitting headingAlign leaves no text-center", () => {
    renderShell();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".mb-2")).not.toBeInTheDocument();

    const headingWrapper = screen.getByRole("heading", {
      name: "Sign in",
    }).parentElement;
    expect(headingWrapper?.className).not.toContain("text-center");
  });

  it("icon renders above the heading, inside a mb-2 wrapper", () => {
    render(
      <AuthModalShell
        open
        onDismiss={vi.fn()}
        heading="Your account is under review"
        headingId="account-in-review-modal-heading"
        testId="account-in-review-modal"
        icon={<span data-testid="shell-icon">icon</span>}
      >
        <p>Content</p>
      </AuthModalShell>,
    );
    const icon = screen.getByTestId("shell-icon");
    const heading = screen.getByRole("heading", {
      name: "Your account is under review",
    });
    expect(icon.parentElement?.className).toContain("mb-2");
    expect(
      icon.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("headingAlign=center adds text-center to the heading wrapper and nothing else", () => {
    render(
      <AuthModalShell
        open
        onDismiss={vi.fn()}
        heading="Your account is under review"
        headingId="account-in-review-modal-heading"
        testId="account-in-review-modal"
        headingAlign="center"
      >
        <p>Content</p>
      </AuthModalShell>,
    );
    const headingWrapper = screen.getByRole("heading", {
      name: "Your account is under review",
    }).parentElement;
    expect(headingWrapper?.className).toContain("text-center");

    const column = headingWrapper?.parentElement;
    expect(column?.className).not.toContain("my-auto");
  });
});
