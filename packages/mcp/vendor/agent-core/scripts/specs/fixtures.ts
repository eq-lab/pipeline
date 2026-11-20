import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"

// Fixtures of adapter contract specs: recorded API responses under
// specs/fixtures/. `.json` and `.yaml`/`.yml` are parsed, anything else (CSV,
// TSV, XML) is passed to the adapter as text.

export const fixtureExists = (root: string, path: string) => existsSync(join(root, path))

export const readFixtureText = (root: string, path: string) => readFileSync(join(root, path), "utf8")

export const loadFixture = (root: string, path: string): unknown => {
  const text = readFixtureText(root, path)
  if (path.endsWith(".json")) return JSON.parse(text) as unknown
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return parse(text) as unknown
  return text
}
