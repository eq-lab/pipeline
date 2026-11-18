// spec: docs/frontend/wallet-flows.md#trustee-evm-contract-client
import { getPublicClient } from "@wagmi/core";
import { pad, toHex, type Address, type Hex, type RpcLog } from "viem";
import { initEvmWalletConnect } from "../config";

export const EVM_LOG_CHUNK_BLOCKS = 50_000n;
export const EVM_LOG_RETRIES = 3;
export const EVM_LOG_RETRY_DELAY_MS = 400;

export type EvmLogTopics = ReadonlyArray<Hex | ReadonlyArray<Hex> | null>;

export interface ScanEvmLogsParams {
  address: ReadonlyArray<Address>;
  topics: EvmLogTopics;
  fromBlock: bigint;
  chainId: number;
  concurrency?: number;
  head?: bigint;
  retries?: number;
  retryDelayMs?: number;
}

const TRANSIENT_MESSAGE =
  /\b(429|5\d\d)\b|rate.?limit|too many requests|timed? ?out|timeout|failed to fetch|fetch failed|network|econnreset|socket hang up|temporarily unavailable|bad gateway|service unavailable|gateway time-?out/i;

export function isTransientRpcError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const err = current as {
      status?: unknown;
      code?: unknown;
      name?: unknown;
      shortMessage?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof err.status === "number") {
      if (err.status === 429 || err.status >= 500) return true;
    }
    if (err.code === -32005) return true;
    if (err.name === "TimeoutError") return true;
    const text = `${String(err.shortMessage ?? "")} ${String(err.message ?? "")}`;
    if (TRANSIENT_MESSAGE.test(text)) return true;
    current = err.cause;
  }
  return false;
}

async function withRetry<T>(
  run: () => Promise<T>,
  retries: number,
  delayMs: number,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= retries || !isTransientRpcError(error)) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, delayMs * 2 ** attempt),
      );
    }
  }
}

export async function readEvmHeadBlock(chainId: number): Promise<bigint> {
  const publicClient = getPublicClient(initEvmWalletConnect(), { chainId });
  if (!publicClient) throw new Error("RPC not ready");
  return withRetry(
    () => publicClient.getBlockNumber(),
    EVM_LOG_RETRIES,
    EVM_LOG_RETRY_DELAY_MS,
  );
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
  head: pinnedHead,
  retries = EVM_LOG_RETRIES,
  retryDelayMs = EVM_LOG_RETRY_DELAY_MS,
}: ScanEvmLogsParams): Promise<RpcLog[]> {
  const publicClient = getPublicClient(initEvmWalletConnect(), { chainId });
  if (!publicClient) throw new Error("RPC not ready");
  const head =
    pinnedHead ??
    (await withRetry(
      () => publicClient.getBlockNumber(),
      retries,
      retryDelayMs,
    ));
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
        results[index] = await withRetry(
          () =>
            publicClient.request({
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
            } as never) as Promise<RpcLog[]>,
          retries,
          retryDelayMs,
        );
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
