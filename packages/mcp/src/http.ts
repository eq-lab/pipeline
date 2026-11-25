// Streamable HTTP MCP endpoint behind Bearer auth, one audit record per request
// (specs/mcp/transport.md). Tools are registered in `tools.ts`.
import { Clock, Effect, Exit, Layer, Option, Schema } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { AuditSink, ToolReason } from "./audit.js";
import { authenticate, type Token } from "./auth.js";
import { toolNames, tools } from "./tools.js";

const ToolCall = Schema.Struct({
  method: Schema.Literal("tools/call"),
  params: Schema.Struct({ name: Schema.String }),
});

const toolName = (request: HttpServerRequest.HttpServerRequest) =>
  request.json.pipe(
    Effect.map((body) =>
      Schema.decodeUnknownOption(ToolCall)(body).pipe(
        Option.map((call) => call.params.name),
        Option.getOrNull,
      ),
    ),
    Effect.orElseSucceed(() => null),
  );

const authAndAudit = (tokens: ReadonlyArray<Token>) =>
  HttpRouter.middleware(
    Effect.gen(function* () {
      const sink = yield* AuditSink;
      return (handler) =>
        Effect.gen(function* () {
          const start = yield* Clock.currentTimeMillis;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const tokenId = authenticate(tokens, request.headers.authorization);
          const tool = tokenId === null ? null : yield* toolName(request);
          const toolReason = { reason: null as string | null };
          const exit =
            tokenId === null
              ? Exit.succeed(HttpServerResponse.empty({ status: 401 }))
              : yield* Effect.exit(
                  Effect.provideService(handler, ToolReason, toolReason),
                );
          const ok = Exit.isSuccess(exit) && exit.value.status < 400;
          yield* sink.write({
            tokenId,
            tool,
            durationMs: (yield* Clock.currentTimeMillis) - start,
            // shortcut: a streamed (SSE) body has no known length and counts 0; count bytes while streaming if SSE results matter.
            resultBytes:
              Exit.isSuccess(exit) && exit.value.body._tag === "Uint8Array"
                ? exit.value.body.body.length
                : 0,
            outcome:
              tokenId === null
                ? "unauthorized"
                : (toolReason.reason ??
                  (tool !== null && !toolNames.has(tool)
                    ? "invalid_input"
                    : ok
                      ? "ok"
                      : "error")),
          });
          return yield* exit;
        });
    }),
    { global: true },
  );

export const app = (tokens: ReadonlyArray<Token>) =>
  McpServer.layerHttp({
    name: "pipeline-mcp",
    version: "0.1.0",
    path: "/mcp",
    protocols: [
      McpProtocol.v2026_07_28,
      McpProtocol.v2025_11_25,
      McpProtocol.v2025_06_18,
      McpProtocol.v2025_03_26,
    ],
    registrations: tools,
  }).pipe(Layer.merge(authAndAudit(tokens)));
