// The `Call` command of specs/mcp/transport.md: one stateless MCP tools/call
// over the server's web handler, in process, with fakes for `given` sources.
import { Effect, Layer, type Context } from "effect";
import { HttpRouter } from "effect/http";
import type { SpecMessage, SpecOutcome } from "./outcome.js";
import { type Fields, fakesLayer, loadSource } from "./seam.js";

interface Token {
  readonly id: string;
  readonly secret: string;
}

interface Modules {
  readonly app: (
    tokens: ReadonlyArray<Token>,
  ) => Layer.Layer<never, unknown, HttpRouter.HttpRouter>;
  readonly AuditSink: Context.Key<
    never,
    { readonly write: (record: Fields) => Effect.Effect<void> }
  >;
}

const protocol = "2026-07-28";

const loadModules = async (): Promise<Modules | string> => {
  const http = await loadSource("http");
  const audit = await loadSource("audit");
  if (typeof http?.app !== "function") return "server app (src/http.ts app)";
  if (audit?.AuditSink === undefined)
    return "audit sink (src/audit.ts AuditSink)";
  return {
    app: http.app as Modules["app"],
    AuditSink: audit.AuditSink as Modules["AuditSink"],
  };
};

const isToken = (message: SpecMessage): message is SpecMessage & Token =>
  message._tag === "TokenConfigured" &&
  typeof message.id === "string" &&
  typeof message.secret === "string";

const request = (call: SpecMessage) => {
  const tool = typeof call.tool === "string" ? call.tool : "";
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": protocol,
    "mcp-method": "tools/call",
    "mcp-name": tool,
  });
  if (typeof call.authorization === "string")
    headers.set("authorization", call.authorization);
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: tool,
        arguments: call.args ?? {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocol,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
};

const unknownTool = (status: number, body: string, tool: unknown) => {
  if (status !== 200 || typeof tool !== "string") return false;
  try {
    const error = (JSON.parse(body) as { error?: { message?: unknown } }).error;
    return error?.message === `Tool '${tool}' not found`;
  } catch {
    return false;
  }
};

export const runCall = async (
  given: ReadonlyArray<SpecMessage>,
  call: SpecMessage,
  now: string | null,
): Promise<SpecOutcome> => {
  const modules = await loadModules();
  if (typeof modules === "string")
    return { _tag: "NotImplemented", message: `command Call: ${modules}` };
  const fakes = await fakesLayer(
    given.filter((m) => !isToken(m)),
    now,
  );
  if (typeof fakes === "string")
    return { _tag: "NotImplemented", message: fakes };
  const records: Array<Fields> = [];
  const sink = Layer.succeed(modules.AuditSink, {
    write: (record) => Effect.sync(() => void records.push(record)),
  });
  const { handler, dispose } = HttpRouter.toWebHandler(
    modules
      .app(given.filter(isToken))
      .pipe(Layer.provide(Layer.merge(sink, fakes))),
    { disableLogger: true },
  );
  try {
    const response = await handler(request(call));
    const body = await response.text();
    if (unknownTool(response.status, body, call.tool))
      return {
        _tag: "NotImplemented",
        message: `tool ${String(call.tool)}`,
      };
    return {
      _tag: "Events",
      events: [
        { _tag: "Responded", status: response.status, body },
        ...records.map((record) => ({
          ...record,
          _tag: "AuditRecorded",
          fields: Object.keys(record).sort(),
        })),
      ],
    };
  } finally {
    await dispose();
  }
};
