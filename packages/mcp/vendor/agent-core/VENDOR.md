# Vendored: agent-core spec tooling

A verbatim snapshot of the executable-spec tooling from the private repository `dyegorov/agent-core`,
commit `1b8698b71e4bc2705cea247be7196745bdc50640` (2026-11-20), for the MCP server package (`packages/mcp`).
pipeline can't depend on that repository, so the files are copied as they are.

- `scripts/specs/*` — spec parser, runner, comparison, fixtures, spec classes (A / flex), ratchet, test suite.
- `scripts/tool.ts` — `guard`, `allow`, `approve`, `ratchet`, `ratchet-flex` commands.
- `scripts/guard/files.ts` — hashes of guarded files (`guarded.sha256`).
- `scripts/guard/core.ts` — checks that a product pins a core commit on core main; not needed here.
- `specs/README.md`, `specs/tooling/spec-classes.md` — the spec format and the two spec classes.

Do not edit these files in place: adapt copies in the package (yarn, root `specs/`, no core-pin check).
Update by copying a newer commit and changing the commit above.
