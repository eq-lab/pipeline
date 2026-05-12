---
name: issue
description: Create or manage GitHub Issues for task tracking — use before starting any work
allowed-tools: Bash(gh *), Bash(git *)
---

# lint:docs skip-spec-ref

GitHub Issues is the canonical task tracker for this project. Every piece of work must have an Issue, and the **lifecycle of a task is expressed as a status label on its Issue** — there is no separate `tasks.json`.

## Creating a new issue

1. Check [GitHub Issues](https://github.com/eq-lab/pipeline/issues) for duplicates first.
2. Write a clear description: what needs to happen, why, and what areas are affected. For bugs, include observed vs expected behavior and location. Use a HEREDOC for the body to preserve formatting.
3. Create the issue with at least one type label **and exactly one entry-point status label** — either `backlog` (ready to pick up) or `blocked` (cannot proceed yet; explain the blocker in the body):
   `gh issue create --title "<title>" --label "<type>,backlog" --body "<body>"`
   `gh issue create --title "<title>" --label "<type>,blocked" --body "<body explaining the blocker>"`
4. If starting work immediately, follow "Starting work on an existing issue" below.

## Starting work on an existing issue

1. Check the issue's current state and comments with `gh issue view <number> -c`.
   - If it already has any in-flight status label (`planning`, `planned`, `executing`, `executed`, `testing`, `tested`) **and** is assigned to someone other than you, **stop and tell the user** — someone may already be working on it. Do not take over without explicit confirmation.
   - If it has the `blocked` label, **stop** — resolve the blocker first (update the body/comments and transition `blocked` → `backlog` once the blocker is gone) before starting work.
   - Read any comments — they may contain decisions, context, or scope changes since the issue was created.
2. Assign the issue to yourself: `gh issue edit <number> --add-assignee @me`
3. Move the status label from `backlog` to the first lifecycle state (`planning` for full workflows, `executing` for trivial fixes that need no plan):
   `gh issue edit <number> --remove-label backlog --add-label planning`
4. Create a feature branch (`feat/`, `fix/`, `docs/`, `chore/` prefix).
5. Create an empty commit and push: `git commit --allow-empty -m "chore: start work on #<number>"` then `git push -u origin <branch>`.
6. Check if a PR already exists: `gh pr list --head <branch> --state open`. If none, open a draft PR: `gh pr create --draft --title "<issue title>" --body "Closes #<number>"`.

## Reading and commenting on issues

- **View an issue with comments:** `gh issue view <number> -c`
- **View comments via API** (for structured data): `gh api repos/eq-lab/pipeline/issues/<number>/comments`
- **Add a comment:** `gh issue comment <number> --body "<comment>"`

Use comments to log decisions, scope changes, or blockers discovered during work. Keep the issue body as the source of truth for "what" — use comments for "updates since creation."

## Transitioning lifecycle status

A status label transition is always a remove-then-add pair:

```bash
gh issue edit <number> --remove-label <old> --add-label <new>
```

Only one status label may be set at a time. The `manager` skill drives most of these transitions automatically. When you transition manually, follow the same order.

To mark an issue done, close it — no `completed` label is used:

```bash
gh issue close <number>
```

A merged PR with `Closes #<number>` in its body closes the issue automatically.

## Issue conventions

- **Issue title format:** Short, descriptive noun phrase or imperative.
- Every issue must have at least one **type label** and exactly one **status label** while open.
- Anyone (human or agent) can create issues. Check for duplicates before adding.
- Use `gh issue create`, `gh issue edit`, and `gh issue close` to manage issues from the CLI.

## Labels

**Status labels** (mutually exclusive — pick one per open issue; closed = done):

| Label        | Meaning                                                              |
|--------------|----------------------------------------------------------------------|
| `backlog`    | Ready to pick up, not yet started                                    |
| `blocked`    | Cannot proceed — waiting on an external dependency or decision; explain in the body |
| `planning`   | Manager is producing an execution plan                               |
| `planned`    | Execution plan exists, awaiting implementation (and human approval)  |
| `executing`  | Implementation in progress                                           |
| `executed`   | Implementation complete, awaiting test                               |
| `testing`    | Manual / UX testing in progress                                      |
| `tested`     | Tested, awaiting close                                               |

Every newly created Issue must enter the lifecycle as either `backlog` or `blocked`. `blocked` Issues are transitioned to `backlog` once the blocker clears. An Issue may also be moved back to `blocked` from any in-flight state if it gets stuck — in that case strip the current in-flight label and add `blocked`, and note the cause in a comment.

**Flow labels** (the `manager` reads these to choose a workflow):

| Label combination       | Manager flow                                                              |
|-------------------------|---------------------------------------------------------------------------|
| `backend`               | **Backend** — strict spec/plan/approve/implement/test workflow            |
| `frontend`              | **Frontend** — plan, approval gate only on Open Questions, ux-tester if a Figma exists |
| `frontend` + `trivial`  | **Trivial frontend** — no planning, no approval, `coder` on opus + effort high, lint+build+test only, no ux-tester |

Any Issue intended for dev work **must** carry exactly one of `backend` or `frontend` — the two are mutually exclusive. `trivial` is a modifier that only takes effect when combined with `frontend`; on a backend Issue it has no meaning. Issues with no flow label are not dev work (discussion, questions, tracking, etc.) and the `manager` will skip them. If you cannot confidently classify dev work as frontend, label it `backend`. See [`manager/SKILL.md`](../manager/SKILL.md) for the per-flow specification.

**Type / modifier labels** (combine with a status label):

| Label           | When to use                                                       |
|-----------------|-------------------------------------------------------------------|
| `priority`      | High priority — address before other backlog items                |
| `bug`           | Something is broken or behaving incorrectly                       |
| `enhancement`   | New feature or improvement to existing functionality              |
| `documentation` | Docs-only change (specs, guides, generated docs)                  |
| `question`      | Needs discussion or clarification before work begins              |
