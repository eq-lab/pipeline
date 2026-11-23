// The `indexer_lag` tool (specs/mcp/indexer-lag.md): worker cursors from the
// `Db` port against chain heads from the `ChainRpc` port; `RegistryLogContracts`
// is the registry projection's contract list per chain.
import { Clock, Context, Effect, Result, Schema } from "effect";
import { Db, type LogCursor } from "./db.js";
import type { ToolError } from "./errors.js";

export class ChainRpc extends Context.Service<
  ChainRpc,
  { readonly head: (chainId: number) => Effect.Effect<number, ToolError> }
>()("@pipeline/mcp/ChainRpc") {}

export class RegistryLogContracts extends Context.Service<
  RegistryLogContracts,
  ReadonlyMap<number, ReadonlyArray<string>>
>()("@pipeline/mcp/RegistryLogContracts") {}

export const accessManagerEvents = [
  "AccessManagerOperationScheduled",
  "AccessManagerOperationExecuted",
  "AccessManagerOperationCanceled",
];

export const IndexerLagResult = Schema.Struct({
  chains: Schema.Array(
    Schema.Struct({
      chainId: Schema.Number,
      lastIndexedBlock: Schema.Number,
      ageSeconds: Schema.optionalKey(Schema.Number),
      head: Schema.optionalKey(Schema.Number),
      lagBlocks: Schema.optionalKey(Schema.Number),
      error: Schema.optionalKey(Schema.String),
    }),
  ),
  projections: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      chainId: Schema.Number,
      contract: Schema.String,
      cursor: Schema.Number,
      latest: Schema.Number,
      lagLogs: Schema.Number,
    }),
  ),
});

export const indexerLag = Effect.gen(function* () {
  const db = yield* Db;
  const rpc = yield* ChainRpc;
  const registry = yield* RegistryLogContracts;
  const now = yield* Clock.currentTimeMillis;
  const state = yield* db.syncState;
  const projection = (
    name: string,
    cursor: LogCursor,
    contracts: ReadonlyArray<string>,
    events?: ReadonlyArray<string>,
  ) =>
    db.maxLogId(cursor.chainId, contracts, events).pipe(
      Effect.map((latest) => ({
        name,
        ...cursor,
        latest,
        lagLogs: Math.max(0, latest - cursor.cursor),
      })),
    );
  const [chains, projections] = yield* Effect.all([
    Effect.forEach(
      state.indexer,
      ({ chainId, next, updatedAt }) => {
        const last = next - 1;
        const age =
          updatedAt === undefined
            ? {}
            : { ageSeconds: Math.round((now - Date.parse(updatedAt)) / 1000) };
        return Effect.result(rpc.head(chainId)).pipe(
          Effect.map((head) => ({
            chainId,
            lastIndexedBlock: last,
            ...age,
            ...(Result.isSuccess(head)
              ? {
                  head: head.success,
                  lagBlocks: Math.max(0, head.success - last),
                }
              : { error: head.failure.reason }),
          })),
        );
      },
      { concurrency: "unbounded" },
    ),
    Effect.forEach(
      [
        ...state.registry.map((c) =>
          projection(
            "security_registry",
            c,
            registry.get(c.chainId) ?? [c.contract],
          ),
        ),
        ...state.accessManager.map((c) =>
          projection("access_manager", c, [c.contract], accessManagerEvents),
        ),
      ],
      (read) => read,
    ),
  ]);
  return {
    chains: [...chains].sort((a, b) => a.chainId - b.chainId),
    projections: [...projections].sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.chainId - b.chainId ||
        a.contract.localeCompare(b.contract),
    ),
  };
});
