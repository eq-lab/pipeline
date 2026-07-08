/**
 * ConnectModalProvider — unit tests.
 *
 * Ported from `packages/frontend/src/wallet/ConnectModalProvider.test.tsx`
 * (#791 shared-slice extraction) and trimmed to this package's decoupled gate
 * contract (see `./WalletGateContext.ts`): with no `WalletGateContext.Provider`
 * mounted, `open()` proceeds directly to the modal (no-op gate). A separate
 * describe block proves an injected gate (mounting the context directly, the
 * way the LP app's `WalletGateProvider` would) still intercepts `open()` —
 * this is the decoupling the #791 exec plan calls for.
 *
 * Covers:
 *   - `useConnectModal()` outside the provider returns a no-op (no throw).
 *   - `open()` renders the ConnectWalletModal (testid `connect-wallet-modal`).
 *   - `close()` / `onDismiss` removes the modal.
 *   - Multiple call sites share the single modal instance (no duplicates).
 *   - Injecting a `WalletGateContext.Provider` intercepts `open()` (decoupling proof).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook, act } from "@testing-library/react";
import { ConnectModalProvider } from "./ConnectModalProvider";
import { useConnectModal } from "./ConnectModalContext";
import { WalletGateContext } from "./WalletGateContext";

// ── Mock ConnectWalletModal ──────────────────────────────────────────────────
// Avoid pulling in the full ConnectWalletModal rendering machinery (wagmi, appkit,
// stellar kit, createPortal, etc.) in the unit test environment.
vi.mock("./ConnectWalletModal", () => ({
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

// ── Tests: ConnectModalProvider (no gate mounted — Trustee-style) ────────────

function ConsumerButton() {
  const { open } = useConnectModal();
  return <button onClick={open}>Open Modal</button>;
}

function CloseButton() {
  const { close } = useConnectModal();
  return <button onClick={close}>Close Modal Via Context</button>;
}

describe("ConnectModalProvider — open / close (no gate mounted)", () => {
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

  it("open() renders ConnectWalletModal directly — no gate to pass through", async () => {
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

    await user.click(screen.getByRole("button", { name: "Open B" }));

    await waitFor(() => {
      const modals = screen.queryAllByTestId("connect-wallet-modal");
      expect(modals).toHaveLength(1);
    });
  });
});

// ── Tests: injected gate (decoupling proof) ──────────────────────────────────

describe("ConnectModalProvider — injected WalletGateContext intercepts open()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a mounted gate provider is consulted before the modal opens", async () => {
    const openGate = vi.fn();
    const user = userEvent.setup();

    render(
      <WalletGateContext.Provider value={{ openGate }}>
        <ConnectModalProvider>
          <ConsumerButton />
        </ConnectModalProvider>
      </WalletGateContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Open Modal" }));

    // The injected gate was called instead of opening the modal directly.
    expect(openGate).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("connect-wallet-modal"),
    ).not.toBeInTheDocument();
  });

  it("the modal opens once the injected gate invokes onProceed", async () => {
    let capturedOnProceed: (() => void) | undefined;
    const openGate = vi.fn((onProceed: () => void) => {
      capturedOnProceed = onProceed;
    });
    const user = userEvent.setup();

    render(
      <WalletGateContext.Provider value={{ openGate }}>
        <ConnectModalProvider>
          <ConsumerButton />
        </ConnectModalProvider>
      </WalletGateContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Open Modal" }));
    expect(capturedOnProceed).toBeDefined();

    act(() => capturedOnProceed!());

    await waitFor(() => {
      expect(screen.getByTestId("connect-wallet-modal")).toBeInTheDocument();
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
