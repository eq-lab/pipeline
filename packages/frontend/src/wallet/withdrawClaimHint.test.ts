// spec: docs/product-specs/withdrawals.md#queue-position-payable-now-and-recovery-rate-lp-app
import { describe, it, expect } from "vitest";
import {
  selectWithdrawClaimHint,
  type WithdrawClaimHintInput,
} from "./withdrawClaimHint";

const READY: WithdrawClaimHintInput = {
  paused: false,
  voucherExpired: false,
  hasVoucher: true,
  requestStatus: "PendingClaim",
  payableNow: true,
  recoveryActive: false,
  payout: undefined,
  amount: "1,000.00",
  rate: "0.95",
};

const PAUSED =
  "The withdrawal queue is paused. Check the status page before retrying.";
const EXPIRED =
  "The voucher expired before you claimed. Your app fetches a new one.";
const NO_VOUCHER =
  "No voucher yet. Screening is still running, or the request did not screen clean.";
const CUSTODY =
  "The withdrawal custody account is short. Claims for your position wait until it is funded.";

describe("selectWithdrawClaimHint", () => {
  it("payable with nothing blocking reads Payable now.", () => {
    expect(selectWithdrawClaimHint(READY)).toBe("Payable now.");
  });

  it("payable with a known payout appends the payout line", () => {
    expect(selectWithdrawClaimHint({ ...READY, payout: "1,250.00" })).toBe(
      "Payable now. Pays 1,250.00 USDC.",
    );
  });

  it("paused wins over every other state", () => {
    expect(
      selectWithdrawClaimHint({
        ...READY,
        paused: true,
        voucherExpired: true,
        hasVoucher: false,
        payableNow: false,
        recoveryActive: true,
      }),
    ).toBe(PAUSED);
  });

  it("voucher expired wins over no voucher and not payable", () => {
    expect(
      selectWithdrawClaimHint({
        ...READY,
        voucherExpired: true,
        hasVoucher: false,
        payableNow: false,
      }),
    ).toBe(EXPIRED);
  });

  it.each([
    ["no ready voucher", { hasVoucher: false }],
    ["PendingVerification", { requestStatus: "PendingVerification" as const }],
    ["VerificationFailed", { requestStatus: "VerificationFailed" as const }],
  ])("%s → no-voucher copy", (_name, patch) => {
    expect(
      selectWithdrawClaimHint({ ...READY, payableNow: false, ...patch }),
    ).toBe(NO_VOUCHER);
  });

  it("not payable with a ready voucher → custody-short copy", () => {
    expect(selectWithdrawClaimHint({ ...READY, payableNow: false })).toBe(
      CUSTODY,
    );
  });

  it("unknown payable state shows neither the custody nor the payable copy", () => {
    expect(
      selectWithdrawClaimHint({
        ...READY,
        payableNow: undefined,
        recoveryActive: true,
        payout: "950.00",
      }),
    ).toBeUndefined();
  });

  it("recovery active shows the payout formula, — until the payout resolves", () => {
    expect(selectWithdrawClaimHint({ ...READY, recoveryActive: true })).toBe(
      "Payable now. Pays — USDC = 1,000.00 PLUSD × 0.95",
    );
    expect(
      selectWithdrawClaimHint({
        ...READY,
        recoveryActive: true,
        payout: "950.00",
      }),
    ).toBe("Payable now. Pays 950.00 USDC = 1,000.00 PLUSD × 0.95");
  });

  it("a waiting reason wins over the recovery formula", () => {
    expect(
      selectWithdrawClaimHint({
        ...READY,
        recoveryActive: true,
        payableNow: false,
      }),
    ).toBe(CUSTODY);
  });
});
