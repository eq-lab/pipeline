# Frontend catalogues

Internal catalogues of shared frontend code. The rules that govern what belongs here are in [`docs/FRONTEND.md` → Code structure rules](../FRONTEND.md#code-structure-rules).

- [Utils](./utils.md) — shared helpers (formatters, parsers, predicates, mock resolvers, etc.). Every entry is unit-tested.
- [Hooks](./hooks.md) — reused React hooks. Component-local hooks (one component owner, e.g. `useStakeCard`) are intentionally excluded.

## How to add an entry

1. Land the util or hook in code with its test(s).
2. In the same commit, add a row to the relevant table below: name + import path + one-line description. Keep entries sorted alphabetically by name.
3. If the entry is removed or moved, update the catalogue in the same commit that touches the code.

A reviewer should be able to scan these tables and immediately know whether a helper already exists before writing a new one.
