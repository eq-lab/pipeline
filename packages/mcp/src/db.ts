// The `Db` port and the `schema` tool (specs/mcp/schema.md): tables of the
// `public` schema with their columns; `postgres.ts` is the adapter, `fakes.ts`
// the fake.
import { Context, Effect, Schema } from "effect";

import type { ToolError } from "./errors.js";

export interface Table {
  readonly name: string;
  readonly columns: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly nullable: boolean;
  }>;
}

// Tables sorted by name, columns by position.
export class Db extends Context.Service<
  Db,
  { readonly tables: Effect.Effect<ReadonlyArray<Table>, ToolError> }
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
