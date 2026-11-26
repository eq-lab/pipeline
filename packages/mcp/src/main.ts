// Entry point: validated env config, then the MCP endpoint on MCP_PORT.
import { Cause, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { AuditSink } from "./audit.js";
import { mcpConfig } from "./config.js";
import { grafanaLogs } from "./grafana.js";
import { app } from "./http.js";
import { RegistryLogContracts } from "./indexer-lag.js";
import { chainRpc } from "./rpc.js";
import { k8s } from "./k8s.js";
import { listen } from "./node.js";
import { httpProbes } from "./probes.js";
import { postgres } from "./postgres.js";
import { ServiceMap } from "./services.js";

const main = Effect.gen(function* () {
  const config = yield* mcpConfig;
  const sources = yield* Layer.build(
    Layer.mergeAll(
      k8s,
      ServiceMap.config,
      grafanaLogs(config.grafana),
      postgres(config.db),
      chainRpc(config.chains),
      Layer.succeed(
        RegistryLogContracts,
        new Map(
          [...config.chains].flatMap(([id, c]) =>
            c.registryLogContracts === undefined
              ? []
              : [[id, c.registryLogContracts] as const],
          ),
        ),
      ),
      httpProbes({ apiUrl: config.apiUrl, grafanaUrl: config.grafana.url }),
    ),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(
    app(config.tokens).pipe(
      Layer.provide(AuditSink.stdout),
      Layer.provide(Layer.succeedContext(sources)),
    ),
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
