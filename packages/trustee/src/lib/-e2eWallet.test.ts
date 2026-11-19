// @vitest-environment node
// spec: packages/frontend/src/wallet/README.md "E2E test wallet"

import { beforeEach, describe, expect, it, vi } from "vitest";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@pipeline/wallet-connect", () => ({
  registerStellarE2EWallet: register,
}));
vi.mock("@/lib/env", () => ({ ENV: {} }));

// eslint-disable-next-line no-restricted-imports -- a throwaway key and the passphrases, test only
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { loadE2EWallet } from "./e2eWallet";

const STANDALONE = Networks.STANDALONE;
const on = {
  DEV: true,
  VITE_E2E_WALLET: "1",
  E2E_WALLET_SECRET: Keypair.random().secret(),
};

describe("loadE2EWallet (trustee)", () => {
  beforeEach(() => register.mockClear());

  it("registers the test wallet with the flag on the standalone network in dev", async () => {
    expect(await loadE2EWallet(on, STANDALONE)).toBe(true);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "pipeline-e2e-wallet" }),
    );
  });

  it("is absent without the flag", async () => {
    expect(
      await loadE2EWallet({ ...on, VITE_E2E_WALLET: undefined }, STANDALONE),
    ).toBe(false);
    expect(
      await loadE2EWallet({ ...on, VITE_E2E_WALLET: "" }, STANDALONE),
    ).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it("is absent outside a dev build", async () => {
    expect(await loadE2EWallet({ ...on, DEV: false }, STANDALONE)).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it("is absent with a foreign passphrase", async () => {
    for (const p of [Networks.TESTNET, Networks.PUBLIC, ""])
      expect(await loadE2EWallet(on, p)).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });
});
