// The `Db` port and the `schema` tool (specs/mcp/schema.md): tables of the
// `public` schema with their columns; `postgres.ts` is the adapter, `fakes.ts`
// the fake.
import { Clock, Context, Effect, Schema } from "effect";

import { ToolError } from "./errors.js";

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

export interface LogCursor {
  readonly chainId: number;
  readonly contract: string;
  readonly cursor: number;
}

export interface SyncState {
  readonly indexer: ReadonlyArray<{
    readonly chainId: number;
    readonly next: number;
    readonly updatedAt?: string;
  }>;
  readonly registry: ReadonlyArray<LogCursor>;
  readonly accessManager: ReadonlyArray<LogCursor>;
}

// `query` (specs/mcp/query.md): the port returns at most `maxRows + 1` rows and
// fails with the database's reason (`read_only_violation`, `statement_timeout`,
// `multiple_statements`, `syntax_error`, `sql_error`) and message.
export const maxRows = 500;

export interface Rows {
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

// Tables sorted by name, columns by position. `maxLogId` is the max
// `contract_logs.id` of the chain over `contracts` (and `events`, when given),
// 0 when none.
export class Db extends Context.Service<
  Db,
  {
    readonly tables: Effect.Effect<ReadonlyArray<Table>, ToolError>;
    readonly queues: Effect.Effect<Queues, ToolError>;
    readonly syncState: Effect.Effect<SyncState, ToolError>;
    readonly maxLogId: (
      chainId: number,
      contracts: ReadonlyArray<string>,
      events: ReadonlyArray<string> | undefined,
    ) => Effect.Effect<number, ToolError>;
    // `log_collector_state`: the indexer cursor of each chain (`health`).
    readonly cursors: Effect.Effect<
      ReadonlyArray<{ readonly chainId: number; readonly updatedAt: string }>,
      ToolError
    >;
    readonly query: (sql: string) => Effect.Effect<Rows, ToolError>;
  }
>()("@pipeline/mcp/Db") {}

export const QueryParams = Schema.Struct({
  sql: Schema.String.check(Schema.isPattern(/\S/)).annotate({
    description: "one read-only SQL statement",
  }),
});

export const QueryResult = Schema.Struct({
  columns: Schema.Array(Schema.String),
  rows: Schema.Array(Schema.Array(Schema.Unknown)),
  truncated: Schema.Boolean,
});

const rejection: Readonly<Record<string, string>> = {
  read_only_violation: "write_rejected",
  syntax_error: "sql_error",
};

export const readQuery = Effect.fnUntraced(function* (
  params: typeof QueryParams.Type,
) {
  const { columns, rows } = yield* (yield* Db).query(params.sql).pipe(
    Effect.mapError(
      (e) =>
        new ToolError({
          reason: rejection[e.reason] ?? e.reason,
          message: e.message,
        }),
    ),
  );
  return {
    columns,
    rows: rows.slice(0, maxRows),
    truncated: rows.length > maxRows,
  };
});

export const dbQuery = (input: unknown) =>
  Schema.decodeUnknownEffect(QueryParams)(input).pipe(
    Effect.mapError(
      (error) =>
        new ToolError({ reason: "invalid_input", message: error.message }),
    ),
    Effect.flatMap(readQuery),
  );

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
