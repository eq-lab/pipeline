/**
 * DOM tests for `ErrorDetailsDialog` imported from @pipeline/ui (#1034).
 *
 * These tests run in the frontend's Vitest environment (jsdom) rather than
 * adding a separate test runner to @pipeline/ui — same fallback path as
 * `src/lib/toast/Toast.dom.test.tsx`.
 *
 * Coverage:
 *   - `open={false}` renders nothing.
 *   - `open` renders `role="dialog"` with `aria-modal="true"` and the <pre>
 *     containing the full raw fixture, including its tail.
 *   - Escape closes; backdrop click closes; panel click does not.
 *   - Copy button writes the exact `details` string to the clipboard and
 *     flips the label to "Copied" for ~1.5s.
 *   - Clipboard rejection does not throw and the label stays "Copy".
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorDetailsDialog } from "@pipeline/ui";

const SOROBAN_ERROR_3_FIXTURE =
  'DepositManager.request_deposit simulation error: HostError: Error(Contract, #3) Event log (newest first): 0: [Diagnostic Event] contract:CB3CW55RXOQ5VUY7GJF5SOKSPFVHW7DZO3DE4664TGLBK25MZYEAANHG, topics:[error, Error(Contract, #3)], data:"escalating error to VM trap from failed host function call: fail_with_error" TAIL_MARKER';

describe("ErrorDetailsDialog", () => {
  it("open=false renders nothing", () => {
    render(
      <ErrorDetailsDialog
        open={false}
        details={SOROBAN_ERROR_3_FIXTURE}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("open renders role=dialog with aria-modal and the full raw text including its tail", () => {
    render(
      <ErrorDetailsDialog
        open
        details={SOROBAN_ERROR_3_FIXTURE}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const pre = screen.getByTestId("error-details-raw");
    expect(pre).toHaveTextContent("Diagnostic Event");
    expect(pre).toHaveTextContent("TAIL_MARKER");
  });

  it("Escape calls onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ErrorDetailsDialog open details="raw text" onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape does not reach a sibling bubble-phase window listener registered first (#1037 nested-dialog regression)", async () => {
    // Simulates a parent dialog (e.g. a trustee review dialog) that registers
    // its own bubble-phase `window` keydown listener BEFORE this dialog
    // mounts — the exact shape of the pre-#1037 bug, where the parent's
    // earlier-registered bubble listener fired first and closed the parent
    // (unmounting this dialog with it) instead of just this dialog consuming
    // Escape.
    const parentOnClose = vi.fn();
    function parentHandleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") parentOnClose();
    }
    window.addEventListener("keydown", parentHandleKeyDown);
    try {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(<ErrorDetailsDialog open details="raw text" onClose={onClose} />);
      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(parentOnClose).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", parentHandleKeyDown);
    }
  });

  it("backdrop click calls onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ErrorDetailsDialog open details="raw text" onClose={onClose} />);
    await user.click(screen.getByTestId("error-details-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("panel click does NOT call onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ErrorDetailsDialog open details="raw text" onClose={onClose} />);
    await user.click(screen.getByTestId("error-details-dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  describe("Copy button", () => {
    // `@testing-library/user-event`'s `.setup()` unconditionally attaches its
    // OWN in-memory clipboard stub to `navigator.clipboard` on every call
    // (`Clipboard.attachClipboardStubToView`) unless one is already attached
    // — so the custom `navigator.clipboard` mock MUST be (re)installed AFTER
    // `userEvent.setup()` in each test, not before, or `.setup()` silently
    // clobbers it and every `writeText` call resolves via user-event's own
    // stub instead of `mockWriteText` (verified empirically; not documented
    // in the AccountDropdown.test.tsx precedent, which never asserts the
    // mock was called with a specific value, so the same clobbering there is
    // latent, not exercised).
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

    it("writes the exact details string and flips the label to Copied, then back after 1.5s", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const user = userEvent.setup({ delay: null });
        installClipboardMock();
        render(
          <ErrorDetailsDialog
            open
            details="exact raw text"
            onClose={vi.fn()}
          />,
        );

        await act(async () => {
          await user.click(screen.getByTestId("error-details-copy"));
        });
        expect(mockWriteText).toHaveBeenCalledWith("exact raw text");

        await waitFor(() =>
          expect(
            screen.getByRole("button", { name: "Copied" }),
          ).toBeInTheDocument(),
        );

        act(() => {
          vi.advanceTimersByTime(1600);
        });

        await waitFor(() =>
          expect(
            screen.getByRole("button", { name: "Copy" }),
          ).toBeInTheDocument(),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("clipboard rejection does not throw and the label stays Copy", async () => {
      const user = userEvent.setup();
      installClipboardMock();
      mockWriteText.mockRejectedValue(new Error("denied"));
      render(<ErrorDetailsDialog open details="raw text" onClose={vi.fn()} />);

      await expect(
        user.click(screen.getByTestId("error-details-copy")),
      ).resolves.not.toThrow();

      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    });
  });
});
