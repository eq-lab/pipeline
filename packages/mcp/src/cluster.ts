// The `Cluster` port (docs/design-docs/mcp-test-env.md, "Architecture"): read
// only, the test namespace only; `k8s.ts` is the adapter, `fakes.ts` the fake.
import { Context, type Effect, type Option } from "effect";
import type { ToolError } from "./errors.js";

export interface Pod {
  readonly name: string;
  readonly phase: string;
  readonly ready: boolean;
  readonly restarts: number;
  readonly startedAt: string;
}

export interface KubeEvent {
  readonly object: string;
  readonly reason: string;
  readonly message: string;
  readonly ts: string;
}

export interface Workload {
  readonly image: string;
  readonly pods: ReadonlyArray<Pod>;
}

export class Cluster extends Context.Service<
  Cluster,
  {
    readonly deployment: (
      name: string,
    ) => Effect.Effect<Option.Option<Workload>, ToolError>;
    readonly events: Effect.Effect<ReadonlyArray<KubeEvent>, ToolError>;
  }
>()("@pipeline/mcp/Cluster") {}
