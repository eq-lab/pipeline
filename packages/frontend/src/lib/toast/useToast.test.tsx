/**
 * Unit tests for the ToastProvider / useToast hook.
 *
 * Uses vi.useFakeTimers() for deterministic auto-dismiss assertions.
 *
 * Coverage (per plan Test Strategy):
 *   1. show({ tone: "success" }) → toast appears; auto-dismisses after 5 000 ms.
 *   2. show({ tone: "pending" }) → toast does NOT auto-dismiss (10 s later still visible).
 *   3. update(id, …) → replaces the toast in place; arms the auto-dismiss timer.
 *   4. dismiss(id) → removes the toast and cancels its timer.
 *   5. Stack cap: show 4 times → only 3 toasts on screen, oldest is gone.
 *   6. show({ id }) with an existing id → upserts (same dom node, no duplicate).
 *   7. useToast() outside <ToastProvider> → throws a clear error.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { ToastProvider } from "./ToastProvider";
import { useToast } from "./useToast";

// ── Helper: a component that exposes the toast API via render ─────────────────

interface EmitterProps {
  onReady: (api: ReturnType<typeof useToast>) => void;
}

function ToastEmitter({ onReady }: EmitterProps) {
  const toast = useToast();
  React.useEffect(() => {
    onReady(toast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderWithProvider(
  onReady: (api: ReturnType<typeof useToast>) => void,
) {
  return render(
    <ToastProvider>
      <ToastEmitter onReady={onReady} />
    </ToastProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useToast / ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. show({ tone: 'success' }) adds a toast that auto-dismisses after 5 000 ms", async () => {
    let api!: ReturnType<typeof useToast>;
    renderWithProvider((a) => (api = a));

    act(() => {
      api.show({ tone: "success", title: "ok" });
    });

    expect(screen.getByText("ok")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("ok")).not.toBeInTheDocument();
  });

  it("2. show({ tone: 'pending' }) does NOT auto-dismiss after 10 000 ms", async () => {
    let api!: ReturnType<typeof useToast>;
    renderWithProvider((a) => (api = a));

    act(() => {
      api.show({ tone: "pending", title: "Sending…" });
    });

    expect(screen.getByText("Sending…")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByText("Sending…")).toBeInTheDocument();
  });

  it("3. update(id, …) replaces the pending toast in place and arms auto-dismiss", async () => {
    let api!: ReturnType<typeof useToast>;
    renderWithProvider((a) => (api = a));

    let id!: string;
    act(() => {
      id = api.show({ id: "tx-1", tone: "pending", title: "Sending…" });
    });

    expect(screen.getByText("Sending…")).toBeInTheDocument();
    expect(id).toBe("tx-1");

    act(() => {
      api.update("tx-1", { tone: "success", title: "Done" });
    });

    // Only one toast on screen, with the new text.
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);

    // The auto-dismiss timer is now armed.
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  it("4. dismiss(id) removes the toast immediately (timer does not error after)", async () => {
    let api!: ReturnType<typeof useToast>;
    renderWithProvider((a) => (api = a));

    act(() => {
      api.show({ id: "tx-2", tone: "success", title: "Bye" });
    });

    expect(screen.getByText("Bye")).toBeInTheDocument();

    act(() => {
      api.dismiss("tx-2");
    });

    expect(screen.queryByText("Bye")).not.toBeInTheDocument();

    // Advancing past the timer must not throw.
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
    }).not.toThrow();
  });

  it("5. stack cap: showing 4 toasts drops the oldest", async () => {
    let api!: ReturnType<typeof useToast>;
    renderWithProvider((a) => (api = a));

    act(() => {
      api.show({ tone: "pending", title: "Toast A" });
      api.show({ tone: "pending", title: "Toast B" });
      api.show({ tone: "pending", title: "Toast C" });
      api.show({ tone: "pending", title: "Toast D" });
    });

    expect(screen.queryByText("Toast A")).not.toBeInTheDocument();
    expect(screen.getByText("Toast B")).toBeInTheDocument();
    expect(screen.getByText("Toast C")).toBeInTheDocument();
    expect(screen.getByText("Toast D")).toBeInTheDocument();
  });

  it("6. show({ id }) with an existing id upserts (no duplicate)", async () => {
    let api!: ReturnType<typeof useToast>;
    renderWithProvider((a) => (api = a));

    act(() => {
      api.show({ id: "tx-3", tone: "pending", title: "First" });
    });

    expect(screen.getByText("First")).toBeInTheDocument();

    act(() => {
      api.show({ id: "tx-3", tone: "success", title: "Second" });
    });

    // Only one toast; the first entry was replaced.
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    // Only one status/alert element in the DOM.
    const roles = [
      ...screen.queryAllByRole("status"),
      ...screen.queryAllByRole("alert"),
    ];
    expect(roles).toHaveLength(1);
  });

  it("7. useToast() outside <ToastProvider> throws a clear error", () => {
    // Silence React's error boundary logs.
    const consoleSpy: MockInstance = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    function BadComponent() {
      useToast(); // should throw
      return null;
    }

    expect(() => {
      render(<BadComponent />);
    }).toThrow(/ToastProvider/);

    consoleSpy.mockRestore();
  });
});
