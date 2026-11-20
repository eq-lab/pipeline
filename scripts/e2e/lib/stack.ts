// Paths and files of a stack under $E2E_HOME/stacks/<tag>/; see docs/e2e.md.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const e2eHome = () => process.env.E2E_HOME || join(homedir(), ".cache", "pipeline-e2e");

export function stackDir(tag: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag)) throw new Error(`invalid tag "${tag}"`);
  return join(e2eHome(), "stacks", tag);
}

export function readJson<T>(path: string): T | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
