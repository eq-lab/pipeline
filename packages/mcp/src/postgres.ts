// Postgres adapter of the `Db` port (docs/design-docs/mcp-test-env.md,
// "Tools"): the read-only role; every call runs in its own `BEGIN READ ONLY`
// transaction with `SET LOCAL statement_timeout`, ended by `ROLLBACK`, so
// nothing a pooled connection was left with carries over.
import { Effect, Layer, Redacted } from "effect";
import pg from "pg";

import {
  Db,
  type LogCursor,
  maxRows,
  queueErrors,
  type Queues,
  type SyncState,
  type Table,
} from "./db.js";
import { ToolError } from "./errors.js";

export interface PostgresConfig {
  readonly url: Redacted.Redacted;
  readonly statementTimeoutMs: number;
}

export const readOnly = <A>(
  pool: pg.Pool,
  statementTimeoutMs: number,
  run: (client: pg.PoolClient) => Promise<A>,
) =>
  Effect.tryPromise(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(
        `SET LOCAL statement_timeout = ${String(Math.trunc(statementTimeoutMs))}`,
      );
      return await run(client);
    } finally {
      // Never COMMIT: a rolled-back transaction also undoes a session-level
      // `SET` or `set_config` a `query` statement made, so it cannot change
      // the pooled connection for later calls (e.g. its `search_path`). A
      // connection that cannot roll back is dropped, not reused.
      client.release(
        await client.query("ROLLBACK").then(
          () => undefined,
          (error: unknown) =>
            error instanceof Error ? error : new Error("rollback failed"),
        ),
      );
    }
  }).pipe(
    Effect.tapError((cause) => Effect.logWarning("db", cause)),
    Effect.mapError(() => new ToolError({ reason: "db_unavailable" })),
  );

interface Row {
  readonly table: string;
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
}

const columnsSql = `
  SELECT c.table_name AS "table", c.column_name AS name, c.data_type AS type,
         c.is_nullable = 'YES' AS nullable
  FROM information_schema.columns c
  JOIN information_schema.tables t USING (table_schema, table_name)
  WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  ORDER BY c.table_name, c.ordinal_position`;

// Rows come ordered by table, so a table's columns are adjacent.
const toTables = (rows: ReadonlyArray<Row>): ReadonlyArray<Table> => {
  const tables = new Map<string, Table["columns"][number][]>();
  for (const { table, name, type, nullable } of rows)
    tables.set(table, [...(tables.get(table) ?? []), { name, type, nullable }]);
  return [...tables].map(([name, columns]) => ({ name, columns }));
};

const limit = String(queueErrors);
type Str<K extends string> = Record<K, string>;

