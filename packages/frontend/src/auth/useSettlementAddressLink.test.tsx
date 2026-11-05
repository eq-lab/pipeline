// spec: docs/frontend/account-page.md#settlement-address
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiError } from "@/api";
import type { LpResponse } from "@/api";
import { ENV } from "@/lib/env";
import { ToastContext, type ToastApi } from "@/lib/toast/useToast";
import { clearSession, saveSession } from "./session";
import { useSettlementAddressLink } from "./useSettlementAddressLink";

const A = "GA2OA4PKOQKVIOUZFNHMKBMQCCUZRMGRTFZ7LKOZHCCPCBXHN5RNH7YK";
const B = "GBBM6BKZPEHWYO3E3YKREDPQXMS4VK35YLNU7NFBRI26RAN7GI5POFBB";
const E1 = "0xAbC0000000000000000000000000000000000001";
const E2 = "0xdef0000000000000000000000000000000000002";
const G2 = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";
const CONTRACT = "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR";

const mockChallenge = vi.fn();
const mockVerify = vi.fn();
const mockGet = vi.fn();
const mockStellarSign = vi.fn();
const mockEvmSign = vi.fn();
const wallets = vi.hoisted(() => ({
  stellar: { address: undefined, isConnected: false } as {
    address: string | undefined;
    isConnected: boolean;
  },
  evm: { address: undefined, isConnected: false } as {
    address: string | undefined;
    isConnected: boolean;
  },
}));

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    getLinkAddressChallenge: (...args: unknown[]) => mockChallenge(...args),
    verifyLinkAddress: (...args: unknown[]) => mockVerify(...args),
    getMyLp: (...args: unknown[]) => mockGet(...args),
  };
});
vi.mock("@/wallet", async () => ({
  isStellarSettlementAddress: (
    await vi.importActual<
      typeof import("@/wallet/stellar/settlementAddressFormat")
    >("@/wallet/stellar/settlementAddressFormat")
  ).isStellarSettlementAddress,
  useStellarWallet: () => ({
    ...wallets.stellar,
    signMessage: (...args: unknown[]) => mockStellarSign(...args),
  }),
  useEvmWallet: () => ({ ...wallets.evm }),
  useEvmSignMessage: () => ({
    signMessage: (...args: unknown[]) => mockEvmSign(...args),
  }),
}));

