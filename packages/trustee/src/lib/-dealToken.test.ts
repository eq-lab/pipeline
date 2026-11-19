// spec: docs/frontend/trustee-flows.md#register-debt-token-1766
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  ENV: { STELLAR_CHAIN_ID: 99_000_001, EVM_CHAIN_ID: 560_048 },
}));

import {
  DEBT_TOKEN_CONNECT_WALLET,
  DEBT_TOKEN_NOT_CONFIGURED,
  DEBT_TOKEN_NO_ROLE,
  debtTokenRegistered,
  debtTokenView,
  registerDealAccessReason,
  registerDealError,
} from "./dealToken";

const STELLAR = 99_000_001;
const EVM = 560_048;
const REGISTERED = {
  data: { debt: "CDEBT" },
  isPending: false,
  isError: false,
};
const UNREGISTERED = { data: null, isPending: false, isError: false };

describe("debtTokenView", () => {
  it("blocks a non-configured chain with the Stellar-only reason", () => {
    const view = debtTokenView(1, true, UNREGISTERED);
    expect(view.kind).toBe("blocked");
    expect(view.kind === "blocked" && view.reason).toContain("Stellar only");
  });

  it("opens the configured EVM chain", () => {
    expect(debtTokenView(EVM, true, UNREGISTERED)).toEqual({
      kind: "unregistered",
    });
    expect(
      debtTokenView(EVM, true, {
        data: { debt: "0xDEBT" },
        isPending: false,
        isError: false,
      }),
    ).toEqual({ kind: "registered", debt: "0xDEBT" });
  });

  it("blocks an unconfigured environment", () => {
    expect(debtTokenView(STELLAR, false, UNREGISTERED)).toEqual({
      kind: "blocked",
      reason: DEBT_TOKEN_NOT_CONFIGURED,
    });
  });

  it("is unregistered only when deal() reports no deal", () => {
    expect(debtTokenView(STELLAR, true, UNREGISTERED)).toEqual({
      kind: "unregistered",
    });
    expect(debtTokenView(STELLAR, true, REGISTERED)).toEqual({
      kind: "registered",
      debt: "CDEBT",
    });
  });

  it("hides while loading and on a read error", () => {
    expect(
      debtTokenView(STELLAR, true, {
        data: undefined,
        isPending: true,
        isError: false,
      }),
    ).toEqual({ kind: "hidden" });
    expect(
      debtTokenView(STELLAR, true, {
        data: undefined,
        isPending: false,
        isError: true,
      }),
    ).toEqual({ kind: "hidden" });
  });
});

describe("debtTokenRegistered", () => {
  it("maps registered, unregistered and unknown", () => {
    expect(debtTokenRegistered(REGISTERED)).toEqual({
      registered: true,
      debt: "CDEBT",
    });
    expect(debtTokenRegistered(UNREGISTERED)).toEqual({
      registered: false,
      debt: null,
    });
    expect(
      debtTokenRegistered({ data: undefined, isPending: false, isError: true }),
    ).toEqual({ registered: null, debt: null });
  });
});

describe("registerDealAccessReason", () => {
  const base = {
    connected: true,
    access: { immediate: true, delay: 0 },
    isPending: false,
    isError: false,
  };

  it("is null with an immediate or delayed role", () => {
    expect(registerDealAccessReason(base)).toBeNull();
    expect(
      registerDealAccessReason({
        ...base,
        access: { immediate: false, delay: 3600 },
      }),
    ).toBeNull();
  });

  it("explains a missing wallet, role, pending and failed checks", () => {
    expect(registerDealAccessReason({ ...base, connected: false })).toBe(
      DEBT_TOKEN_CONNECT_WALLET,
    );
    expect(
      registerDealAccessReason({
        ...base,
        access: { immediate: false, delay: 0 },
      }),
    ).toBe(DEBT_TOKEN_NO_ROLE);
    expect(
      registerDealAccessReason({ ...base, access: undefined, isPending: true }),
    ).toMatch(/Checking/);
    expect(
      registerDealAccessReason({ ...base, access: undefined, isError: true }),
    ).toMatch(/Could not verify/);
  });
});

describe("registerDealError", () => {
  const sim = (code: number) =>
    new Error(`execute simulation error: HostError: Error(Contract, #${code})`);

  it("maps the factory codes in execute mode", () => {
    expect(registerDealError("execute", sim(3)).message).toMatch(
      /already registered/,
    );
    expect(registerDealError("execute", sim(1)).message).toMatch(
      /no loan with this id/,
    );
    expect(registerDealError("execute", sim(5)).message).toMatch(/set_admin/);
    expect(registerDealError("execute", sim(3)).isSpecific).toBe(true);
  });

  it("prefers the AccessManager copy for its own codes", () => {
    expect(registerDealError("execute", sim(7)).message).toMatch(
      /not ready yet/,
    );
    expect(
      registerDealError(
        "schedule",
        new Error("schedule simulation error: Error(Contract, #9)"),
      ).message,
    ).toMatch(/already scheduled/);
  });

  it("does not apply factory codes in schedule mode", () => {
    const err = registerDealError(
      "schedule",
      new Error("schedule simulation error: Error(Contract, #3)"),
    );
    expect(err.message).not.toMatch(/already registered/);
  });

  it("falls back to the generic simulation copy for unknown codes", () => {
    expect(registerDealError("execute", sim(99)).message).toMatch(
      /Could not verify this action on-chain/,
    );
  });

  describe("EVM errors", () => {
    const evm = (name: string) =>
      new Error(`registerEvmDeal: simulation error: reverted with ${name}`);

    it("maps the factory names in execute mode", () => {
      expect(
        registerDealError(
          "execute",
          evm("DealTokenFactoryAlreadyRegistered(7)"),
        ).message,
      ).toMatch(/already registered/);
      expect(
        registerDealError("execute", evm("LoanRegistryNonExistentLoanId()"))
          .message,
      ).toMatch(/no loan with this id/);
    });

    it("falls back to the generic copy for factory names in schedule mode", () => {
      expect(
        registerDealError(
          "schedule",
          evm("DealTokenFactoryAlreadyRegistered(7)"),
        ).message,
      ).toMatch(/Could not verify this action on-chain/);
    });

    it("maps the AccessManager names", () => {
      expect(
        registerDealError("execute", evm("AccessManagerNotReady(0xab)"))
          .message,
      ).toMatch(/not ready yet/);
      expect(
        registerDealError(
          "schedule",
          evm("AccessManagerAlreadyScheduled(0xab)"),
        ).message,
      ).toMatch(/already scheduled/);
    });

    it("gives the generic copy with raw details for an unauthorised call", () => {
      const err = registerDealError(
        "execute",
        evm("AccessManagerUnauthorizedCall(0xa, 0xb, 0x19da0d36)"),
      );
      expect(err.message).toMatch(/Could not verify this action on-chain/);
      expect(err.details).toContain("AccessManagerUnauthorizedCall");
    });

    it("passes a wallet rejection through", () => {
      const err = registerDealError(
        "execute",
        new Error("User rejected the request."),
      );
      expect(err.message).toMatch(/You cancelled the transaction/);
    });
  });
});
