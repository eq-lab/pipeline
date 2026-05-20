---
name: planner
description: Create an execution plan for a Pipeline GitHub Issue by number. Use when Codex is asked to plan an Issue, write docs/exec-plans/active/issue-number-slug.md, research the relevant code/docs/Figma context, identify open questions, and prepare work for the coder without editing issue labels or committing.
---

# Planner

Plan exactly one GitHub Issue. Produce an active execution plan only; do not implement code, edit lifecycle labels, assign or close the Issue, commit, or push.

Start and finish with:

```text
MODEL: <model> | EFFORT: <effort>
```

## Required Context

1. Read `AGENTS.md`.
2. Read the Issue body and every comment:

   ```bash
   gh issue view <number> -c
   gh issue view <number> --json title,body,labels,assignees,milestone,url
   ```

3. Read `.codex/skills/issue/SKILL.md` for labels and lifecycle rules.
4. Read `ARCHITECTURE.md` and only the relevant docs/code needed for the Issue.

If the Issue references a Figma URL, extract the file key and node id, call Figma MCP for design context, and include Figma-based verification in the plan.

## Workflow

1. Confirm the user supplied an Issue number. Ask for one if missing.
2. Research the existing implementation, tests, docs, and architecture boundaries affected by the Issue.
3. Decide whether docs must change. User-facing or agent-facing behavior changes usually require updates in `docs/product-specs/`, `docs/design-docs/`, `ARCHITECTURE.md`, or generated docs.
4. Create `docs/exec-plans/active/issue-<number>-<short-slug>.md`.
5. Include every required section below. `## Open Questions` must be present. Use `_None_` only when there are genuinely no unresolved decisions.
6. Report the plan path, summary, open question status, and blockers.

## Plan Format

```markdown
# Issue #<number>: <title>

Source: <GitHub issue URL>

## Scope

<what will change and what is out of scope>

## Assumptions and Risks

<risks, dependencies, constraints, and likely failure modes>

## Open Questions

<one unresolved question per line, or `_None_`>

## Implementation Steps

1. <concrete step with file paths, modules, functions, and expected behavior>
2. ...

## Test Strategy

<tests to add/update, commands to run, edge cases, and manual checks>

## Docs to Update

<specific docs/specs/generated references, or `_None_`>
```

## Rules

- Treat the Issue body as the authoritative "what"; comments may add later decisions.
- Be concrete enough for a coder to execute without rediscovering the task.
- Respect dependency direction from `ARCHITECTURE.md`.
- Do not skip research. Name the files and modules involved.
- If dependencies are unfinished or blocked, document them under assumptions and risks.
- Do not hide uncertainty to avoid an approval gate; list real open questions.

## Output

Report:

- Issue number and title
- Plan summary
- Plan file path
- Whether `## Open Questions` is empty
- Blocking dependencies or risks
