// spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer
import { createPublicClient, erc20Abi, http, isAddress } from "viem";
import type { PublicClient } from "viem";

export interface GetErc20BalanceParams {
  rpcUrl: string;
  tokenAddress: string;
  account: string;
}

export interface Erc20Balance {
  raw: bigint;
  decimals: number;
}

const clients = new Map<string, PublicClient>();

function clientFor(rpcUrl: string): PublicClient {
  let client = clients.get(rpcUrl);
  if (!client) {
    client = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;
    clients.set(rpcUrl, client);
  }
  return client;
}

export async function getErc20Balance(
  params: GetErc20BalanceParams,
): Promise<Erc20Balance> {
  const { rpcUrl, tokenAddress, account } = params;
  if (!isAddress(tokenAddress)) {
    throw new Error("getErc20Balance: tokenAddress must be a 0x address");
  }
  if (!isAddress(account)) {
    throw new Error("getErc20Balance: account must be a 0x address");
  }
  const client = clientFor(rpcUrl);
  const [raw, decimals] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }),
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);
  return { raw, decimals: Number(decimals) };
}
