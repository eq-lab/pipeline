// Fixtures of adapter contract specs under specs/fixtures/ (specs/README.md,
// "Adapter contract specs"): .json and .yaml are parsed, the rest is text.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const fixtureExists = (root: string, path: string) =>
  existsSync(join(root, path));

export const readFixtureText = (root: string, path: string) =>
  readFileSync(join(root, path), "utf8");

export const loadFixture = (root: string, path: string): unknown => {
  const text = readFixtureText(root, path);
  if (path.endsWith(".json")) return JSON.parse(text) as unknown;
  if (path.endsWith(".yaml") || path.endsWith(".yml"))
    return parse(text) as unknown;
  return text;
};
