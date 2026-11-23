# Executable specs

Behaviour of the MCP server package (`packages/mcp`), written as examples. Specs are the only tests of that package: agents do not write tests, they describe behaviour as specs. The runner, the ratchet and the hash guard were adapted from agent-core (commit `1b8698b`); this repository does not depend on it.

A spec describes behaviour, not code layout: no paths into `src/`. An approved spec changes only through a new approval.

## Format

A file is `specs/<area>/<topic>.md`. A scenario is a `##` heading, one or two sentences of why, and a block:

```spec
given:                # past events, in order
  - CheckScheduled: { id: C1, due: 2026-02-01 }
when:                 # one command
  CancelCheck: { actor: human, id: C1 }
then:                 # new events in order, or a rejection
  - CheckCancelled: { id: C1 }
# then: { rejected: <reason> }
```

- `now:` (optional): the scenario's current time, ISO.
- The event list in `then` matches as a whole: the same events in the same order, nothing extra. Fields inside an event match partially: listed fields must be equal, others are ignored. Numbers match within 1e-9.
- YAML 1.2 core schema: dates stay strings.

Commands bound today: `Call` (`specs/mcp/transport.md`). The runner sends one stateless MCP `tools/call` request (protocol 2026-07-28) to the server's web handler in process, no network: `TokenConfigured` events configure the clients, every other `given` event goes to the fakes, and the audit records are collected. `then` gets `Responded: { status, body }` followed by one `AuditRecorded` per record, with `fields` the record's sorted key names. It is not implemented (backlog) while the server, the fakes for a `given` source, or the called tool do not exist yet. Other commands are not implemented.

What `Call` needs from the package: `src/http.ts` exports `app(tokens)` (the HTTP router layer), `src/audit.ts` exports the `AuditSink` service, and `src/fakes.ts` exports `fakes(given)`, a layer of fakes for the source events of `given` (sources not mentioned answer normally).

The bindings return promises; the runner awaits them one scenario at a time.

## Adapter contract specs

How a raw response of an external API becomes a value. A file is `specs/adapters/<adapter>.md`, responses are fixtures under `specs/fixtures/<adapter>/` (`.json` and `.yaml` are parsed, anything else is passed to the adapter as text). A ```spec block with the key `adapter:`:

```spec
adapter: loki                               # adapter name
given_response: specs/fixtures/loki/x.json  # a fixture path or the response inline
when:                                       # one request to the adapter
  Lines: { limit: 100 }
then:                                       # the value, or a rejection
  truncated: false
# then: { rejected: empty }
```

- The runner passes the scenario to `runAdapterSpec(adapter, response, when)`; no network is used.
- `then` matches partially, like event fields.
- Fixtures are part of the spec: the approval hash in `specs/approved` covers the file text and every fixture it references.

## Queries

A ```spec block with the key `query:` instead of `when:`; the runner calls `runQuery(given, query, now)`.

```spec
query:
  ClampLimit: { limit: 1000, max: 500, fallback: 100 }
then:
  limit: 500
# then: { rejected: invalid_query }
```

Queries bound today: `ClampLimit: { limit?, max, fallback }` (`limit`). An unknown query is not implemented (backlog).

## Statuses

Every file starts with the line `Status: draft` or `Status: approved`.

- **draft**: an agent's draft, waiting for human review; may be red.
- **approved**: agreed by a human; its hash (with fixtures) is in `specs/approved`; changes only with a new approval. A red scenario that has never been green is backlog: shown as todo, it does not fail the check.

## Ratchet

`specs/passing` has one line `<path>#<scenario heading>` per approved scenario that has ever been green (sorted). The check fails when:

- a scenario listed in `specs/passing` turns red: a regression, fix the code;
- an approved scenario is green but not in `specs/passing`: run `yarn spec:ratchet` and commit the file;
- a line of `specs/passing` names no approved scenario.

Rules for agents: write no tests; do not edit files with `Status: approved` (outside `specs/flex/`) or their fixtures; do not touch `specs/approved`; do not remove lines from `specs/passing`; never run `yarn spec:approve` or `yarn spec:ratchet`. Agents add lines of class B scenarios (`specs/flex/`) themselves with `yarn workspace @pipeline/mcp spec:ratchet-flex` (class B only: it neither adds nor touches class A lines).

Summary line of the check: `exec specs: approved N green, N red (backlog), N regressions; draft N green, N red`.

## Spec classes

Every spec is a requirement: the ratchet and the regression check apply to all of them. The classes differ in who may change a spec (`specs/tooling/spec-classes.md`).

- **A**: everything outside `specs/flex/`: money, rights and roles, data and deletion, security, external actions, approvals and confirmations. A human approves (hash in `specs/approved`).
- **B**: everything else (UI, thresholds and parameters, heuristics and ranking, service formats and schedules), files under `specs/flex/` (subfolders allowed). An agent edits, adds and removes scenarios in the same PR as the code; there is no hash in `specs/approved`, and `yarn spec:approve` refuses such a path. `yarn spec:ratchet` drops the `specs/passing` lines of removed class B scenarios. A path under `specs/flex/` in `specs/approved` is an error (`class_mismatch`): only the owner changes a file's class.
- A file is entirely one class. When in doubt, class A.

## Runner

The tooling lives in `packages/mcp/scripts/` (`specs/*`, `guard/files.ts`, `tool.ts`); paths of specs resolve from the repository root. What the specs run against is `packages/mcp/scripts/specs/bindings.ts` (`export const check = makeCheck({ runSpec, runQuery, runAdapterSpec })`), and `packages/mcp/test/specs.test.ts` runs the suite under `node:test`.

| Command | Who | What |
|---|---|---|
| `yarn spec:approve specs/<area>/<topic>.md ...` | human, devops | marks specs approved and records their hashes in `specs/approved` |
| `yarn spec:ratchet` | human, devops | records every green approved scenario in `specs/passing` |
| `yarn workspace @pipeline/mcp spec:ratchet-flex` | agent | the same for `specs/flex/` only |
| `yarn workspace @pipeline/mcp guard` | check | guarded files match `packages/mcp/guarded.sha256` |
| `yarn workspace @pipeline/mcp specs` | check | runs every spec with the ratchet |
| `yarn workspace @pipeline/mcp tests:allow <path>...` | human | records the current hash of a guarded file or entry |

`spec:approve` and `spec:ratchet` write only under `specs/`, and work after `yarn workspaces focus @pipeline/mcp` alone.

The guard covers, inside `packages/mcp`, everything under `scripts/`, every test file and test directory, and the entry `package.json#scripts` (how the package runs its checks). Each must be listed in `packages/mcp/guarded.sha256` with its current hash (`<sha256>  <path>`, the `sha256sum` format). Changing one without a new `tests:allow` fails the check.
