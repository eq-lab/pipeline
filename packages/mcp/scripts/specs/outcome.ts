// What the bindings return to the spec runner (specs/README.md, "Format").

export interface SpecMessage {
  readonly _tag: string;
  readonly [field: string]: unknown;
}

type Rejected = { readonly _tag: "Rejected"; readonly reason: string };
type NotImplemented = {
  readonly _tag: "NotImplemented";
  readonly message: string;
};

export type SpecOutcome =
  | { readonly _tag: "Events"; readonly events: ReadonlyArray<SpecMessage> }
  | Rejected
  | NotImplemented;

export type ValueOutcome =
  | { readonly _tag: "Value"; readonly value: unknown }
  | Rejected
  | NotImplemented;
