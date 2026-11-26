// node:http adapter for a web handler (docs/design-docs/mcp-test-env.md,
// "Architecture"): the only I/O of the transport.
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";

type Handler = (request: Request) => Promise<Response>;

const serve = async (
  handler: Handler,
  req: IncomingMessage,
  res: ServerResponse,
) => {
  const abort = new AbortController();
  res.on("close", () => {
    abort.abort();
  });
  try {
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const response = await handler(
      new Request(`http://localhost${req.url ?? "/"}`, {
        method: req.method ?? "GET",
        headers: Object.entries(req.headersDistinct).flatMap(([name, values]) =>
          (values ?? []).map((value): [string, string] => [name, value]),
        ),
        body: hasBody ? (Readable.toWeb(req) as ReadableStream) : null,
        duplex: "half",
        signal: abort.signal,
      }),
    );
    res.writeHead(response.status, [...response.headers].flat());
    if (response.body !== null)
      for await (const chunk of response.body) res.write(chunk);
    res.end();
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
};

export const listen = (handler: Handler, port: number): Server =>
  createServer((req, res) => {
    void serve(handler, req, res);
  }).listen(port);
