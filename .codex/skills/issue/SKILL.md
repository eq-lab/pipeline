---
name: issue
description: Create, inspect, and manage GitHub Issues for the Pipeline repository. Use when Codex needs to create a tracked task, check duplicate issues before work, start or transition issue lifecycle labels, comment on scope decisions or blockers, or understand Pipeline issue labels and manager flow selection.
---

# Issue

GitHub Issues are the canonical task tracker for Pipeline. Every implementation task should have an Issue, and each open Issue has exactly one status label that describes its lifecycle state.

## Required Context

Read `AGENTS.md` before making lifecycle changes. Check existing Issues before creating new ones:

```bash
gh issue list --state open --search "<keywords>"
gh issue view <number> -c
```

## Create An Issue

1. Check for duplicates in open Issues.
2. Write the body with the problem, why it matters, affected areas, and blockers. For bugs, include observed and expected behavior.
3. Create it with at least one type label, exactly one status label, and exactly one flow label when it is development work.

Use `backlog` when ready to work, or `blocked` when it cannot proceed:

```bash
gh issue create --title "<title>" --label "<type>,<flow>,backlog" --body "<body>"
gh issue create --title "<title>" --label "<type>,<flow>,blocked" --body "<body explaining the blocker>"
```

Discussion, tracking, and question Issues may omit the flow label. Development Issues must use exactly one of `backend` or `frontend`.

## Start Existing Work

1. Read the Issue and all comments:

   ```bash
   gh issue view <number> -c
   gh issue view <number> --json title,body,labels,assignees,url
   ```

2. If it is assigned to someone else and has an in-flight status label, stop and ask the user before taking over.
3. If it has `blocked`, stop until the blocker is resolved.
4. Assign yourself:

   ```bash
   gh issue edit <number> --add-assignee @me
   ```

5. Move `backlog` to the correct first in-flight state:

   ```bash
   gh issue edit <number> --remove-label backlog --add-label planning
   ```

Use `executing` instead of `planning` only for trivial frontend work that intentionally skips planning.

## Lifecycle Labels

Status labels are mutually exclusive:

| Label | Meaning |
| --- | --- |
| `backlog` | Ready, not started |
| `blocked` | Waiting on an external dependency or decision |
| `planning` | Execution plan is being produced |
| `planned` | Plan exists, awaiting implementation or approval |
| `executing` | Implementation in progress |
| `executed` | Implementation complete, awaiting testing or completion |
| `testing` | Manual or UX testing in progress |
| `tested` | Tested, awaiting final PR/merge handling |

Transitions are always remove-then-add:

```bash
gh issue edit <number> --remove-label <old> --add-label <new>
```

The `manager` skill owns lifecycle transitions during full workflows. Planner, coder, and UX tester skills must not edit parent Issue labels.

## Flow Labels

| Label combination | Manager flow |
| --- | --- |
| `backend` | Backend flow: plan, hard approval gate, implement, complete PR for human merge |
| `frontend` | Frontend flow: plan, pause only for open questions, implement, UX test if Figma applies |
| `frontend` + `trivial` | Trivial frontend flow: no plan, implement directly, manager may admin-merge after CI is green |

Any dev Issue must carry exactly one of `backend` or `frontend`. If unsure, use `backend`.

## Type And Modifier Labels

Common labels:

| Label | Use |
| --- | --- |
| `bug` | Broken or incorrect behavior |
| `enhancement` | New feature or improvement |
| `documentation` | Docs-only work |
| `question` | Needs discussion |
| `priority` | Higher priority |
| `trivial` | Modifier for self-contained frontend-only fixes |

## Comments

Use comments for decisions, scope changes, blockers, and links to bugs discovered during testing:

```bash
gh issue comment <number> --body "<comment>"
```

Do not close a development Issue manually when a PR body contains `Closes #<number>`; GitHub closes it on merge.
