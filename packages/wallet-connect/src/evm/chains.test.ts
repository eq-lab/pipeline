// spec: docs/frontend/wallet-flows.md#chain-registry
import { describe, it, expect, beforeEach } from "vitest";
import {
  evmChainInfo,
  defineEvmChain,
  _resetEvmChainCacheForTests,
} from "./chains";

describe("evmChainInfo", () => {
  it("returns Ethereum mainnet for chain 1", () => {
    const info = evmChainInfo(1);
    expect(info.name).toBe("Ethereum");
    expect(info.explorer?.url).toBe("https://etherscan.io");
    expect(info.testnet).toBe(false);
  });

  it("returns Hoodi for chain 560048", () => {
    const info = evmChainInfo(560048);
    expect(info.name).toBe("Hoodi");
    expect(info.explorer?.url).toBe("https://hoodi.etherscan.io");
    expect(info.testnet).toBe(true);
  });

  it("returns a generic testnet-styled definition for unknown ids", () => {
    const info = evmChainInfo(31337);
    expect(info.name).toBe("EVM chain 31337");
    expect(info.explorer).toBeUndefined();
    expect(info.testnet).toBe(true);
  });
});

describe("defineEvmChain", () => {
  beforeEach(() => _resetEvmChainCacheForTests());

  it("builds the chain from the registry and the passed RPC", () => {
    const chain = defineEvmChain(560048, "https://rpc.example");
    expect(chain.id).toBe(560048);
    expect(chain.caipNetworkId).toBe("eip155:560048");
    expect(chain.name).toBe("Hoodi");
    expect(chain.rpcUrls.default.http).toEqual(["https://rpc.example"]);
    expect(chain.blockExplorers?.default.url).toBe(
      "https://hoodi.etherscan.io",
    );
  });

  it("omits blockExplorers for an unknown id", () => {
    expect(
      defineEvmChain(31337, "https://rpc.example").blockExplorers,
    ).toBeUndefined();
  });

  it("memoizes per chain id and RPC", () => {
    const a = defineEvmChain(1, "https://rpc.a");
    expect(defineEvmChain(1, "https://rpc.a")).toBe(a);
    expect(defineEvmChain(1, "https://rpc.b")).not.toBe(a);
  });
});
