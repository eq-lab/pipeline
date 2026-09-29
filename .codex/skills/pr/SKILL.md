---
name: pr
description: Create or update a pull request for the current Pipeline feature branch. Use when asked to prepare a PR, draft its summary and verification, or mark an existing draft ready for review.
---

# Pull Request

Read `AGENTS.md`, the current branch, its diff and commits against `main`, and any linked Issue and comments. Check `gh pr list --head <branch> --state open` before creating a PR. Never open a PR from `main`.

Write an imperative title and a concise body with what changed, why, verification commands/results, and `Closes #<issue>` when a linked work Issue should close on merge. Use a temporary body file with `gh pr create --body-file` or `gh pr edit --body-file` to preserve newlines. Preserve useful existing PR context when updating. Mark a draft ready only when required work and checks for that flow are complete.

Report the PR URL and remaining checks or review state. Do not merge; merge authority follows `AGENTS.md` and the manager flow.
