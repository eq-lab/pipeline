// @vitest-environment node
// spec: packages/frontend/src/wallet/README.md "E2E test wallet"

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connect,
  createConfig,
  http,
  sendTransaction,
  writeContract,
} from "@wagmi/core";
import { foundry, mainnet, sepolia } from "viem/chains";
import {
  erc20Abi,
  type TransactionSerialized,
  parseTransaction,
  recoverMessageAddress,
  recoverTransactionAddress,
  toFunctionSelector,
} from "viem";
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

describe("e2eEvmConnector transactions", () => {
  afterEach(() => vi.unstubAllGlobals());

  // A JSON-RPC node that answers what viem asks before sending and records every raw transaction.
  function stubNode(): TransactionSerialized[] {
    const raw: TransactionSerialized[] = [];
    const answers: Record<string, unknown> = {
      eth_chainId: "0x7a69",
      eth_getTransactionCount: "0x0",
      eth_estimateGas: "0x5208",
      eth_gasPrice: "0x1",
      eth_maxPriorityFeePerGas: "0x1",
      eth_getBlockByNumber: {
        number: "0x1",
        timestamp: "0x0",
        baseFeePerGas: "0x1",
        transactions: [],
      },
    };
    vi.stubGlobal("fetch", async (_url: unknown, init: { body: string }) => {
      const { id, method, params } = JSON.parse(init.body) as {
        id: number;
        method: string;
        params: unknown[];
      };
      if (method === "eth_sendRawTransaction") raw.push(params[0] as TransactionSerialized);
      const result =
        method === "eth_sendRawTransaction"
          ? `0x${"ab".repeat(32)}`
          : answers[method];
      const body =
        result === undefined
          ? { error: { code: -32601, message: `${method} not found` } }
          : { result };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, ...body }), {
        headers: { "content-type": "application/json" },
      });
    });
    return raw;
  }

  it("signs sendTransaction and writeContract with the run's key and sends them raw on 31337", async () => {
    const raw = stubNode();
    const config = createConfig({
      chains: [foundry],
      transports: { [foundry.id]: http() },
      connectors: [e2eEvmConnector(on, 31337)!],
    });
    const address = privateKeyToAccount(key).address;
    const to = "0x00000000000000000000000000000000000000E2";
    await connect(config, { connector: config.connectors[0]! });

    await sendTransaction(config, { to, value: 7n, gas: 21_000n });
    await writeContract(config, {
      address: to,
      abi: erc20Abi,
      functionName: "approve",
      args: [address, 5n],
      gas: 60_000n,
    });

    expect(raw).toHaveLength(2);
    const [send, approve] = raw.map((r) => parseTransaction(r));
    expect(send).toMatchObject({ chainId: 31337, value: 7n, gas: 21_000n });
    expect(send!.to?.toLowerCase()).toBe(to.toLowerCase());
    expect(approve).toMatchObject({ chainId: 31337, gas: 60_000n });
    expect(approve!.data?.slice(0, 10)).toBe(
      toFunctionSelector("approve(address,uint256)"),
    );
    for (const serializedTransaction of raw)
      expect(await recoverTransactionAddress({ serializedTransaction })).toBe(
        address,
      );
  });
});
