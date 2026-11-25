import assert from "node:assert/strict";
import { test } from "node:test";

import { Effect } from "effect";
import type pg from "pg";

import { readOnly } from "../src/postgres.js";

void test("a client-side failure destroys the connection instead of rolling back", async () => {
  const queries: string[] = [];
  const released: unknown[] = [];
  let destroyed = false;
  const client = {
    connection: {
      stream: {
        destroy: () => {
          destroyed = true;
        },
      },
    },
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
    release: (error?: unknown) => released.push(error),
  } as unknown as pg.PoolClient;
  const pool = { connect: () => Promise.resolve(client) } as unknown as pg.Pool;
  const timeout = new Error("Query read timeout");

  const exit = await Effect.runPromiseExit(
    readOnly(pool, 1000, () => Promise.reject(timeout)),
  );

  assert.equal(exit._tag, "Failure");
  assert.ok(destroyed);
  assert.deepEqual(released, [timeout]);
  assert.ok(!queries.includes("ROLLBACK"));
});
