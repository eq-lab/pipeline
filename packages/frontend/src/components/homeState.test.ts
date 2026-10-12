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

describe("deriveHomeState — kyb-pending (#1423)", () => {
  const base = {
    hasSession: true,
    isConnected: true,
    lpRead: "loaded" as const,
    kybStatus: "UnderReview",
    plusdIsZero: true,
    splusdIsZero: true,
  };

  it("returns kyb-pending when signed in, connected, UnderReview, both balances zero", () => {
    expect(deriveHomeState(base)).toBe("kyb-pending");
  });

  it("returns legacy when PLUSD is non-zero", () => {
    expect(deriveHomeState({ ...base, plusdIsZero: false })).toBe("legacy");
  });

  it("returns legacy when sPLUSD is non-zero", () => {
    expect(deriveHomeState({ ...base, splusdIsZero: false })).toBe("legacy");
  });

  it("returns legacy when the wallet is disconnected", () => {
    expect(deriveHomeState({ ...base, isConnected: false })).toBe("legacy");
  });

  it.each(["unknown", "error", "absent"] as const)(
    "returns legacy when UnderReview but lpRead is %s",
    (lpRead) => {
      expect(deriveHomeState({ ...base, lpRead })).toBe("legacy");
    },
  );

  it.each(["NotStarted", "Passed", "ChangesRequested", "Failed", "InProgress"])(
    "returns legacy when connected with zero balances and kybStatus %s",
    (kybStatus) => {
      expect(deriveHomeState({ ...base, kybStatus })).toBe("legacy");
    },
  );

  it("returns zero when there is no session, even with every state-3 input set", () => {
    expect(deriveHomeState({ ...base, hasSession: false })).toBe("zero");
  });

  it("returns legacy when the balance inputs are omitted entirely", () => {
    expect(
      deriveHomeState({
        hasSession: true,
        isConnected: true,
        lpRead: "loaded",
        kybStatus: "UnderReview",
      }),
    ).toBe("legacy");
  });

  it("returns legacy when only one balance input is passed", () => {
    expect(
      deriveHomeState({
        hasSession: true,
        isConnected: true,
        lpRead: "loaded",
        kybStatus: "UnderReview",
        plusdIsZero: true,
      }),
    ).toBe("legacy");
  });
});
