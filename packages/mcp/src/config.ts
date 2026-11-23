// Startup config from env (docs/design-docs/mcp-test-env.md, "Transport and
// auth"): MCP_PORT and MCP_TOKENS, a JSON array of {id, secret} per client.
import { Config, Schema } from "effect";

const Token = Schema.Struct({
  id: Schema.NonEmptyString,
  secret: Schema.String.check(Schema.isMinLength(32)),
});

const Tokens = Schema.fromJsonString(
  Schema.Array(Token).check(
    Schema.isMinLength(1),
    Schema.makeFilter(
      (tokens) =>
        new Set(tokens.map((t) => t.id)).size === tokens.length &&
        new Set(tokens.map((t) => t.secret)).size === tokens.length,
      { expected: "unique ids and secrets" },
    ),
  ),
);

export const mcpConfig = Config.all({
  port: Config.Port("MCP_PORT"),
  tokens: Config.schema(Tokens, "MCP_TOKENS"),
});
