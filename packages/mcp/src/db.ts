// The `Db` port and the `schema` tool (specs/mcp/schema.md): tables of the
// `public` schema with their columns; `postgres.ts` is the adapter, `fakes.ts`
// the fake.
import { Clock, Context, Effect, Schema } from "effect";

import type { ToolError } from "./errors.js";

export interface Table {
  readonly name: string;
  readonly columns: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly nullable: boolean;
  }>;
}

// The worker's outboxes as `queues` reads them (specs/mcp/queues.md): errors
// are the newest `queueErrors` rows with an error, newest first, uncut.
export const queueErrors = 20;

export interface Queues {
  readonly kyc: {
    readonly unprocessed: number;
    readonly oldestUnprocessedAt: string | null;
    readonly errors: ReadonlyArray<{
      readonly id: number;
      readonly chainId: number;
      readonly error: string;
    }>;
  };
  readonly yieldMint: {
    readonly byStatus: Readonly<Record<string, number>>;
    readonly errors: ReadonlyArray<{
      readonly chainId: number;
      readonly loanId: number;
      readonly repaymentId: number;
      readonly status: string;
      readonly error: string;
    }>;
  };
}

// Tables sorted by name, columns by position.
export class Db extends Context.Service<
  Db,
  {
    readonly tables: Effect.Effect<ReadonlyArray<Table>, ToolError>;
    readonly queues: Effect.Effect<Queues, ToolError>;
  }
>()("@pipeline/mcp/Db") {}

export const SchemaResult = Schema.Struct({
  tables: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      columns: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          type: Schema.String,
          nullable: Schema.Boolean,
        }),
      ),
    }),
  ),
});

export const schema = Effect.gen(function* () {
  return { tables: yield* (yield* Db).tables };
});

const cut = (error: string) => error.slice(0, 500);

export const QueuesResult = Schema.Struct({
  kyc: Schema.Struct({
    unprocessed: Schema.Number,
    oldestUnprocessedAgeSeconds: Schema.NullOr(Schema.Number),
    recentErrors: Schema.Array(
      Schema.Struct({
        id: Schema.Number,
        chainId: Schema.Number,
        error: Schema.String,
      }),
    ),
  }),
  yieldMint: Schema.Struct({
    byStatus: Schema.Record(Schema.String, Schema.Number),
    recentErrors: Schema.Array(
      Schema.Struct({
        chainId: Schema.Number,
        loanId: Schema.Number,
        repaymentId: Schema.Number,
        status: Schema.String,
        error: Schema.String,
      }),
    ),
  }),
});

export const queues = Effect.gen(function* () {
  const { kyc, yieldMint } = yield* (yield* Db).queues;
  const now = yield* Clock.currentTimeMillis;
  return {
    kyc: {
      unprocessed: kyc.unprocessed,
      oldestUnprocessedAgeSeconds:
        kyc.oldestUnprocessedAt === null
          ? null
          : Math.floor((now - Date.parse(kyc.oldestUnprocessedAt)) / 1000),
      recentErrors: kyc.errors.map((e) => ({ ...e, error: cut(e.error) })),
    },
    yieldMint: {
      byStatus: yieldMint.byStatus,
      recentErrors: yieldMint.errors.map((e) => ({
        ...e,
        error: cut(e.error),
      })),
    },
  };
});
