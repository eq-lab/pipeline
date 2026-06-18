/**
 * ConnectModalProvider — unit tests.
 *
 * Covers:
 *   - `useConnectModal()` outside the provider returns a no-op (no throw).
 *   - `open()` renders the ConnectWalletModal (testid `connect-wallet-modal`).
 *   - `close()` / `onDismiss` removes the modal.
 *   - Multiple call sites share the single modal instance (no duplicates).
 *   - Gate ordering (issue #639): gate fires first when terms are absent;
 *     skipped when already acknowledged; dismissing gate does not open modal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook, act } from "@testing-library/react";
import { ConnectModalProvider } from "./ConnectModalProvider";
import { useConnectModal } from "./ConnectModalContext";
import { WalletGateProvider } from "./WalletGateProvider";

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

// ── Mock FirstConnectionModal ─────────────────────────────────────────────────
// Capture gate props so tests can trigger Continue / Dismiss without rendering
// the real modal UI (which has portal / DOM setup issues in unit tests).

let capturedGateProps: {
  open: boolean;
  onContinue: () => void;
  onDismiss: () => void;
} = { open: false, onContinue: () => {}, onDismiss: () => {} };

const mockGateContinue = vi.fn();
const mockGateDismiss = vi.fn();

vi.mock("../components/FirstConnectionModal", () => ({
  FirstConnectionModal: (props: {
    open: boolean;
    onContinue: () => void;
    onDismiss: () => void;
  }) => {
    capturedGateProps = props;
    mockGateContinue.mockImplementation(props.onContinue);
    mockGateDismiss.mockImplementation(props.onDismiss);
    return null;
  },
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

/** Wrapper that includes WalletGateProvider so ConnectModalProvider can call useWalletGate(). */
function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletGateProvider>
      <ConnectModalProvider>{children}</ConnectModalProvider>
    </WalletGateProvider>
  );
}

describe("ConnectModalProvider — open / close (terms pre-acknowledged)", () => {
  beforeEach(() => {
    localStorage.clear();
    // Pre-acknowledge terms so gate is skipped — these tests exercise open/close only.
    localStorage.setItem("pipeline.wallet.termsAcknowledged", "true");
    capturedGateProps = { open: false, onContinue: () => {}, onDismiss: () => {} };
    mockGateContinue.mockClear();
    mockGateDismiss.mockClear();
  });

  it("modal is absent initially", () => {
    render(
      <Providers>
        <ConsumerButton />
      </Providers>,
    );
    expect(
      screen.queryByTestId("connect-wallet-modal"),
    ).not.toBeInTheDocument();
  });

  it("open() renders ConnectWalletModal (testid connect-wallet-modal)", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <ConsumerButton />
      </Providers>,
    );

    await user.click(screen.getByRole("button", { name: "Open Modal" }));

    await waitFor(() => {
      expect(screen.getByTestId("connect-wallet-modal")).toBeInTheDocument();
    });
  });

  it("onDismiss (Close button inside modal) removes the modal", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <ConsumerButton />
      </Providers>,
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
      <Providers>
        <ConsumerButton />
        <CloseButton />
      </Providers>,
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
      <Providers>
        <TwoButtons />
      </Providers>,
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

// ── Tests: gate ordering (issue #639) ─────────────────────────────────────────

describe("ConnectModalProvider — gate ordering (issue #639)", () => {
  beforeEach(() => {
    localStorage.clear();
    capturedGateProps = { open: false, onContinue: () => {}, onDismiss: () => {} };
    mockGateContinue.mockClear();
    mockGateDismiss.mockClear();
  });

  it("gate fires first when terms not acknowledged: modal does not open", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <ConsumerButton />
      </Providers>,
    );

    await user.click(screen.getByRole("button", { name: "Open Modal" }));

    // Gate opened; ConnectWalletModal not yet visible.
    expect(capturedGateProps.open).toBe(true);
    expect(
      screen.queryByTestId("connect-wallet-modal"),
    ).not.toBeInTheDocument();
  });

  it("after Continue on gate, ConnectWalletModal opens", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <ConsumerButton />
      </Providers>,
    );

    await user.click(screen.getByRole("button", { name: "Open Modal" }));
    expect(capturedGateProps.open).toBe(true);

    // Simulate user clicking Continue on the gate.
    act(() => mockGateContinue());

    await waitFor(() => {
      expect(screen.getByTestId("connect-wallet-modal")).toBeInTheDocument();
    });
    // Gate is now closed.
    expect(capturedGateProps.open).toBe(false);
    // Ack flag has been written.
    expect(localStorage.getItem("pipeline.wallet.termsAcknowledged")).toBe("true");
  });

  it("dismissing gate does NOT open ConnectWalletModal", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <ConsumerButton />
      </Providers>,
    );

    await user.click(screen.getByRole("button", { name: "Open Modal" }));
    expect(capturedGateProps.open).toBe(true);

    // Simulate user dismissing the gate.
    act(() => mockGateDismiss());

    // Gate closed; modal still not rendered.
    expect(capturedGateProps.open).toBe(false);
    expect(
      screen.queryByTestId("connect-wallet-modal"),
    ).not.toBeInTheDocument();
  });

  it("gate skipped when terms already acknowledged: modal opens immediately", async () => {
    localStorage.setItem("pipeline.wallet.termsAcknowledged", "true");
    const user = userEvent.setup();
    render(
      <Providers>
        <ConsumerButton />
      </Providers>,
    );

    await user.click(screen.getByRole("button", { name: "Open Modal" }));

    // Gate was never opened; modal appeared directly.
    expect(capturedGateProps.open).toBe(false);
    await waitFor(() => {
      expect(screen.getByTestId("connect-wallet-modal")).toBeInTheDocument();
    });
  });
});

// ── Tests: renderHook inside provider ─────────────────────────────────────────

describe("ConnectModalProvider — renderHook integration", () => {
  beforeEach(() => {
    localStorage.clear();
    // Pre-acknowledge so open() call in stability test doesn't open the gate.
    localStorage.setItem("pipeline.wallet.termsAcknowledged", "true");
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <WalletGateProvider>
        <ConnectModalProvider>{children}</ConnectModalProvider>
      </WalletGateProvider>
    );
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
