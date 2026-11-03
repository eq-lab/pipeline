import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  ENV: { STELLAR_CHAIN_ID: 99_000_001, EVM_CHAIN_ID: 560048 },
}));

import {
  sameReceiver,
  wireInReceiver,
  type CapitalWallets,
  type WireInReceiver,
} from "./-useLpBankDeposits";

const WALLETS: CapitalWallets = { stellar: "GCAP", evm: "0xcap" };
const NO_WALLETS: CapitalWallets = { stellar: "", evm: "" };
const NONE = {
  stellar_address: null,
  address_linked_at: null,
  evm_address: null,
  evm_address_linked_at: null,
};
const LINKED = "2026-09-01T00:00:00Z";

describe("wireInReceiver", () => {
  it("uses the linked Stellar address for the Stellar kind", () => {
    expect(
      wireInReceiver(
        { ...NONE, stellar_address: "GLP", address_linked_at: LINKED },
        "stellar",
        WALLETS,
      ),
    ).toEqual({ receiver: "GLP", isCapitalWallet: false, kind: "stellar" });
  });

  it("falls back to the Stellar capital wallet when linked-at is null", () => {
    expect(
      wireInReceiver({ ...NONE, stellar_address: "GLP" }, "stellar", WALLETS),
    ).toEqual({ receiver: "GCAP", isCapitalWallet: true, kind: "stellar" });
  });

  it("uses the linked EVM address for the EVM kind", () => {
    expect(
      wireInReceiver(
        { ...NONE, evm_address: "0xlp", evm_address_linked_at: LINKED },
        "evm",
        WALLETS,
      ),
    ).toEqual({ receiver: "0xlp", isCapitalWallet: false, kind: "evm" });
  });

  it("never crosses kinds", () => {
    const stellarOnly = {
      ...NONE,
      stellar_address: "GLP",
      address_linked_at: LINKED,
    };
    expect(wireInReceiver(stellarOnly, "evm", WALLETS)).toEqual({
      receiver: "0xcap",
      isCapitalWallet: true,
      kind: "evm",
    });
    const evmOnly = {
      ...NONE,
      evm_address: "0xlp",
      evm_address_linked_at: LINKED,
    };
    expect(wireInReceiver(evmOnly, "stellar", WALLETS)).toEqual({
      receiver: "GCAP",
      isCapitalWallet: true,
      kind: "stellar",
    });
  });

  it("is null with no address and no capital wallet", () => {
    expect(wireInReceiver(NONE, "stellar", NO_WALLETS)).toBeNull();
    expect(wireInReceiver(NONE, "evm", NO_WALLETS)).toBeNull();
    expect(wireInReceiver(undefined, "stellar", NO_WALLETS)).toBeNull();
  });
});

describe("sameReceiver", () => {
  const base: WireInReceiver = {
    receiver: "GLP",
    isCapitalWallet: false,
    kind: "stellar",
  };

  it("detects an address change and a capital-wallet flip", () => {
    expect(sameReceiver(base, { ...base })).toBe(true);
    expect(sameReceiver(base, { ...base, receiver: "GOTHER" })).toBe(false);
    expect(sameReceiver(base, { ...base, isCapitalWallet: true })).toBe(false);
  });

  it("treats two nulls as equal and null vs a receiver as different", () => {
    expect(sameReceiver(null, null)).toBe(true);
    expect(sameReceiver(base, null)).toBe(false);
    expect(sameReceiver(null, base)).toBe(false);
  });
});
