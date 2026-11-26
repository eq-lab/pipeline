// Where the bindings reach the package (specs/README.md, "Runner"): modules of
// src/ loaded only when present, and the fakes layer for `given` sources.
import { existsSync } from "node:fs";
import { Layer } from "effect";
import type { SpecMessage } from "./outcome.js";

export type Fields = Readonly<Record<string, unknown>>;

type Fakes = (
  given: ReadonlyArray<SpecMessage>,
  now: string | null,
) => Layer.Layer<never>;

export const loadSource = async (name: string): Promise<Fields | null> => {
  const url = new URL(`../../src/${name}.ts`, import.meta.url);
  if (!existsSync(url)) return null;
  return (await import(url.href)) as Fields;
};

export const fakesLayer = async (
  sources: ReadonlyArray<SpecMessage>,
  now: string | null,
): Promise<Layer.Layer<never> | string> => {
  const fakes = (await loadSource("fakes"))?.fakes;
  if (typeof fakes === "function") return (fakes as Fakes)(sources, now);
  if (sources.length === 0) return Layer.empty;
  return `fakes (src/fakes.ts fakes) for ${sources.map((m) => m._tag).join(", ")}`;
};
