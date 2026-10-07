// spec: docs/product-specs/home-screen-states.md
import { describe, it, expect } from "vitest";
import { deriveHomeState } from "./homeState";

describe("deriveHomeState", () => {
  it("returns zero when there is no session, wallet disconnected", () => {
    expect(deriveHomeState({ hasSession: false, isConnected: false })).toBe(
      "zero",
    );
  });

  it("returns zero when there is no session, even with a wallet connected", () => {
    expect(deriveHomeState({ hasSession: false, isConnected: true })).toBe(
      "zero",
    );
  });

  it("returns legacy when a session is present, wallet disconnected, lpRead unknown", () => {
    expect(deriveHomeState({ hasSession: true, isConnected: false })).toBe(
      "legacy",
    );
  });

  it("returns legacy when a session is present and wallet connected", () => {
    expect(deriveHomeState({ hasSession: true, isConnected: true })).toBe(
      "legacy",
    );
  });

  it("returns unverified when signed in, disconnected, and the LP is absent (404)", () => {
    expect(
      deriveHomeState({
        hasSession: true,
        isConnected: false,
        lpRead: "absent",
      }),
    ).toBe("unverified");
  });

  it("returns unverified when signed in, disconnected, loaded, kybStatus NotStarted", () => {
    expect(
      deriveHomeState({
        hasSession: true,
        isConnected: false,
        lpRead: "loaded",
        kybStatus: "NotStarted",
      }),
    ).toBe("unverified");
  });

  it("returns legacy when signed in, disconnected, lpRead unknown (in-flight read)", () => {
    expect(
      deriveHomeState({
        hasSession: true,
        isConnected: false,
        lpRead: "unknown",
      }),
    ).toBe("legacy");
  });

  it("returns legacy when signed in, disconnected, lpRead error", () => {
    expect(
      deriveHomeState({
        hasSession: true,
        isConnected: false,
        lpRead: "error",
      }),
    ).toBe("legacy");
  });

  it("returns legacy when signed in, connected, loaded, kybStatus NotStarted (wallet connected is part of the condition)", () => {
    expect(
      deriveHomeState({
        hasSession: true,
        isConnected: true,
        lpRead: "loaded",
        kybStatus: "NotStarted",
      }),
    ).toBe("legacy");
  });

  it.each([
    "UnderReview",
    "Passed",
    "ChangesRequested",
    "Failed",
    "InProgress",
  ])(
    "returns legacy when signed in, disconnected, loaded, kybStatus %s",
    (kybStatus) => {
      expect(
        deriveHomeState({
          hasSession: true,
          isConnected: false,
          lpRead: "loaded",
          kybStatus,
        }),
      ).toBe("legacy");
    },
  );
});
