import { parse } from "yaml"
import type { SpecMessage } from "../../src/core/spec-harness"

// ```spec blocks of a spec file (specs/README.md, "Формат"): YAML with `now`,
// `given`, `when`, `then`. YAML 1.2 core schema, so dates stay strings.
// A block with `adapter:` is an adapter contract spec instead: `adapter`,
// `given_response` (a fixture path under specs/fixtures/ or an inline value),
// `when` (a query), `then` (a domain value or `{ rejected: <reason> }`).
// A block with `query:` instead of `when:` is a query spec: `now`, `given`,
// `query` (a read-model query), `then` (the expected value, matched
// partially, or `{ rejected: <reason> }`).

export type Expected =
  | { readonly _tag: "Events"; readonly events: ReadonlyArray<SpecMessage> }
  | { readonly _tag: "Rejected"; readonly reason: string }

export interface Scenario {
  readonly now: string | null
  readonly given: ReadonlyArray<SpecMessage>
  readonly when: SpecMessage
  readonly then: Expected
}

export type Response =
  | { readonly _tag: "Fixture"; readonly path: string }
  | { readonly _tag: "Inline"; readonly value: unknown }

export type ExpectedValue =
  | { readonly _tag: "Value"; readonly value: unknown }
  | { readonly _tag: "Rejected"; readonly reason: string }

export interface AdapterScenario {
  readonly adapter: string
  readonly response: Response
  readonly when: SpecMessage
  readonly then: ExpectedValue
}

export interface QueryScenario {
  readonly now: string | null
  readonly given: ReadonlyArray<SpecMessage>
  readonly query: SpecMessage
  readonly then: ExpectedValue
}

export interface Block {
  readonly name: string
  readonly line: number
  readonly scenario: Scenario | AdapterScenario | QueryScenario | { readonly error: string }
}

export const fixturesDir = "specs/fixtures"

type Fields = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value)

class SpecError extends Error {}

const fail = (message: string): never => {
  throw new SpecError(message)
}

// `Name: { fields }`, a map with exactly one key.
const message = (value: unknown, where: string): SpecMessage => {
  if (!isRecord(value)) return fail(`${where}: expected "Name: { fields }"`)
  const entries = Object.entries(value)
  const [entry] = entries
  if (entry === undefined || entries.length !== 1) {
    return fail(`${where}: expected exactly one name, got ${entries.length}`)
  }
  const [tag, fields] = entry
  if (fields !== null && !isRecord(fields)) return fail(`${where}: ${tag} fields must be a map`)
  return { ...fields, _tag: tag }
}

const messages = (value: unknown, where: string): ReadonlyArray<SpecMessage> => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return fail(`${where}: expected a list`)
  return value.map((item, i) => message(item, `${where}[${i}]`))
}

const expected = (value: unknown): Expected => {
  if (isRecord(value) && "rejected" in value) {
    const keys = Object.keys(value)
    if (keys.length !== 1 || typeof value.rejected !== "string") {
      return fail(`then: expected "{ rejected: <reason> }"`)
    }
    return { _tag: "Rejected", reason: value.rejected }
  }
  if (!Array.isArray(value)) return fail(`then: expected a list of events or { rejected: <reason> }`)
  return { _tag: "Events", events: messages(value, "then") }
}

const known = new Set(["now", "given", "when", "then"])

const nowOf = (doc: Fields): string | null => {
  const now = doc.now
  if (now !== undefined && typeof now !== "string") return fail("now: expected an ISO time")
  return now ?? null
}

export const parseScenario = (source: string): Scenario => {
  const doc: unknown = parse(source)
  if (!isRecord(doc)) return fail("expected a map with given/when/then")
  const unknown = Object.keys(doc).filter((key) => !known.has(key))
  if (unknown.length > 0) return fail(`unknown keys: ${unknown.join(", ")}`)
  if (!("when" in doc)) return fail("missing when")
  if (!("then" in doc)) return fail("missing then")
  return {
    now: nowOf(doc),
    given: messages(doc.given, "given"),
    when: message(doc.when, "when"),
    then: expected(doc.then)
  }
}

