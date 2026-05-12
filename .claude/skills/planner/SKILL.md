---
name: planner
description: Create an execution plan for a GitHub Issue by its number. Takes an issue number as argument. Creates the active execution plan only — does not edit issue labels and does not commit.
argument-hint: "<issue-number>"
model: opus
effort: high
---

# Planner

Use this skill when the user (or the manager subagent) asks to plan a GitHub Issue.

The user must provide an Issue number as argument. If none is provided, ask for one.

At the start of your response, output: MODEL: <your model name> | EFFORT: <your effort level>

This line MUST also appear at the start of your final return message to the caller (the summary that the Agent tool surfaces). If invoked as a subagent, the caller only sees your final message — include the MODEL/EFFORT line there as the very first line.

## Required Context

Read these before taking action:

1. `AGENTS.md`
2. The Issue itself: `gh issue view <number> -c`. Read the body and **every comment** — decisions, scope clarifications, or blockers may live there.
3. The `issue` skill: `.claude/skills/issue/SKILL.md` — for label/lifecycle conventions.

Read additional docs as needed to understand the task scope:

- `ARCHITECTURE.md`
- Relevant entries in `docs/product-specs/`, `docs/design-docs/`, `docs/references/`
- Existing code that will be affected

## Reading the Issue

```bash
gh issue view <number> -c           # body + comments
gh issue view <number> --json title,body,labels,assignees,milestone,url
```

Treat the body as the authoritative "what". Comments add scope changes / decisions since creation. Labels carry the current lifecycle state.

If the Issue references a Figma URL in its body or comments, extract it — the plan must include a Figma-driven verification step.

## Workflow

1. Read the Issue with `gh issue view <number> -c`.
2. Research thoroughly:
   - Read relevant existing code, tests, and documentation.
   - Understand the current architecture and patterns (`ARCHITECTURE.md` + relevant `docs/`).
   - Identify dependencies and constraints.
   - If a Figma link is referenced, review the Figma design.
3. Decide whether a product spec update is required. If the change is user- or agent-facing behavior, draft the spec change in `docs/product-specs/` (or note the exact section to update). For pure `chore/` or `fix/` work that does not change behavior, the exec plan alone is sufficient.
4. Create a new execution plan in `docs/exec-plans/active/`.
   - Filename: `issue-<number>-<short-slug>.md`.
5. The execution plan must cover every section in the format below, including an explicit **Open Questions** section. The `manager` reads `Open Questions` on the frontend flow to decide whether to pause for human input — leave it as `_None_` only when you genuinely have nothing to ask. Do not paper over uncertainty by guessing.
6. Every plan must include a dedicated testing step covered by **Test Strategy**.
7. Report the plan summary to the caller, including a one-line note on whether `Open Questions` is empty.

## Rules

- Do **not** edit issue labels. The manager owns lifecycle transitions.
- Do **not** assign or close the Issue.
- Do **not** commit. The manager commits the plan together with the label change.
- Do **not** implement any code. Planning only.
- Do **not** skip research. Read the relevant code and docs before writing the plan.
- Be concrete: include file paths, function/module names, and specific changes where possible.
- Keep each step actionable enough for a coder to execute without ambiguity.
- Follow `AGENTS.md` and any relevant project docs.
- Respect dependency order. If the Issue depends on unfinished work (another open Issue, an unmerged PR), note it in assumptions and risks.
- If a Figma link is referenced, include Figma-based verification in the plan.

## Execution Plan Format

```markdown
# Issue #{n}: {title}

Source: {gh issue URL}

## Scope

{what will change and what is out of scope}

## Assumptions and Risks

{what could go wrong or block progress}

## Open Questions

{one line per unresolved decision the planner could not make alone — or `_None_` if everything is clear. Do NOT guess to keep this empty; if you are unsure, list the question.}

## Implementation Steps

1. {concrete step with file paths}
2. ...

## Test Strategy

{what tests to add or update, edge cases}

## Docs to Update

{product specs, design docs, generated docs}
```

## Output

When done, report:

- Issue number and title
- Plan summary (key decisions and approach)
- Path to the execution plan file
- Whether `## Open Questions` is empty (so the manager knows whether to pause for human input on the frontend flow)
- Any blocking dependencies discovered
