// `query` on the Postgres adapter (specs/mcp/query.md): the caller's statement
// runs as one prepared statement, capped at `maxRows + 1` rows and `maxBytes`
// of text values.
import pg from "pg";

import { maxBytes, maxRows } from "./db.js";
import { ToolError } from "./errors.js";

// Extended protocol (`rows` set): Postgres refuses multi-statement text, and
// the portal is closed after the first page, so the rest is never loaded. With
// `rows` set pg sends no Sync, so a server error must send it, or the
// connection never gets ReadyForQuery and hangs.
interface Sync {
  sync(): void;
}

const base = pg.Query.prototype as unknown as {
  handleError: (this: pg.Query, error: Error, connection: Sync) => void;
  handleDataRow: (this: pg.Query, msg: { fields: (string | null)[] }) => void;
};

const tooLarge = new ToolError({
  reason: "result_too_large",
  message: `result over ${String(maxBytes)} bytes; select fewer rows or columns`,
});

// Past `maxBytes` pg's `_canceledDueToError` drops the rest unparsed. shortcut:
// the server still streams the rest of the 501-row batch until it ends or
// `statement_timeout` fires; send a cancel request if that cost shows.
class Capped extends pg.Query {
  declare _canceledDueToError: Error | false;
  bytes = 0;

  handleDataRow(msg: { fields: (string | null)[] }) {
    for (const f of msg.fields) this.bytes += Buffer.byteLength(f ?? "");
    if (this.bytes > maxBytes) this._canceledDueToError = tooLarge;
    base.handleDataRow.call(this, msg);
  }

  handlePortalSuspended(connection: Sync) {
    connection.sync();
  }

  handleError(error: Error, connection: Sync) {
    if (error instanceof pg.DatabaseError) connection.sync();
    base.handleError.call(this, error, connection);
  }
}

// pg-protocol buffers a whole message and decodes its strings before pg sees
// it, so one value of hundreds of MB would be held whole, and one over V8's
// string limit throws inside the socket's data handler and crashes the
// process: a DataRow (`SELECT repeat('x', 600000000)`), and as well an
// ErrorResponse quoting the value (`SELECT repeat('x', 600000000)::int`), a
// NoticeResponse or CopyData. The guard reads every message header on the
// socket from connect on and, while a `query` statement runs, closes the
// connection at the header of any message longer than the largest DataRow
// that fits under the cap, before its body is read. A DataRow carries 2 bytes
// of field count and 4 per field (at most 1664) besides the values.
const maxBody = maxBytes + 2 + 4 * 1664;

interface Guard {
  armed: boolean;
  tripped: boolean;
}

const guards = new WeakMap<pg.ClientBase, Guard>();

// Installed on the pool's `connect`: the startup exchange has ended with
// ReadyForQuery and the server sends nothing unasked, so the next byte on the
// socket starts a message. pg-pool listens for a client's `error` only while
// it is idle, so a socket closed under a running query (the guard, a server
// restart) would emit an unhandled `error` and crash the process; the query
// still gets the error through its callback, and `readOnly` drops the client.
export const guard = (client: pg.PoolClient) => {
  const state: Guard = { armed: false, tripped: false };
  guards.set(client, state);
  client.on("error", () => undefined);
  const stream = client.connection.stream;
  const header = Buffer.alloc(5);
  let have = 0;
  let skip = 0;
  stream.prependListener("data", (chunk: Buffer) => {
    let i = 0;
    while (i < chunk.length && !state.tripped) {
      if (skip > 0) {
        const n = Math.min(skip, chunk.length - i);
        skip -= n;
        i += n;
        continue;
      }
      header[have++] = chunk.readUInt8(i++);
      if (have < header.length) continue;
      have = 0;
      skip = header.readUInt32BE(1) - 4;
      if (state.armed && skip > maxBody) {
        state.tripped = true;
        stream.destroy();
      }
    }
  });
};

// Types pg would turn into Date, Buffer or an object, which JSON cannot carry:
// they stay the text Postgres prints (and the byte cap counted), bytea as
// `\x…`. date, time-less/with zone timestamps, bytea, interval, and arrays of
// them. A float NaN or ±Infinity stays its text too, and numeric[] elements
// stay text like numeric, not floats that lose digits.
const asText = new Set([
  17, 1082, 1114, 1184, 1186, 1001, 1182, 1115, 1185, 1187,
]);
type Parser = (v: string) => unknown;
const textArray: number = 1009;
const strings = pg.types.getTypeParser(textArray) as Parser;
const float = (v: string) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : v;
};
const floats = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(floats) : typeof v === "string" ? float(v) : v;
const parsers: ReadonlyMap<number, Parser> = new Map<number, Parser>([
  [700, float],
  [701, float],
  [1021, (v) => floats(strings(v))],
  [1022, (v) => floats(strings(v))],
  [1231, strings],
]);
const types = {
  getTypeParser: (oid: number): Parser =>
    asText.has(oid)
      ? (v) => v
      : (parsers.get(oid) ?? (pg.types.getTypeParser(oid) as Parser)),
};

const reasons: Readonly<Record<string, string>> = {
  "25006": "read_only_violation",
  "57014": "statement_timeout",
};

// A database error comes back as a value so `readOnly` does not call the
// database unavailable.
export const runQuery = async (client: pg.PoolClient, sql: string) => {
  const state = guards.get(client);
  if (state !== undefined) state.armed = true;
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
              types,
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
    if (error === tooLarge || state?.tripped === true) return tooLarge;
    if (!(error instanceof pg.DatabaseError)) throw error;
    return new ToolError({
      reason: error.message.includes("multiple commands")
        ? "multiple_statements"
        : (reasons[error.code ?? ""] ?? "sql_error"),
      message: error.message,
    });
  } finally {
    if (state !== undefined) state.armed = false;
  }
};
