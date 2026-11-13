import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  ENV: { STELLAR_CHAIN_ID: 99_000_001, EVM_CHAIN_ID: 560048 },
}));

import { ApiError } from "@/api/client";
import type { LpBankDeposit } from "@/api/useLpBankDeposits";
import {
  depositError,
  mapDepositToRow,
  matchedChainReason,
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

const DEPOSIT: LpBankDeposit = {
  id: 3,
  lp_id: 7,
  amount: "100.00",
  payment_reference: "B-1",
  ref_hash: "ab".repeat(32),
  occurred_at: "2026-10-05T15:41:00Z",
  is_minted: false,
  recorded_by: "GT",
  created_at: "2026-10-05T16:00:00Z",
  matched_reference: null,
};

const MATCHED = {
  payment_details: "PL-7K3M-Q9TX-2ABC",
  chain_id: 99_000_001,
  receiver_address: "GSHOWN",
  issued_at: "2026-10-04T10:00:00Z",
};

describe("mapDepositToRow matched", () => {
  it("is null for a hand-attributed deposit", () => {
    expect(mapDepositToRow(DEPOSIT).matched).toBeNull();
  });

  it("maps a matched reference with the chain label and formatted time", () => {
    expect(
      mapDepositToRow({ ...DEPOSIT, matched_reference: MATCHED }).matched,
    ).toEqual({
      paymentDetails: "PL-7K3M-Q9TX-2ABC",
      issuedAt: "4 Oct 2026, 10:00 UTC",
      chainId: 99_000_001,
      chainLabel: "Stellar",
      receiverAddress: "GSHOWN",
    });
  });

  it("keeps a null chain and receiver as served", () => {
    const row = mapDepositToRow({
      ...DEPOSIT,
      matched_reference: { ...MATCHED, chain_id: null, receiver_address: null },
    });
    expect(row.matched?.chainId).toBeNull();
    expect(row.matched?.chainLabel).toBe("—");
    expect(row.matched?.receiverAddress).toBeNull();
  });
});

describe("matchedChainReason", () => {
  const matchedRow = (chain_id: number | null) =>
    mapDepositToRow({
      ...DEPOSIT,
      matched_reference: { ...MATCHED, chain_id },
    });

  it("is null on the same chain, for a null chain and for a hand row", () => {
    expect(matchedChainReason(matchedRow(99_000_001), 99_000_001)).toBeNull();
    expect(matchedChainReason(matchedRow(null), 99_000_001)).toBeNull();
    expect(matchedChainReason(mapDepositToRow(DEPOSIT), 99_000_001)).toBeNull();
  });

  it("names the chain when it differs from the session", () => {
    expect(matchedChainReason(matchedRow(560048), 99_000_001)).toBe(
      "This wire was matched to a reference issued for Hoodi. Sign in on Hoodi to mint it.",
    );
  });
});

describe("depositError", () => {
  it("returns the served text for a 422", () => {
    expect(depositError(new ApiError("served 422 text", 422))?.message).toBe(
      "served 422 text",
    );
  });

  it("uses the bank-reference copy for 409 and 400", () => {
    expect(depositError(new ApiError("dup", 409))?.message).toBe(
      "A deposit with this bank reference is already recorded.",
    );
    expect(depositError(new ApiError("bad", 400))?.message).toBe(
      "Check the amount, references and date, then try again.",
    );
  });
});