const rejection = (value: unknown): string | null => {
  if (!isRecord(value) || !("rejected" in value)) return null
  if (Object.keys(value).length !== 1 || typeof value.rejected !== "string") {
    return fail(`then: expected "{ rejected: <reason> }"`)
  }
  return value.rejected
}

const response = (value: unknown): Response => {
  if (value === undefined) return fail("missing given_response")
  if (typeof value !== "string") return { _tag: "Inline", value }
  const path = value.trim()
  if (!path.startsWith(`${fixturesDir}/`) || path.split("/").includes("..")) {
    return fail(`given_response: a fixture path must be under ${fixturesDir}/, got "${path}"`)
  }
  return { _tag: "Fixture", path }
}

const adapterKeys = new Set(["adapter", "given_response", "when", "then"])

export const parseAdapterScenario = (doc: Fields): AdapterScenario => {
  const unknown = Object.keys(doc).filter((key) => !adapterKeys.has(key))
  if (unknown.length > 0) return fail(`unknown keys: ${unknown.join(", ")}`)
  if (typeof doc.adapter !== "string" || doc.adapter === "") return fail("adapter: expected a name")
  if (!("when" in doc)) return fail("missing when")
  if (!("then" in doc)) return fail("missing then")
  const reason = rejection(doc.then)
  return {
    adapter: doc.adapter,
    response: response(doc.given_response),
    when: message(doc.when, "when"),
    then: reason === null ? { _tag: "Value", value: doc.then } : { _tag: "Rejected", reason }
  }
}

const queryKeys = new Set(["now", "given", "query", "then"])

export const parseQueryScenario = (doc: Fields): QueryScenario => {
  const unknown = Object.keys(doc).filter((key) => !queryKeys.has(key))
  if (unknown.length > 0) return fail(`unknown keys: ${unknown.join(", ")}`)
  if (!("then" in doc)) return fail("missing then")
  const reason = rejection(doc.then)
  return {
    now: nowOf(doc),
    given: messages(doc.given, "given"),
    query: message(doc.query, "query"),
    then: reason === null ? { _tag: "Value", value: doc.then } : { _tag: "Rejected", reason }
  }
}

export const isAdapterScenario = (
  scenario: Block["scenario"]
): scenario is AdapterScenario => "adapter" in scenario

export const isQueryScenario = (scenario: Block["scenario"]): scenario is QueryScenario =>
  "query" in scenario

// Core, adapter contract or query scenario, by the `adapter` / `query` key.
const parseAny = (source: string): Scenario | AdapterScenario | QueryScenario => {
  const doc: unknown = parse(source)
  if (isRecord(doc) && "adapter" in doc) return parseAdapterScenario(doc)
  if (isRecord(doc) && "query" in doc) return parseQueryScenario(doc)
  return parseScenario(source)
}

// Fixture files referenced by the blocks of a spec, sorted, without repeats.
export const fixturePaths = (blocks: ReadonlyArray<Block>): ReadonlyArray<string> =>
  [
    ...new Set(
      blocks.flatMap((b) =>
        isAdapterScenario(b.scenario) && b.scenario.response._tag === "Fixture"
          ? [b.scenario.response.path]
          : []
      )
    )
  ].sort()

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const parseBlocks = (text: string): ReadonlyArray<Block> => {
  const lines = text.split("\n")
  const blocks: Array<Block> = []
  let heading = "(no heading)"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (line.startsWith("## ")) heading = line.slice(3).trim()
    if (line.trim() !== "```spec") continue
    const start = i
    const body: Array<string> = []
    for (i++; i < lines.length && (lines[i] ?? "").trim() !== "```"; i++) body.push(lines[i] ?? "")
    const name = blocks.some((b) => b.name === heading) ? `${heading} (line ${start + 1})` : heading
    try {
      blocks.push({ name, line: start + 1, scenario: parseAny(body.join("\n")) })
    } catch (error) {
      blocks.push({ name, line: start + 1, scenario: { error: errorText(error) } })
    }
  }
  return blocks
}
