// spec: docs/frontend/auth-components.md#authflowprovider
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiError } from "@/api";
import type { LpResponse } from "@/api";
import { ToastContext, type ToastApi } from "@/lib/toast/useToast";
import { clearSession, saveSession } from "./session";
import { useSettlementAddressLink } from "./useSettlementAddressLink";

const A = "GA2OA4PKOQKVIOUZFNHMKBMQCCUZRMGRTFZ7LKOZHCCPCBXHN5RNH7YK";
const B = "GBBM6BKZPEHWYO3E3YKREDPQXMS4VK35YLNU7NFBRI26RAN7GI5POFBB";
const C = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

const mockLink = vi.fn();
const mockGet = vi.fn();
const wallet = vi.hoisted(() => ({
  value: { address: undefined, isConnected: false } as {
    address: string | undefined;
    isConnected: boolean;
  },
}));

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    linkMyAddress: (...args: unknown[]) => mockLink(...args),
    getMyLp: (...args: unknown[]) => mockGet(...args),
  };
});
vi.mock("@/wallet", () => ({ useStellarWallet: () => wallet.value }));

function lp(overrides: Partial<LpResponse> = {}): LpResponse {
  return {
    id: 1,
    legal_name: "Acme",
    country: "NL",
    contact_email: "a@example.com",
    stellar_address: null,
    address_linked_at: null,
    kyb_status: "NotStarted",
    writable: true,
    notify_on_review: false,
    owner_account_id: "acc",
    owner_chain_id: null,
    owner_address: null,
    created_at: "2026-10-30",
    documents: [],
    ...overrides,
  };
}

const show = vi.fn();
const toast = { show, update: vi.fn(), dismiss: vi.fn() } as ToastApi;

interface Props {
  token: string | undefined;
  lp: LpResponse | null;
  lpLoaded: boolean;
}

function setup(initial: Props, strict = false) {
  const onLp = vi.fn();
  const hook = renderHook(
    (props: Props) => useSettlementAddressLink({ ...props, onLp }),
    {
      initialProps: initial,
      wrapper: ({ children }) => {
        const tree = (
          <ToastContext.Provider value={toast}>
            {children}
          </ToastContext.Provider>
        );
        return strict ? <StrictMode>{tree}</StrictMode> : tree;
      },
    },
  );
  return { onLp, ...hook };
}

function connect(address: string | undefined) {
  wallet.value = { address, isConnected: address !== undefined };
}

beforeEach(() => {
  clearSession();
  saveSession({ token: "t", expires_in: 3600, email: "a@example.com" });
  mockLink
    .mockReset()
    .mockImplementation(async (address: string) =>
      lp({ stellar_address: address }),
    );
  mockGet.mockReset();
  show.mockReset();
  connect(undefined);
});

const loaded = (overrides: Partial<LpResponse> = {}): Props => ({
  token: "t",
  lp: lp(overrides),
  lpLoaded: true,
});

