// Entry point: validated env config, then the MCP endpoint on MCP_PORT.
import { Cause, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { AuditSink } from "./audit.js";
import { mcpConfig } from "./config.js";
import { app } from "./http.js";
import { listen } from "./node.js";

const main = Effect.gen(function* () {
  const config = yield* mcpConfig;
  const { handler, dispose } = HttpRouter.toWebHandler(
    app(config.tokens).pipe(Layer.provide(AuditSink.stdout)),
    { disableLogger: true },
  );
  yield* Effect.acquireRelease(
    Effect.sync(() => listen(handler, config.port)),
    (server) =>
      Effect.promise(() => {
        server.close();
        return dispose();
      }),
  );
  yield* Effect.log(`pipeline-mcp: listening on ${String(config.port)}`);
  return yield* Effect.never;
}).pipe(
  Effect.scoped,
  Effect.tapCause((cause) =>
    Effect.sync(() => {
      console.error(`pipeline-mcp: bad config\n${Cause.pretty(cause)}`);
      process.exitCode = 1;
    }),
  ),
);

Effect.runFork(main);