function lp(overrides: Partial<LpResponse> = {}): LpResponse {
  return {
    id: 1,
    legal_name: "Acme",
    country: "NL",
    contact_email: "a@example.com",
    stellar_address: null,
    address_linked_at: null,
    stellar_signer_address: null,
    evm_address: null,
    evm_signer_address: null,
    evm_address_linked_at: null,
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

function connectStellar(address: string | undefined) {
  wallets.stellar = { address, isConnected: address !== undefined };
}

function connectEvm(address: string | undefined) {
  wallets.evm = { address, isConnected: address !== undefined };
}

beforeEach(() => {
  clearSession();
  saveSession({ token: "t", expires_in: 3600, email: "a@example.com" });
  mockChallenge
    .mockReset()
    .mockResolvedValue({ message: "msg-1", nonce: "n1" });
  mockStellarSign.mockReset().mockResolvedValue({ signature: "sig-s" });
  mockEvmSign.mockReset().mockResolvedValue({ signature: "0xsig" });
  mockVerify
    .mockReset()
    .mockImplementation(async (body: { address: string; chain_id: number }) =>
      body.chain_id === ENV.EVM_CHAIN_ID
        ? lp({ evm_address: body.address, evm_signer_address: body.address })
        : lp({
            stellar_address: body.address,
            stellar_signer_address: body.address,
          }),
    );
  mockGet.mockReset();
  show.mockReset();
  connectStellar(undefined);
  connectEvm(undefined);
});

const loaded = (overrides: Partial<LpResponse> = {}): Props => ({
  token: "t",
  lp: lp(overrides),
  lpLoaded: true,
});

const phaseOf = (result: { current: { state: { phase: string } } }) =>
  result.current.state.phase;

describe("useSettlementAddressLink", () => {
  it("makes no challenge, signature or verify call on its own, even under StrictMode", async () => {
    connectStellar(A);
    setup(loaded(), true);
    connectStellar(undefined);
    connectEvm(E1);
    setup(loaded(), true);
    await act(async () => {});
    expect(mockChallenge).not.toHaveBeenCalled();
    expect(mockStellarSign).not.toHaveBeenCalled();
    expect(mockEvmSign).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("links a Stellar wallet: challenge, sign, verify without signer_address, adopt", async () => {
    connectStellar(A);
    let releaseSign!: () => void;
    let releaseVerify!: () => void;
    mockStellarSign.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSign = () => resolve({ signature: "sig-s" });
        }),
    );
    mockVerify.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseVerify = () =>
            resolve(lp({ stellar_address: A, stellar_signer_address: A }));
        }),
    );
    const { result, onLp } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(phaseOf(result)).toBe("signing"));
    expect(mockChallenge).toHaveBeenCalledWith(ENV.STELLAR_CHAIN_ID, A, null);
    expect(mockStellarSign).toHaveBeenCalledWith("msg-1", A);
    await act(async () => releaseSign());
    await waitFor(() => expect(phaseOf(result)).toBe("verifying"));
    expect(mockVerify).toHaveBeenCalledWith({
      chain_id: ENV.STELLAR_CHAIN_ID,
      address: A,
      signature: "sig-s",
    });
    expect(Object.keys(mockVerify.mock.calls[0]?.[0])).not.toContain(
      "signer_address",
    );
    await act(async () => releaseVerify());
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    await waitFor(() => expect(phaseOf(result)).toBe("idle"));
  });

  it("links an EVM wallet with the address lowercased", async () => {
    connectEvm(E1);
    const { result, onLp } = setup(loaded());
    act(() => result.current.link("evm"));
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    expect(mockChallenge).toHaveBeenCalledWith(
      ENV.EVM_CHAIN_ID,
      E1.toLowerCase(),
      null,
    );
    expect(mockEvmSign).toHaveBeenCalledWith("msg-1", E1);
    expect(mockStellarSign).not.toHaveBeenCalled();
    expect(mockVerify).toHaveBeenCalledWith({
      chain_id: ENV.EVM_CHAIN_ID,
      address: E1.toLowerCase(),
      signature: "0xsig",
    });
  });

  it("lets a Passed LP link, prove an unproven address and change, but refuses Failed", async () => {
    connectStellar(A);
    const passed = setup(loaded({ kyb_status: "Passed" }));
    act(() => passed.result.current.link("stellar"));
    await waitFor(() => expect(passed.onLp).toHaveBeenCalledOnce());

    const unproven = setup(
      loaded({ kyb_status: "Passed", stellar_address: A }),
    );
    act(() => unproven.result.current.link("stellar"));
    await waitFor(() => expect(unproven.onLp).toHaveBeenCalledOnce());

    const change = setup(loaded({ kyb_status: "Passed", stellar_address: B }));
    act(() => change.result.current.beginChange("stellar"));
    expect(change.result.current.state).toEqual({
      kind: "stellar",
      phase: "confirming",
      mode: "wallet",
    });

    mockChallenge.mockClear();
    const failed = setup(loaded({ kyb_status: "Failed" }));
    act(() => failed.result.current.link("stellar"));
    act(() => failed.result.current.beginChange("stellar"));
    await act(async () => {});
    expect(mockChallenge).not.toHaveBeenCalled();
    expect(phaseOf(failed.result)).toBe("idle");
  });

  it("asks for a confirmation before a change, with no request, and signs only after confirming", async () => {
    connectStellar(B);
    const { result, onLp } = setup(loaded({ stellar_address: A }));
    act(() => result.current.beginChange("stellar"));
    expect(result.current.state).toEqual({
      kind: "stellar",
      phase: "confirming",
      mode: "wallet",
    });
    expect(mockChallenge).not.toHaveBeenCalled();
    act(() => result.current.cancelChange());
    expect(phaseOf(result)).toBe("idle");
    expect(mockChallenge).not.toHaveBeenCalled();

    act(() => result.current.beginChange("stellar"));
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    expect(mockChallenge).toHaveBeenCalledWith(ENV.STELLAR_CHAIN_ID, B, null);
  });

  it("beginChange is a no-op for a matching or other-kind wallet", () => {
    connectStellar(A);
    const same = setup(
      loaded({ stellar_address: A, stellar_signer_address: A }),
    );
    act(() => same.result.current.beginChange("stellar"));
    expect(phaseOf(same.result)).toBe("idle");
    const other = setup(loaded({ evm_address: E2 }));
    act(() => other.result.current.beginChange("evm"));
    expect(phaseOf(other.result)).toBe("idle");
  });

  it("reports declined without verify or toast when the wallet rejects, and a new link asks for a new challenge", async () => {
    connectStellar(A);
    mockStellarSign.mockRejectedValueOnce(new Error("User declined"));
    const { result, onLp } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(phaseOf(result)).toBe("declined"));
    expect(mockVerify).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    expect(mockChallenge).toHaveBeenCalledTimes(2);
  });

  it("422 reports proofFailed without a toast and the retry signs a new challenge", async () => {
    connectStellar(A);
    mockVerify.mockRejectedValueOnce(new ApiError(422, "bad signature"));
    mockChallenge
      .mockResolvedValueOnce({ message: "msg-1", nonce: "n1" })
      .mockResolvedValueOnce({ message: "msg-2", nonce: "n2" });
    const { result, onLp } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(phaseOf(result)).toBe("proofFailed"));
    expect(show).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    expect(mockChallenge).toHaveBeenCalledTimes(2);
    expect(mockStellarSign).toHaveBeenLastCalledWith("msg-2", A);
    expect(phaseOf(result)).toBe("idle");
  });

  it("409 on verify toasts the served message, re-reads the LP and reports taken", async () => {
    connectStellar(A);
    mockVerify.mockRejectedValueOnce(
      new ApiError(409, "address already linked to another account"),
    );
    mockGet.mockResolvedValueOnce(lp());
    const { result, onLp } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(phaseOf(result)).toBe("taken"));
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "danger",
        title: "address already linked to another account",
      }),
    );
    expect(mockGet).toHaveBeenCalledOnce();
    expect(onLp).toHaveBeenCalledOnce();
  });

  it("409 for a refreshed Failed LP goes idle", async () => {
    connectStellar(A);
    mockVerify.mockRejectedValueOnce(new ApiError(409, "taken"));
    mockGet.mockResolvedValueOnce(lp({ kyb_status: "Failed" }));
    const { result, onLp } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    await waitFor(() => expect(phaseOf(result)).toBe("idle"));
  });

  it("409 on the challenge behaves the same and never asks the wallet to sign", async () => {
    connectStellar(A);
    mockChallenge.mockReset().mockRejectedValueOnce(new ApiError(409, "taken"));
    mockGet.mockResolvedValueOnce(lp());
    const { result } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(phaseOf(result)).toBe("taken"));
    expect(mockStellarSign).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledOnce();
  });

  it("other errors toast and report error, and the next link makes a new challenge", async () => {
    connectStellar(A);
    mockVerify.mockRejectedValueOnce(new ApiError(500, "boom"));
    const { result, onLp } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(phaseOf(result)).toBe("error"));
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "boom" }),
    );
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    expect(mockChallenge).toHaveBeenCalledTimes(2);
  });

  it("a network error shows the fallback toast text", async () => {
    connectStellar(A);
    mockChallenge.mockReset().mockRejectedValueOnce(new TypeError("offline"));
    const { result } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(phaseOf(result)).toBe("error"));
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Your wallet could not be linked." }),
    );
  });

  it("a double click makes one challenge call", async () => {
    connectStellar(A);
    const { result, onLp } = setup(loaded());
    act(() => {
      result.current.link("stellar");
      result.current.link("stellar");
    });
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    expect(mockChallenge).toHaveBeenCalledOnce();
  });

  it("link is a no-op without a token, an LP, a connected wallet of the kind or a proven match", async () => {
    connectStellar(A);
    const noToken = setup({ ...loaded(), token: undefined });
    act(() => noToken.result.current.link("stellar"));
    const noLp = setup({ token: "t", lp: null, lpLoaded: false });
    act(() => noLp.result.current.link("stellar"));
    const wrongKind = setup(loaded());
    act(() => wrongKind.result.current.link("evm"));
    const proven = setup(
      loaded({ stellar_address: A, stellar_signer_address: A }),
    );
    act(() => proven.result.current.link("stellar"));
    await act(async () => {});
    expect(mockChallenge).not.toHaveBeenCalled();
  });

  it("drops the response after the session token changed", async () => {
    connectStellar(A);
    let release!: () => void;
    mockVerify.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(lp({ stellar_address: A }));
        }),
    );
    const { result, onLp } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(mockVerify).toHaveBeenCalledOnce());
    saveSession({ token: "other", expires_in: 3600, email: "a@example.com" });
    await act(async () => release());
    expect(onLp).not.toHaveBeenCalled();
    await waitFor(() => expect(phaseOf(result)).toBe("idle"));
  });

  it("passes the challenged address to signMessage for both kinds", async () => {
    connectStellar(A);
    const { result, rerender } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(mockVerify).toHaveBeenCalledOnce());
    expect(mockStellarSign).toHaveBeenCalledWith("msg-1", A);
    connectStellar(undefined);
    connectEvm(E1);
    rerender(loaded());
    act(() => result.current.link("evm"));
    await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(2));
    expect(mockEvmSign).toHaveBeenCalledWith("msg-1", E1);
  });

  it("a wallet switched mid-flight goes idle: no verify, no caption for the new wallet", async () => {
    connectStellar(A);
    let resolveSign: (v: { signature: string }) => void = () => {};
    mockStellarSign
      .mockReset()
      .mockImplementation(() => new Promise((r) => (resolveSign = r)));
    const { result, rerender } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(phaseOf(result)).toBe("signing"));
    connectStellar(B);
    rerender(loaded());
    await act(async () => resolveSign({ signature: "sig-s" }));
    await waitFor(() => expect(phaseOf(result)).toBe("idle"));
    expect(mockVerify).not.toHaveBeenCalled();
    expect(result.current.connected).toEqual({ kind: "stellar", address: B });
  });

  it("a generic verify failure re-reads the LP best-effort before reporting error", async () => {
    connectStellar(A);
    mockVerify.mockRejectedValueOnce(new ApiError(500, "boom"));
    const committed = lp({ stellar_address: A, stellar_signer_address: A });
    mockGet.mockResolvedValueOnce(committed);
    const { result, onLp } = setup(loaded());
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(phaseOf(result)).toBe("error"));
    expect(mockGet).toHaveBeenCalledOnce();
    expect(onLp).toHaveBeenCalledWith(committed);
    mockVerify.mockRejectedValueOnce(new TypeError("offline"));
    mockGet.mockRejectedValueOnce(new TypeError("offline"));
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(phaseOf(result)).toBe("error"));
  });

  it("resets declined, proofFailed and confirming when the connected address changes", async () => {
    connectStellar(B);
    const { result, rerender } = setup(loaded({ stellar_address: A }));
    act(() => result.current.beginChange("stellar"));
    expect(phaseOf(result)).toBe("confirming");
    connectStellar(A);
    rerender(loaded({ stellar_address: A }));
    await waitFor(() => expect(phaseOf(result)).toBe("idle"));

    connectStellar(B);
    mockStellarSign.mockRejectedValueOnce(new Error("no"));
    rerender(loaded({ stellar_address: A }));
    act(() => result.current.link("stellar"));
    await waitFor(() => expect(phaseOf(result)).toBe("declined"));
    connectStellar(undefined);
    rerender(loaded({ stellar_address: A }));
    await waitFor(() => expect(phaseOf(result)).toBe("idle"));
  });
});

