# Frontend catalogues

Internal catalogues of shared frontend code. The rules that govern what belongs here are in [`docs/FRONTEND.md` → Code structure rules](../FRONTEND.md#code-structure-rules).

- [Utils](./utils.md) — shared helpers (formatters, parsers, predicates, mock resolvers, etc.). Every entry is unit-tested.
- [Hooks](./hooks.md) — reused React hooks. Component-local hooks (one component owner, e.g. `useStakeCard`) are intentionally excluded.

## Area specs

Architecture and behavior specs extracted from source comments per [`docs/FRONTEND.md` → Code structure rules, rule 6](../FRONTEND.md#code-structure-rules). Source hooks/components keep only code-level comments plus a one-line pointer into these docs.

- [Wallet flows](./wallet-flows.md) — chain-agnostic deposit / withdraw / stake adapters (`packages/frontend/src/wallet/**`).
- [Dashboard & LP components](./dashboard-components.md) — LP-facing components and routes (`packages/frontend/src/components|routes/**`).
- [Trustee flows](./trustee-flows.md) — Trustee admin panel modules (`packages/trustee/src/**`).
- [UI components](./ui-components.md) — shared component library (`packages/ui/src/**`): surface primitives, Figma bindings, design-decision records.
- [Error handling](./error-handling.md) — the generic-message + details-dialog error UX pattern, the `toUserError` mapping table, and the adopted-surface inventory.

## How to add an entry

1. Land the util or hook in code with its test(s).
2. In the same commit, add a row to the relevant table below: name + import path + one-line description. Keep entries sorted alphabetically by name.
3. If the entry is removed or moved, update the catalogue in the same commit that touches the code.

A reviewer should be able to scan these tables and immediately know whether a helper already exists before writing a new one.
