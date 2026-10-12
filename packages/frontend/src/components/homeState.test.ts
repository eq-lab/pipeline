// spec: docs/product-specs/home-screen-states.md
import { describe, it, expect } from "vitest";
import { deriveHomeState } from "./homeState";

describe("deriveHomeState", () => {
  it("returns zero when there is no session, wallet disconnected", () => {
    expect(deriveHomeState({ hasSession: false, isConnected: false })).toBe(
      "zero",
    );
  });

  it("returns zero when there is no session, wallet connected and balances unknown", () => {
    expect(deriveHomeState({ hasSession: false, isConnected: true })).toBe(
      "zero",
    );
  });

  it("returns wallet-only when there is no session, wallet connected, both balances zero", () => {
    expect(
      deriveHomeState({
        hasSession: false,
        isConnected: true,
        plusdIsZero: true,
        splusdIsZero: true,
      }),
    ).toBe("wallet-only");
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

  it.each(["UnderReview", "Passed", "InProgress"])(
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

  it.each(["ChangesRequested", "Failed"])(
    "returns kyb-problem when signed in, disconnected, loaded, kybStatus %s",
    (kybStatus) => {
      expect(
        deriveHomeState({
          hasSession: true,
          isConnected: false,
          lpRead: "loaded",
          kybStatus,
        }),
      ).toBe("kyb-problem");
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

  it.each(["NotStarted", "Passed", "InProgress"])(
    "returns legacy when connected with zero balances and kybStatus %s",
    (kybStatus) => {
      expect(deriveHomeState({ ...base, kybStatus })).toBe("legacy");
    },
  );

  it.each(["ChangesRequested", "Failed"])(
    "returns kyb-problem when connected with zero balances and kybStatus %s",
    (kybStatus) => {
      expect(deriveHomeState({ ...base, kybStatus })).toBe("kyb-problem");
    },
  );

  it("returns wallet-only when there is no session, even with every state-3 input set", () => {
    expect(deriveHomeState({ ...base, hasSession: false })).toBe("wallet-only");
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

describe("deriveHomeState — plusd-held (#1424)", () => {
  const base = {
    hasSession: true,
    isConnected: true,
    lpRead: "loaded" as const,
    kybStatus: "Passed",
    plusdIsZero: false,
    splusdIsZero: true,
  };

  it("returns plusd-held when signed in, connected, Passed, PLUSD held, sPLUSD zero", () => {
    expect(deriveHomeState(base)).toBe("plusd-held");
  });

  it("returns legacy when PLUSD is also zero", () => {
    expect(deriveHomeState({ ...base, plusdIsZero: true })).toBe("legacy");
  });

  it("returns legacy when sPLUSD is non-zero", () => {
    expect(deriveHomeState({ ...base, splusdIsZero: false })).toBe("legacy");
  });

  it("returns legacy when the wallet is disconnected", () => {
    expect(deriveHomeState({ ...base, isConnected: false })).toBe("legacy");
  });

  it.each(["unknown", "error", "absent"] as const)(
    "returns legacy when Passed but lpRead is %s",
    (lpRead) => {
      expect(deriveHomeState({ ...base, lpRead })).toBe("legacy");
    },
  );

  it.each(["NotStarted", "UnderReview", "InProgress"])(
    "returns legacy when connected with PLUSD held and kybStatus %s",
    (kybStatus) => {
      expect(deriveHomeState({ ...base, kybStatus })).toBe("legacy");
    },
  );

  it.each(["ChangesRequested", "Failed"])(
    "returns kyb-problem when connected with PLUSD held and kybStatus %s",
    (kybStatus) => {
      expect(deriveHomeState({ ...base, kybStatus })).toBe("kyb-problem");
    },
  );

  it("returns zero when there is no session, even with every state-4 input set", () => {
    expect(deriveHomeState({ ...base, hasSession: false })).toBe("zero");
  });
});

describe("deriveHomeState — kyb-problem (#1426)", () => {
  const connectedZero = {
    hasSession: true,
    isConnected: true,
    lpRead: "loaded" as const,
    plusdIsZero: true,
    splusdIsZero: true,
  };

  it.each(["ChangesRequested", "Failed"] as const)(
    "returns kyb-problem for every isConnected/balance combination — kybStatus %s",
    (kybStatus) => {
      for (const isConnected of [true, false]) {
        for (const plusdIsZero of [true, false]) {
          for (const splusdIsZero of [true, false]) {
            expect(
              deriveHomeState({
                hasSession: true,
                isConnected,
                lpRead: "loaded",
                kybStatus,
                plusdIsZero,
                splusdIsZero,
              }),
            ).toBe("kyb-problem");
          }
        }
      }
    },
  );

  it("returns wallet-only when there is no session, regardless of kybStatus", () => {
    expect(
      deriveHomeState({
        ...connectedZero,
        hasSession: false,
        kybStatus: "ChangesRequested",
      }),
    ).toBe("wallet-only");
  });

  it.each(["unknown", "error", "absent"] as const)(
    "returns legacy when ChangesRequested but lpRead is %s",
    (lpRead) => {
      expect(
        deriveHomeState({
          ...connectedZero,
          lpRead,
          kybStatus: "ChangesRequested",
        }),
      ).toBe("legacy");
    },
  );

  it.each(["unknown", "error", "absent"] as const)(
    "returns legacy when Failed but lpRead is %s",
    (lpRead) => {
      expect(
        deriveHomeState({ ...connectedZero, lpRead, kybStatus: "Failed" }),
      ).toBe("legacy");
    },
  );

  it.each(["NotStarted", "InProgress", "UnderReview", "Passed"])(
    "does not promote kybStatus %s into kyb-problem",
    (kybStatus) => {
      expect(deriveHomeState({ ...connectedZero, kybStatus })).not.toBe(
        "kyb-problem",
      );
    },
  );
});

describe("deriveHomeState — wallet-only (#1460)", () => {
  const base = {
    hasSession: false,
    isConnected: true,
    plusdIsZero: true,
    splusdIsZero: true,
  };

  it("returns wallet-only when connected, both balances display-zero, no session", () => {
    expect(deriveHomeState(base)).toBe("wallet-only");
  });

  it("returns zero when there is no session and the wallet is disconnected", () => {
    expect(deriveHomeState({ ...base, isConnected: false })).toBe("zero");
  });

  it("returns zero when there is no session, connected, PLUSD non-zero", () => {
    expect(deriveHomeState({ ...base, plusdIsZero: false })).toBe("zero");
  });

  it("returns zero when there is no session, connected, sPLUSD non-zero", () => {
    expect(deriveHomeState({ ...base, splusdIsZero: false })).toBe("zero");
  });

  it("returns zero when there is no session, connected, balance inputs omitted", () => {
    expect(deriveHomeState({ hasSession: false, isConnected: true })).toBe(
      "zero",
    );
  });

  it.each(["unknown", "absent", "loaded", "error"] as const)(
    "returns wallet-only regardless of lpRead %s",
    (lpRead) => {
      expect(deriveHomeState({ ...base, lpRead })).toBe("wallet-only");
    },
  );

  it.each([
    "NotStarted",
    "InProgress",
    "UnderReview",
    "Passed",
    "ChangesRequested",
    "Failed",
  ])("returns wallet-only regardless of kybStatus %s", (kybStatus) => {
    expect(deriveHomeState({ ...base, kybStatus })).toBe("wallet-only");
  });

  it("returns legacy when signed in, connected, zero balances, lpRead unknown", () => {
    expect(
      deriveHomeState({ ...base, hasSession: true, lpRead: "unknown" }),
    ).toBe("legacy");
  });
});
