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

// One container env entry; `secretKeyRef` is only ever a reference, never read.
export interface EnvVar {
  readonly name: string;
  readonly value?: string;
  readonly configMapKeyRef?: { readonly name: string; readonly key: string };
  readonly secretKeyRef?: { readonly name: string; readonly key: string };
}

// One container `envFrom` source, by name only: its keys and values are not read.
export type EnvFrom =
  | { readonly secret: string }
  | { readonly configMap: string };

export interface Workload {
  readonly image: string;
  readonly env: ReadonlyArray<EnvVar>;
  readonly envFrom: ReadonlyArray<EnvFrom>;
  readonly pods: ReadonlyArray<Pod>;
}

export class Cluster extends Context.Service<
  Cluster,
  {
    readonly deployment: (
      name: string,
    ) => Effect.Effect<Option.Option<Workload>, ToolError>;
    readonly configMap: (
      name: string,
    ) => Effect.Effect<Option.Option<Record<string, string>>, ToolError>;
    readonly events: Effect.Effect<ReadonlyArray<KubeEvent>, ToolError>;
  }
>()("@pipeline/mcp/Cluster") {}
