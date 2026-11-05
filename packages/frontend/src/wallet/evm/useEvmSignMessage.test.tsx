// spec: packages/frontend/src/wallet/README.md#useevmsignmessage
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEvmSignMessage } from "./useEvmSignMessage";

const { mockSignMessageAsync } = vi.hoisted(() => ({
  mockSignMessageAsync: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useSignMessage: vi.fn(() => ({ signMessageAsync: mockSignMessageAsync })),
}));

describe("useEvmSignMessage", () => {
  beforeEach(() => {
    localStorage.clear();
    mockSignMessageAsync.mockReset();
  });

  it("returns the EIP-191 signature from signMessageAsync", async () => {
    mockSignMessageAsync.mockResolvedValue("0xsig");
    const { result } = renderHook(() => useEvmSignMessage());
    const signed = await act(() => result.current.signMessage("hello"));
    expect(signed).toEqual({ signature: "0xsig" });
    expect(mockSignMessageAsync).toHaveBeenCalledWith({ message: "hello" });
  });

  it("pins the signing account when an address is given", async () => {
    mockSignMessageAsync.mockResolvedValue("0xsig");
    const { result } = renderHook(() => useEvmSignMessage());
    await act(() =>
      result.current.signMessage(
        "hello",
        "0xAbC0000000000000000000000000000000000001",
      ),
    );
    expect(mockSignMessageAsync).toHaveBeenCalledWith({
      message: "hello",
      account: "0xAbC0000000000000000000000000000000000001",
    });
  });

  it("mock path: rejects without signing", async () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );
    const { result } = renderHook(() => useEvmSignMessage());
    await expect(
      act(() => result.current.signMessage("hello")),
    ).rejects.toThrow("signMessage is not mockable");
    expect(mockSignMessageAsync).not.toHaveBeenCalled();
  });

  it("propagates a declined signature as a rejection", async () => {
    mockSignMessageAsync.mockRejectedValue(new Error("User rejected"));
    const { result } = renderHook(() => useEvmSignMessage());
    await expect(
      act(() => result.current.signMessage("hello")),
    ).rejects.toThrow("User rejected");
  });
});
