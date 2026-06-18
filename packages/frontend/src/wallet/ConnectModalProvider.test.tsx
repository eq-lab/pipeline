/**
 * ConnectModalProvider — unit tests.
 *
 * Covers:
 *   - `useConnectModal()` outside the provider returns a no-op (no throw).
 *   - `open()` renders the ConnectWalletModal (testid `connect-wallet-modal`).
 *   - `close()` / `onDismiss` removes the modal.
 *   - Multiple call sites share the single modal instance (no duplicates).
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook, act } from "@testing-library/react";
import { ConnectModalProvider } from "./ConnectModalProvider";
import { useConnectModal } from "./ConnectModalContext";

// ── Mock ConnectWalletModal ──────────────────────────────────────────────────
// Avoid pulling in the full ConnectWalletModal rendering machinery (wagmi, appkit,
// stellar kit, createPortal, etc.) in the unit test environment.
vi.mock("../components/ConnectWalletModal", () => ({
  ConnectWalletModal: ({
    open,
    onDismiss,
  }: {
    open: boolean;
    onDismiss: () => void;
  }) =>
    open ? (
      <div
        role="dialog"
        aria-label="Connect Wallet"
        data-testid="connect-wallet-modal"
      >
        <button onClick={onDismiss}>Close</button>
      </div>
    ) : null,
}));

// ── Tests: no-op outside provider ────────────────────────────────────────────

describe("useConnectModal — outside provider (safe default)", () => {
  it("returns { open, close } without throwing", () => {
    const { result } = renderHook(() => useConnectModal());
    expect(typeof result.current.open).toBe("function");
    expect(typeof result.current.close).toBe("function");
  });

  it("calling open() and close() outside provider does not throw", () => {
    const { result } = renderHook(() => useConnectModal());
    expect(() => result.current.open()).not.toThrow();
    expect(() => result.current.close()).not.toThrow();
  });
});

// ── Tests: ConnectModalProvider ───────────────────────────────────────────────

function ConsumerButton() {
  const { open } = useConnectModal();
  return <button onClick={open}>Open Modal</button>;
}

function CloseButton() {
  const { close } = useConnectModal();
  return <button onClick={close}>Close Modal Via Context</button>;
}

describe("ConnectModalProvider — open / close", () => {
  it("modal is absent initially", () => {
    render(
      <ConnectModalProvider>
        <ConsumerButton />
      </ConnectModalProvider>,
    );
    expect(
      screen.queryByTestId("connect-wallet-modal"),
    ).not.toBeInTheDocument();
  });

  it("open() renders ConnectWalletModal (testid connect-wallet-modal)", async () => {
    const user = userEvent.setup();
    render(
      <ConnectModalProvider>
        <ConsumerButton />
      </ConnectModalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open Modal" }));

    await waitFor(() => {
      expect(screen.getByTestId("connect-wallet-modal")).toBeInTheDocument();
    });
  });

  it("onDismiss (Close button inside modal) removes the modal", async () => {
    const user = userEvent.setup();
    render(
      <ConnectModalProvider>
        <ConsumerButton />
      </ConnectModalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open Modal" }));
    await screen.findByTestId("connect-wallet-modal");

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(
        screen.queryByTestId("connect-wallet-modal"),
      ).not.toBeInTheDocument();
    });
  });

  it("close() via context removes the modal", async () => {
    const user = userEvent.setup();
    render(
      <ConnectModalProvider>
        <ConsumerButton />
        <CloseButton />
      </ConnectModalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open Modal" }));
    await screen.findByTestId("connect-wallet-modal");

    await user.click(
      screen.getByRole("button", { name: "Close Modal Via Context" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId("connect-wallet-modal"),
      ).not.toBeInTheDocument();
    });
  });

  it("multiple call sites share one modal instance (no duplicates)", async () => {
    const user = userEvent.setup();

    function TwoButtons() {
      const { open } = useConnectModal();
      return (
        <>
          <button onClick={open}>Open A</button>
          <button onClick={open}>Open B</button>
        </>
      );
    }

    render(
      <ConnectModalProvider>
        <TwoButtons />
      </ConnectModalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open A" }));
    await screen.findByTestId("connect-wallet-modal");

    // Clicking the second button while modal is open should not create a second modal.
    await user.click(screen.getByRole("button", { name: "Open B" }));

    await waitFor(() => {
      const modals = screen.queryAllByTestId("connect-wallet-modal");
      expect(modals).toHaveLength(1);
    });
  });
});

// ── Tests: renderHook inside provider ─────────────────────────────────────────

describe("ConnectModalProvider — renderHook integration", () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    return <ConnectModalProvider>{children}</ConnectModalProvider>;
  }

  it("open() and close() are stable references (useCallback)", () => {
    const { result } = renderHook(() => useConnectModal(), { wrapper });
    const { open: open1, close: close1 } = result.current;

    // Call open to potentially re-render; refs should still be stable.
    act(() => {
      result.current.open();
    });
    act(() => {
      result.current.close();
    });

    expect(result.current.open).toBe(open1);
    expect(result.current.close).toBe(close1);
  });
});
