// @vitest-environment node
// spec: packages/frontend/src/wallet/README.md "E2E test wallet"

import { describe, expect, it } from "vitest";
import { createConfig, http } from "@wagmi/core";
import { foundry, mainnet, sepolia } from "viem/chains";
import { recoverMessageAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { E2E_EVM_WALLET_ID, e2eEvmConnector } from "./e2eConnector";

const key = generatePrivateKey();
const on = { DEV: true, VITE_E2E_WALLET: "1", E2E_EVM_WALLET_KEY: key };

describe("e2eEvmConnector", () => {
  it("is absent without the flag", () => {
    expect(
      e2eEvmConnector({ ...on, VITE_E2E_WALLET: undefined }, 31337),
    ).toBeUndefined();
    expect(
      e2eEvmConnector({ ...on, VITE_E2E_WALLET: "" }, 31337),
    ).toBeUndefined();
  });

  it("is absent outside a dev build", () => {
    expect(e2eEvmConnector({ ...on, DEV: false }, 31337)).toBeUndefined();
    expect(e2eEvmConnector({ ...on, DEV: undefined }, 31337)).toBeUndefined();
  });

  it("is absent on any chain but 31337", () => {
    for (const id of [1, 560048, 11155111, 8453, 0])
      expect(e2eEvmConnector(on, id)).toBeUndefined();
  });

  it("refuses the flag without a key", () => {
    expect(() =>
      e2eEvmConnector({ ...on, E2E_EVM_WALLET_KEY: undefined }, 31337),
    ).toThrow(/E2E_EVM_WALLET_KEY/);
  });

  it("connects the run's key on 31337 and signs messages locally", async () => {
    const config = createConfig({
      chains: [foundry],
      transports: { [foundry.id]: http("http://127.0.0.1:1") },
      connectors: [e2eEvmConnector(on, 31337)!],
    });
    const c = config.connectors[0]!;
    const address = privateKeyToAccount(key).address;
    expect(c.id).toBe(E2E_EVM_WALLET_ID);
    expect(await c.connect()).toMatchObject({
      accounts: [address],
      chainId: 31337,
    });
    const provider = (await c.getProvider()) as {
      request(a: { method: string; params?: unknown[] }): Promise<unknown>;
    };
    const signature = (await provider.request({
      method: "personal_sign",
      params: ["0x6869", address],
    })) as `0x${string}`;
    expect(await recoverMessageAddress({ message: "hi", signature })).toBe(
      address,
    );
    for (const chain of [mainnet, sepolia])
      await expect(c.switchChain!({ chainId: chain.id })).rejects.toThrow();
  });
});