// pg returns bigint, numeric and count as strings.
const readQueues = async (client: pg.PoolClient): Promise<Queues> => {
  const kyc = await client.query<{ unprocessed: string; oldest: Date | null }>(
    `SELECT count(*) AS unprocessed, min(created_at) AS oldest
    FROM kyc_outbox WHERE processed_at IS NULL`,
  );
  const kycErrors = await client.query<Str<"id" | "chain_id" | "error">>(
    `SELECT id, chain_id, error FROM kyc_outbox
    WHERE error IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
  );
  const statuses = await client.query<Str<"status" | "n">>(
    "SELECT status, count(*) AS n FROM yield_mint_outbox GROUP BY status",
  );
  const mintErrors = await client.query<
    Str<"chain_id" | "loan_id" | "repayment_id" | "status" | "error">
  >(
    `SELECT chain_id, loan_id, repayment_id,
    status, last_error AS error FROM yield_mint_outbox
    WHERE last_error IS NOT NULL ORDER BY created_at DESC LIMIT ${limit}`,
  );
  const { unprocessed, oldest } = kyc.rows[0] ?? {
    unprocessed: "0",
    oldest: null,
  };
  return {
    kyc: {
      unprocessed: Number(unprocessed),
      oldestUnprocessedAt: oldest === null ? null : oldest.toISOString(),
      errors: kycErrors.rows.map((r) => ({
        id: Number(r.id),
        chainId: Number(r.chain_id),
        error: r.error,
      })),
    },
    yieldMint: {
      byStatus: Object.fromEntries(
        statuses.rows.map((r) => [r.status, Number(r.n)]),
      ),
      errors: mintErrors.rows.map((r) => ({
        chainId: Number(r.chain_id),
        loanId: Number(r.loan_id),
        repaymentId: Number(r.repayment_id),
        status: r.status,
        error: r.error,
      })),
    },
  };
};

const indexerSql = `
  SELECT chain_id::float8 AS "chainId", last_indexed_block::float8 AS next,
         to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
  FROM log_collector_state`;

const cursorSql = (table: string, column: string) => `
  SELECT chain_id::float8 AS "chainId", contract_address AS contract,
         ${column}::float8 AS cursor
  FROM ${table}`;

const maxLogIdSql = `
  SELECT COALESCE(MAX(id), 0)::float8 AS id FROM contract_logs
  WHERE chain_id = $1 AND contract_address = ANY($2)
    AND ($3::text[] IS NULL OR event_name = ANY($3))`;

const syncState = async (client: pg.PoolClient): Promise<SyncState> => {
  const indexer = await client.query<SyncState["indexer"][number]>(indexerSql);
  const registry = await client.query<LogCursor>(
    cursorSql("security_registry_state", "projected_log_id"),
  );
  const accessManager = await client.query<LogCursor>(
    cursorSql("access_manager_sync_state", "last_log_id"),
  );
  return {
    indexer: indexer.rows,
    registry: registry.rows,
    accessManager: accessManager.rows,
  };
};

// Extended protocol (`rows` set): Postgres refuses multi-statement text, and
// the portal is closed after the first page, so the rest is never loaded. With
// `rows` set pg sends no Sync, so a server error must send it, or the
// connection never gets ReadyForQuery and hangs.
interface Sync {
  sync(): void;
}

const baseHandleError = (
  pg.Query.prototype as unknown as {
    handleError: (this: pg.Query, error: Error, connection: Sync) => void;
  }
).handleError;

class Capped extends pg.Query {
  handlePortalSuspended(connection: Sync) {
    connection.sync();
  }

  handleError(error: Error, connection: Sync) {
    if (error instanceof pg.DatabaseError) connection.sync();
    baseHandleError.call(this, error, connection);
  }
}

const reasons: Readonly<Record<string, string>> = {
  "25006": "read_only_violation",
  "57014": "statement_timeout",
};

// A database error comes back as a value so `readOnly` does not call the
// database unavailable.
const runQuery = async (client: pg.PoolClient, sql: string) => {
  try {
    // pg types lack `rows`; a submitted query returns itself, not a promise,
    // so the result comes through the callback.
    const result = await new Promise<pg.ResultBuilder<unknown[]>>(
      (resolve, reject) => {
        client.query(
          new Capped(
            {
              text: sql,
              rows: maxRows + 1,
              rowMode: "array",
            } as pg.QueryConfig,
            (error, built) => {
              if (error instanceof Error) reject(error);
              else resolve(built as pg.ResultBuilder<unknown[]>);
            },
          ),
        );
      },
    );
    return {
      columns: result.fields.map((f) => f.name),
      rows: result.rows.slice(0, maxRows + 1),
    };
  } catch (error) {
    if (!(error instanceof pg.DatabaseError)) throw error;
    return new ToolError({
      reason: error.message.includes("multiple commands")
        ? "multiple_statements"
        : (reasons[error.code ?? ""] ?? "sql_error"),
      message: error.message,
    });
  }
};

export const postgres = (config: PostgresConfig) =>
  Layer.effect(
    Db,
    Effect.acquireRelease(
      Effect.gen(function* () {
        const log = Effect.runForkWith(yield* Effect.context());
        const pool = new pg.Pool({
          connectionString: Redacted.value(config.url),
          max: 5,
          options: "-c default_transaction_read_only=on",
        });
        pool.on("error", (cause) => log(Effect.logWarning("db idle", cause)));
        return pool;
      }),
      (pool) => Effect.promise(() => pool.end()),
    ).pipe(
      Effect.map((pool) =>
        Db.of({
          tables: readOnly(pool, config.statementTimeoutMs, (client) =>
            client.query<Row>(columnsSql),
          ).pipe(Effect.map(({ rows }) => toTables(rows))),
          queues: readOnly(pool, config.statementTimeoutMs, readQueues),
          syncState: readOnly(pool, config.statementTimeoutMs, syncState),
          maxLogId: (chainId, contracts, events) =>
            readOnly(pool, config.statementTimeoutMs, (client) =>
              client.query<{ id: number }>(maxLogIdSql, [
                chainId,
                contracts,
                events ?? null,
              ]),
            ).pipe(Effect.map(({ rows }) => rows[0]?.id ?? 0)),
          cursors: readOnly(pool, config.statementTimeoutMs, (client) =>
            client.query<{ chain_id: string; updated_at: Date }>(
              "SELECT chain_id, updated_at FROM log_collector_state",
            ),
          ).pipe(
            Effect.map(({ rows }) =>
              rows.map((r) => ({
                chainId: Number(r.chain_id),
                updatedAt: r.updated_at.toISOString(),
              })),
            ),
          ),
          query: (sql) =>
            readOnly(pool, config.statementTimeoutMs, (client) =>
              runQuery(client, sql),
            ).pipe(
              Effect.flatMap((r) =>
                r instanceof ToolError ? Effect.fail(r) : Effect.succeed(r),
              ),
            ),
        }),
      ),
    ),
  );