describe("useSettlementAddressLink: use a different address", () => {
  it("links a C… address with the connected G… wallet as the signer", async () => {
    connectStellar(A);
    const { result, onLp } = setup(loaded());
    act(() => result.current.beginOther("stellar"));
    expect(result.current.state).toEqual({
      kind: "stellar",
      phase: "editing",
      mode: "other",
    });
    act(() =>
      result.current.linkOther("stellar", `  ${CONTRACT.toLowerCase()} `),
    );
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    expect(mockChallenge).toHaveBeenCalledWith(
      ENV.STELLAR_CHAIN_ID,
      CONTRACT,
      A,
    );
    expect(mockStellarSign).toHaveBeenCalledWith("msg-1", A);
    expect(mockVerify).toHaveBeenCalledWith({
      chain_id: ENV.STELLAR_CHAIN_ID,
      address: CONTRACT,
      signer_address: A,
      signature: "sig-s",
    });
    expect(phaseOf(result)).toBe("idle");
    expect(result.current.state.mode).toBe("wallet");
  });

  it("links a G… address with the connected wallet as the signer", async () => {
    connectStellar(A);
    const { result, onLp } = setup(loaded());
    act(() => result.current.beginOther("stellar"));
    act(() => result.current.linkOther("stellar", G2));
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    expect(mockVerify.mock.calls[0]?.[0]).toMatchObject({
      address: G2,
      signer_address: A,
    });
  });

  it("links a typed EVM address as typed with the lowercased connected EOA as signer", async () => {
    connectEvm(E1);
    const { result, onLp } = setup(loaded());
    act(() => result.current.beginOther("evm"));
    act(() =>
      result.current.linkOther("evm", `  ${E2.replace("def", "DeF")} `),
    );
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    const typed = E2.replace("def", "DeF");
    expect(mockChallenge).toHaveBeenCalledWith(
      ENV.EVM_CHAIN_ID,
      typed,
      E1.toLowerCase(),
    );
    expect(mockEvmSign).toHaveBeenCalledWith("msg-1", E1);
    expect(mockVerify).toHaveBeenCalledWith({
      chain_id: ENV.EVM_CHAIN_ID,
      address: typed,
      signer_address: E1.toLowerCase(),
      signature: "0xsig",
    });
  });

  it("typing the connected wallet address sends no signer_address", async () => {
    connectEvm(E1);
    const evmHook = setup(loaded());
    act(() => evmHook.result.current.beginOther("evm"));
    act(() => evmHook.result.current.linkOther("evm", E1.toLowerCase()));
    await waitFor(() => expect(evmHook.onLp).toHaveBeenCalledOnce());
    expect(mockChallenge).toHaveBeenLastCalledWith(
      ENV.EVM_CHAIN_ID,
      E1.toLowerCase(),
      null,
    );
    expect(Object.keys(mockVerify.mock.calls[0]?.[0])).not.toContain(
      "signer_address",
    );
  });

  it("makes no request for invalid or empty input", async () => {
    connectStellar(A);
    const { result } = setup(loaded());
    act(() => result.current.beginOther("stellar"));
    act(() => result.current.linkOther("stellar", "nope"));
    act(() => result.current.linkOther("stellar", "   "));
    await act(async () => {});
    expect(mockChallenge).not.toHaveBeenCalled();
    expect(phaseOf(result)).toBe("editing");
  });

  it("beginOther is a no-op for a Failed LP, no wallet, another kind, a missing LP and a flow in flight", async () => {
    connectStellar(A);
    const failed = setup(loaded({ kyb_status: "Failed" }));
    act(() => failed.result.current.beginOther("stellar"));
    expect(phaseOf(failed.result)).toBe("idle");
    const otherKind = setup(loaded());
    act(() => otherKind.result.current.beginOther("evm"));
    expect(phaseOf(otherKind.result)).toBe("idle");
    const noLp = setup({ token: "t", lp: null, lpLoaded: false });
    act(() => noLp.result.current.beginOther("stellar"));
    expect(phaseOf(noLp.result)).toBe("idle");
    connectStellar(undefined);
    const noWallet = setup(loaded());
    act(() => noWallet.result.current.beginOther("stellar"));
    expect(phaseOf(noWallet.result)).toBe("idle");

    connectStellar(A);
    mockStellarSign.mockImplementation(() => new Promise(() => {}));
    const busy = setup(loaded());
    act(() => busy.result.current.link("stellar"));
    await waitFor(() => expect(phaseOf(busy.result)).toBe("signing"));
    act(() => busy.result.current.beginOther("stellar"));
    act(() => busy.result.current.linkOther("stellar", G2));
    expect(phaseOf(busy.result)).toBe("signing");
    expect(mockChallenge).toHaveBeenCalledTimes(1);
  });

  it("cancelChange closes the form", () => {
    connectStellar(A);
    const { result } = setup(loaded());
    act(() => result.current.beginOther("stellar"));
    act(() => result.current.cancelChange());
    expect(result.current.state).toEqual({
      kind: null,
      phase: "idle",
      mode: "wallet",
    });
  });

  it("a declined signature keeps the form and a resubmit asks for a new challenge", async () => {
    connectStellar(A);
    mockStellarSign.mockRejectedValueOnce(new Error("no"));
    mockChallenge
      .mockResolvedValueOnce({ message: "msg-1", nonce: "n1" })
      .mockResolvedValueOnce({ message: "msg-2", nonce: "n2" });
    const { result, onLp } = setup(loaded());
    act(() => result.current.beginOther("stellar"));
    act(() => result.current.linkOther("stellar", CONTRACT));
    await waitFor(() => expect(phaseOf(result)).toBe("declined"));
    expect(result.current.state.mode).toBe("other");
    act(() => result.current.linkOther("stellar", CONTRACT));
    await waitFor(() => expect(onLp).toHaveBeenCalledOnce());
    expect(mockChallenge).toHaveBeenCalledTimes(2);
    expect(mockStellarSign).toHaveBeenLastCalledWith("msg-2", A);
  });

  it("422 reports proofFailed without a toast and keeps the other mode", async () => {
    connectStellar(A);
    mockVerify.mockRejectedValueOnce(new ApiError(422, "bad signature"));
    const { result } = setup(loaded());
    act(() => result.current.beginOther("stellar"));
    act(() => result.current.linkOther("stellar", CONTRACT));
    await waitFor(() => expect(phaseOf(result)).toBe("proofFailed"));
    expect(result.current.state.mode).toBe("other");
    expect(show).not.toHaveBeenCalled();
  });

  it("409 toasts, re-reads the LP and keeps the form open as taken", async () => {
    connectStellar(A);
    mockVerify.mockRejectedValueOnce(
      new ApiError(409, "address already linked to another account"),
    );
    mockGet.mockResolvedValueOnce(lp());
    const { result, onLp } = setup(loaded());
    act(() => result.current.beginOther("stellar"));
    act(() => result.current.linkOther("stellar", CONTRACT));
    await waitFor(() => expect(phaseOf(result)).toBe("taken"));
    expect(result.current.state.mode).toBe("other");
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "address already linked to another account",
      }),
    );
    expect(onLp).toHaveBeenCalledOnce();
  });

  it("other errors toast the address fallback and report error", async () => {
    connectStellar(A);
    mockVerify.mockRejectedValueOnce(new TypeError("offline"));
    mockGet.mockRejectedValueOnce(new TypeError("offline"));
    const { result } = setup(loaded());
    act(() => result.current.beginOther("stellar"));
    act(() => result.current.linkOther("stellar", CONTRACT));
    await waitFor(() => expect(phaseOf(result)).toBe("error"));
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "This address could not be linked." }),
    );
  });

  it("a wallet switched mid-flight goes idle with no verify", async () => {
    connectStellar(A);
    let resolveSign: (v: { signature: string }) => void = () => {};
    mockStellarSign
      .mockReset()
      .mockImplementation(() => new Promise((r) => (resolveSign = r)));
    const { result, rerender } = setup(loaded());
    act(() => result.current.beginOther("stellar"));
    act(() => result.current.linkOther("stellar", CONTRACT));
    await waitFor(() => expect(phaseOf(result)).toBe("signing"));
    connectStellar(B);
    rerender(loaded());
    await act(async () => resolveSign({ signature: "sig-s" }));
    await waitFor(() => expect(phaseOf(result)).toBe("idle"));
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("a token change closes an open form", async () => {
    connectStellar(A);
    const { result, rerender } = setup(loaded());
    act(() => result.current.beginOther("stellar"));
    expect(phaseOf(result)).toBe("editing");
    rerender({ ...loaded(), token: "t2" });
    await waitFor(() => expect(phaseOf(result)).toBe("idle"));
  });
});