describe("useSettlementAddressLink", () => {
  it("links the connected wallet once and adopts the response", async () => {
    connect(A);
    const { onLp } = setup(loaded());
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    expect(mockLink).toHaveBeenCalledOnce();
    expect(mockLink).toHaveBeenCalledWith(A);
    expect(onLp.mock.calls[0]?.[0].stellar_address).toBe(A);
  });

  it("does not call when the served address already matches", async () => {
    connect(A);
    setup(loaded({ stellar_address: A }));
    await act(async () => {});
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("calls for an UnderReview LP whose served address differs", async () => {
    connect(A);
    setup(loaded({ kyb_status: "UnderReview", stellar_address: B }));
    await waitFor(() => expect(mockLink).toHaveBeenCalledWith(A));
  });

  it("makes no request once Passed with an address, or Failed", async () => {
    connect(A);
    setup(loaded({ kyb_status: "Passed", stellar_address: B }));
    setup(loaded({ kyb_status: "Failed" }));
    await act(async () => {});
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("links a Passed LP that has no address yet", async () => {
    connect(A);
    setup(loaded({ kyb_status: "Passed" }));
    await waitFor(() => expect(mockLink).toHaveBeenCalledWith(A));
  });

  it("waits for the LP read and links when it loads", async () => {
    connect(A);
    const { rerender } = setup({ token: "t", lp: null, lpLoaded: false });
    await act(async () => {});
    expect(mockLink).not.toHaveBeenCalled();
    rerender(loaded());
    await waitFor(() => expect(mockLink).toHaveBeenCalledOnce());
  });

  it("does nothing without a token or a connected Stellar wallet", async () => {
    setup(loaded());
    connect(A);
    setup({ ...loaded(), token: undefined });
    await act(async () => {});
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("serializes A then C when the wallet changes while A is pending", async () => {
    connect(A);
    let release!: () => void;
    mockLink.mockImplementationOnce(
      (address: string) =>
        new Promise((resolve) => {
          release = () => resolve(lp({ stellar_address: address }));
        }),
    );
    const { onLp, rerender } = setup(loaded());
    await waitFor(() => expect(mockLink).toHaveBeenCalledWith(A));
    connect(C);
    rerender(loaded());
    await act(async () => {});
    expect(mockLink).toHaveBeenCalledOnce();
    await act(async () => release());
    await waitFor(() => expect(mockLink).toHaveBeenCalledTimes(2));
    expect(mockLink.mock.calls[1]?.[0]).toBe(C);
    await waitFor(() => expect(onLp).toHaveBeenCalledTimes(2));
    expect(onLp.mock.calls[1]?.[0].stellar_address).toBe(C);
  });

  it("shows the served message on 409, re-reads the LP and reports taken", async () => {
    connect(A);
    mockLink.mockRejectedValueOnce(
      new ApiError(409, "address already linked to another account"),
    );
    mockGet.mockResolvedValueOnce(lp());
    const { result, onLp } = setup(loaded());
    await waitFor(() => expect(result.current).toBe("taken"));
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "danger",
        title: "address already linked to another account",
      }),
    );
    expect(mockGet).toHaveBeenCalledOnce();
    expect(onLp).toHaveBeenCalledOnce();
    expect(mockLink).toHaveBeenCalledOnce();
  });

  it("409 for a Passed LP re-reads and goes idle", async () => {
    connect(A);
    mockLink.mockRejectedValueOnce(
      new ApiError(409, "LP 1 has passed KYB; its settlement address is fixed"),
    );
    mockGet.mockResolvedValueOnce(
      lp({ kyb_status: "Passed", stellar_address: B }),
    );
    const { result, onLp } = setup(loaded());
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current).toBe("idle"));
    expect(show).toHaveBeenCalledOnce();
  });

  it("a network error reports error, does not retry the same key, and a new address retries", async () => {
    connect(A);
    mockLink.mockRejectedValueOnce(new Error("offline"));
    const { result, rerender } = setup(loaded());
    await waitFor(() => expect(result.current).toBe("error"));
    expect(show).toHaveBeenCalledOnce();
    rerender(loaded());
    await act(async () => {});
    expect(mockLink).toHaveBeenCalledOnce();
    connect(C);
    rerender(loaded());
    await waitFor(() => expect(mockLink).toHaveBeenCalledTimes(2));
  });

  it("drops a late response after the session token changed", async () => {
    connect(A);
    let release!: () => void;
    mockLink.mockImplementationOnce(
      (address: string) =>
        new Promise((resolve) => {
          release = () => resolve(lp({ stellar_address: address }));
        }),
    );
    const { onLp } = setup(loaded());
    await waitFor(() => expect(mockLink).toHaveBeenCalledOnce());
    saveSession({ token: "other", expires_in: 3600, email: "a@example.com" });
    await act(async () => release());
    expect(onLp).not.toHaveBeenCalled();
  });

  it("posts once under StrictMode", async () => {
    connect(A);
    const { onLp } = setup(loaded(), true);
    await waitFor(() => expect(onLp).toHaveBeenCalled());
    expect(mockLink).toHaveBeenCalledOnce();
  });
});
