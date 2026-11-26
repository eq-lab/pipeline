// EVM and Stellar JSON-RPC adapter of the `ChainRpc` port
// (docs/design-docs/mcp-test-env.md, "Worker tables on main"): the head is
// `eth_blockNumber` or `getLatestLedger`; any failure is `unreachable`.
import { Effect, Layer, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { ToolError } from "./errors.js";
import { ChainRpc } from "./indexer-lag.js";

export interface ChainConfig {
  readonly kind: "evm" | "stellar";
  readonly rpcUrl: string;
}

const EvmHead = Schema.Struct({
  result: Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]+$/)),
});
const StellarHead = Schema.Struct({
  result: Schema.Struct({ sequence: Schema.Int }),
});

const call = (url: string, method: string, params?: ReadonlyArray<never>) =>
  HttpClientRequest.post(url).pipe(
    HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", id: 1, method, params }),
  );

export const chainRpc = (chains: ReadonlyMap<number, ChainConfig>) =>
  Layer.effect(
    ChainRpc,
    Effect.gen(function* () {
      const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
      const head = ({ kind, rpcUrl }: ChainConfig) =>
        kind === "evm"
          ? client.execute(call(rpcUrl, "eth_blockNumber", [])).pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(EvmHead)),
              Effect.map(({ result }) => Number(BigInt(result))),
            )
          : client.execute(call(rpcUrl, "getLatestLedger")).pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(StellarHead)),
              Effect.map(({ result }) => result.sequence),
            );
      return ChainRpc.of({
        head: (chainId) => {
          const chain = chains.get(chainId);
          if (chain === undefined)
            return Effect.fail(new ToolError({ reason: "no_rpc_configured" }));
          return head(chain).pipe(
            Effect.timeout("5 seconds"),
            Effect.mapError(() => new ToolError({ reason: "unreachable" })),
          );
        },
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
