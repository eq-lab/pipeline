---
name: pr
description: Create a pull request for the current branch
allowed-tools: Bash(gh *), Bash(git *)
---

# lint:docs skip-spec-ref

# Pull Request

Create or finalize a PR for the current feature branch.

## Steps

1. **Gather context.** Run in parallel:
   - `git log main..HEAD --oneline` — commits on this branch
   - `git diff main...HEAD --stat` — files changed
   - `gh pr list --head $(git branch --show-current) --state open` — check for existing PR

2. **Analyze changes.** Read the commits and diff to understand what was done and why. Check for a linked GitHub Issue (look for `#<number>` in commit messages or branch name).

3. **Draft PR body.** Use this format:

```
## Summary
<1-3 bullet points describing what changed and why>

## Test plan
- [ ] <how to verify the change works>

Closes #<issue-number>
```

4. **Create or update the PR.**
   - If a draft PR already exists, update its title and body: `gh pr edit <number> --title "<title>" --body "<body>"`
   - If no PR exists, create one: `gh pr create --title "<title>" --body "<body>"`
   - Mark ready for review if it was a draft: `gh pr ready <number>`

5. **Report** the PR URL to the user.

## Rules

- PR title: short (under 70 chars), imperative mood
- Always include `Closes #<issue>` if there's a linked issue
- Never merge — only create/update the PR. Merging requires explicit human approval.
