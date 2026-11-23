// Postgres adapter of the `Db` port (docs/design-docs/mcp-test-env.md,
// "Tools"): the read-only role; every call runs in its own `BEGIN READ ONLY`
// transaction with `SET LOCAL statement_timeout`, so nothing a pooled
// connection was left with carries over.
import { Effect, Layer, Redacted } from "effect";
import pg from "pg";

import { Db, type Table } from "./db.js";
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
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
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
        }),
      ),
    ),
  );
