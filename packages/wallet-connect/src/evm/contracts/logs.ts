// spec: docs/frontend/wallet-flows.md#trustee-evm-contract-client
import { getPublicClient } from "@wagmi/core";
import { pad, toHex, type Address, type Hex, type RpcLog } from "viem";
import { initEvmWalletConnect } from "../config";

export const EVM_LOG_CHUNK_BLOCKS = 50_000n;

export type EvmLogTopics = ReadonlyArray<Hex | ReadonlyArray<Hex> | null>;

export interface ScanEvmLogsParams {
  address: ReadonlyArray<Address>;
  topics: EvmLogTopics;
  fromBlock: bigint;
  chainId: number;
  concurrency?: number;
}

export function loanIdTopic(loanId: number | bigint): Hex {
  return pad(toHex(BigInt(loanId)), { size: 32 });
}

export function evmLogChunks(
  fromBlock: bigint,
  head: bigint,
): Array<[bigint, bigint]> {
  const chunks: Array<[bigint, bigint]> = [];
  for (let start = fromBlock; start <= head; start += EVM_LOG_CHUNK_BLOCKS) {
    const end = start + EVM_LOG_CHUNK_BLOCKS - 1n;
    chunks.push([start, end > head ? head : end]);
  }
  return chunks;
}

export async function scanEvmLogs({
  address,
  topics,
  fromBlock,
  chainId,
  concurrency = 4,
}: ScanEvmLogsParams): Promise<RpcLog[]> {
  const publicClient = getPublicClient(initEvmWalletConnect(), { chainId });
  if (!publicClient) throw new Error("RPC not ready");
  const head = await publicClient.getBlockNumber();
  const chunks = evmLogChunks(fromBlock, head);
  const results: RpcLog[][] = new Array(chunks.length);
  let cursor = 0;
  let failure: unknown = null;
  let failed = false;
  const worker = async () => {
    while (!failed && cursor < chunks.length) {
      const index = cursor++;
      const [from, to] = chunks[index]!;
      try {
        results[index] = (await publicClient.request({
          method: "eth_getLogs",
          params: [
            {
              address: [...address],
              topics: topics.map((topic) =>
                topic === null || typeof topic === "string"
                  ? topic
                  : [...topic],
              ),
              fromBlock: toHex(from),
              toBlock: toHex(to),
            },
          ],
        } as never)) as RpcLog[];
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
        return;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, chunks.length)) },
      worker,
    ),
  );
  if (failed) throw failure;
  return results.flat();
}
