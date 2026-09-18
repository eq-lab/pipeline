import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountInReviewModal } from "./AccountInReviewModal";

function renderModal(
  props: Partial<React.ComponentProps<typeof AccountInReviewModal>> = {},
) {
  const onDismiss = props.onDismiss ?? vi.fn();
  return {
    onDismiss,
    ...render(
      <AccountInReviewModal
        open={props.open ?? true}
        onDismiss={onDismiss}
        {...props}
      />,
    ),
  };
}

describe("AccountInReviewModal — default state", () => {
  it("renders heading, description, both buttons enabled", () => {
    renderModal();
    expect(
      screen.getByRole("heading", { name: "Your account is under review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "It can take up to 2 weeks. We can notify you when it’s ready.",
      ),
    ).toBeInTheDocument();
    const notify = screen.getByRole("button", { name: "Notify me" });
    const goToApp = screen.getByRole("button", { name: "Go to app" });
    expect(notify).not.toBeDisabled();
    expect(goToApp).not.toBeDisabled();
  });
});

describe("AccountInReviewModal — shell composition", () => {
  it("no image panel, close button present, no back button, no step badge, centered content/heading", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Step /)).not.toBeInTheDocument();

    const column = screen.getByRole("heading", {
      name: "Your account is under review",
    }).parentElement?.parentElement;
    expect(column?.className).toContain("my-auto");

    const headingWrapper = screen.getByRole("heading", {
      name: "Your account is under review",
    }).parentElement;
    expect(headingWrapper?.className).toContain("text-center");
  });
});

describe("AccountInReviewModal — icon slot", () => {
  it("renders exactly one 36x36 shield glyph above the heading, aria-hidden", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    const glyphs = dialog.querySelectorAll('svg[width="36"][height="36"]');
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]).toHaveAttribute("aria-hidden", "true");
  });
});

describe("AccountInReviewModal — notify flip", () => {
  it("swaps the accessible name, sets aria-disabled, shows check glyph, calls onNotifyMe once", () => {
    const onNotifyMe = vi.fn();
    renderModal({ onNotifyMe });
    const notify = screen.getByRole("button", { name: "Notify me" });

    fireEvent.click(notify);

    const flipped = screen.getByRole("button", { name: "We’ll notify you" });
    expect(flipped).toBe(notify);
    expect(flipped).toHaveAttribute("aria-disabled", "true");
    expect(
      flipped.querySelector('svg[width="24"][height="24"]'),
    ).toBeInTheDocument();
    expect(onNotifyMe).toHaveBeenCalledTimes(1);
  });
});

describe("AccountInReviewModal — focus survives the flip", () => {
  it("keeps the same button element focused after clicking Notify me", () => {
    renderModal();
    const notify = screen.getByRole("button", { name: "Notify me" });
    notify.focus();
    expect(document.activeElement).toBe(notify);

    fireEvent.click(notify);

    expect(document.activeElement).toBe(notify);
  });
});

describe("AccountInReviewModal — notified button is inert", () => {
  it("a second click does not call onNotifyMe again or change state", () => {
    const onNotifyMe = vi.fn();
    renderModal({ onNotifyMe });
    const notify = screen.getByRole("button", { name: "Notify me" });

    fireEvent.click(notify);
    const flipped = screen.getByRole("button", { name: "We’ll notify you" });
    fireEvent.click(flipped);

    expect(onNotifyMe).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "We’ll notify you" }),
    ).toBeInTheDocument();
  });
});

describe("AccountInReviewModal — Go to app", () => {
  it("calls onGoToApp once and is unaffected by notified state", () => {
    const onGoToApp = vi.fn();
    renderModal({ onGoToApp });

    fireEvent.click(screen.getByRole("button", { name: "Notify me" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to app" }));

    expect(onGoToApp).toHaveBeenCalledTimes(1);
  });
});

describe("AccountInReviewModal — reopen resets", () => {
  it("returns to Notify me after closing and reopening", () => {
    const { rerender } = renderModal({ open: true });
    fireEvent.click(screen.getByRole("button", { name: "Notify me" }));
    expect(
      screen.getByRole("button", { name: "We’ll notify you" }),
    ).toBeInTheDocument();

    rerender(<AccountInReviewModal open={false} onDismiss={vi.fn()} />);
    rerender(<AccountInReviewModal open onDismiss={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Notify me" }),
    ).toBeInTheDocument();
  });
});

describe("AccountInReviewModal — dismiss", () => {
  it("the × button calls onDismiss once", () => {
    const { onDismiss } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("Escape calls onDismiss once", () => {
    const { onDismiss } = renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("AccountInReviewModal — copy is verbatim", () => {
  it("uses curly apostrophes in the notified label and the description", () => {
    renderModal();
    expect(
      screen.getByText(
        "It can take up to 2 weeks. We can notify you when it’s ready.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Notify me" }));
    expect(screen.getByText("We’ll notify you")).toBeInTheDocument();
  });
});
