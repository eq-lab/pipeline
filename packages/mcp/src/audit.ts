// Audit record of one request (specs/mcp/transport.md): exactly these five
// fields, never the token, the arguments or the result.
import { Console, Context, Effect, Layer } from "effect";

export interface AuditRecord {
  readonly tokenId: string | null;
  readonly tool: string | null;
  readonly durationMs: number;
  readonly resultBytes: number;
  readonly outcome: string;
}

// Per request, the reason of the tool's rejection; set by the tool handlers
// (`tools.ts`), read by the audit middleware (`http.ts`), which provides a
// fresh holder to each request.
export const ToolReason = Context.Reference<{ reason: string | null }>(
  "@pipeline/mcp/ToolReason",
  { defaultValue: () => ({ reason: null }) },
);

export class AuditSink extends Context.Service<
  AuditSink,
  { readonly write: (record: AuditRecord) => Effect.Effect<void> }
>()("@pipeline/mcp/AuditSink") {
  static readonly stdout = Layer.succeed(
    AuditSink,
    AuditSink.of({
      write: (record) => Console.log(JSON.stringify({ audit: record })),
    }),
  );
}
