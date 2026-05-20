---
name: ux-tester
description: Manually UX-test Pipeline with browser MCP tooling. Use for issue-scoped UI testing, regression passes, updating docs/STORIES.md test cases, filing bug Issues from manual QA, and updating docs/QUALITY_SCORE.md after exercising the app in Chrome/Playwright/DevTools.
---

# UX Tester

Manually validate Pipeline UI behavior with a real browser. Do not edit lifecycle labels, close parent Issues, commit, or push.

Start and finish with:

```text
MODEL: <model> | EFFORT: <effort>
```

## Modes

- `update cases`: refresh `docs/STORIES.md` from completed Issues and plans.
- `issue:<number>`: test one completed or in-flight Issue.
- `regression`: run a practical regression pass across documented stories.

Ask for clarification if no mode is clear.

## Required Context

Read:

1. `AGENTS.md`
2. `.codex/skills/issue/SKILL.md`
3. `docs/STORIES.md` (create it if missing)
4. `docs/QUALITY_SCORE.md`

For `issue:<number>`, also read:

```bash
gh issue view <number> -c
gh issue view <number> --json title,body,labels,assignees,url
```

Open the matching plan from `docs/exec-plans/completed/` or `docs/exec-plans/active/`.

## Browser Workflow

Always drive the browser for UI behavior. Prefer Chrome DevTools MCP when available; Playwright MCP is acceptable when it is the active browser tool.

1. Resolve the app URL from README, `package.json`, package docs, or `docs/user-docs/_config.yml`. Pipeline frontend is typically `http://localhost:3000`.
2. Start or reuse the dev server when needed.
3. Navigate to target routes.
4. Interact like a user: click, fill, hover, submit, navigate, resize.
5. Use accessibility snapshots for structure and screenshots for visual evidence.
6. Inspect console and network messages when diagnosing failures.

## Update Cases

1. Read recent closed Issues:

   ```bash
   gh issue list --state closed --limit 50 --json number,title,labels,closedAt
   ```

2. Inspect completed plans for shipped user-facing behavior.
3. Add missing story coverage to `docs/STORIES.md`.
4. Include traceability: Issue number, Issue URL, and completed plan path.
5. Keep cases concrete: actor, setup, steps, expected result.

Do not add speculative coverage for backlog or incomplete work unless explicitly asked.

## Issue-Scoped Testing

1. Resolve scope from Issue comments, labels, plan, and related stories.
2. Build a focused checklist.
3. Exercise each flow in the browser.
4. Record pass, fail, and blocked results.
5. File new defects as GitHub Issues.
6. Update `docs/QUALITY_SCORE.md`.

## Regression Testing

1. Read all testable stories from `docs/STORIES.md`.
2. Group by auth/access, shell/navigation, and feature flows.
3. Exercise meaningful acceptance checks, not just route loads.
4. File new defects and update `docs/QUALITY_SCORE.md`.

## Bug Logging

File defects as new Issues. Include the right flow label so the manager can pick them up. For frontend UX bugs, use `bug,frontend,backlog` by default; add `trivial` only for clearly mechanical fixes.

```bash
gh issue create --title "<short imperative>" --label "bug,frontend,backlog" --body "<body>"
```

Issue body should include:

```markdown
**Linked issue:** #<parent-number>
**Source story:** <story id, if any>
**Plan:** <docs/exec-plans/... path, if any>

**Severity:** critical | high | medium | low

**Reproduction steps**
1. ...

**Expected result**
...

**Actual result**
...

**Environment**
- App URL:
- Browser:
- Date:
```

Comment on the parent Issue with the new bug number.

Severity:

- `critical`: blocks shipping, security/data loss, or spec contract violation.
- `high`: primary UX or content is materially wrong.
- `medium`: minor UX, copy, styling, or edge case.
- `low`: polish.

## Quality Score

After meaningful issue or regression testing, update `docs/QUALITY_SCORE.md` with:

- date
- scope
- story coverage
- pass/fail/blocked summary
- bugs filed or confirmed
- score and short reasoning

Score conservatively when evidence is incomplete.

## Output

Report:

- scope tested
- cases executed
- passes, failures, blocked items
- bug Issues filed with severity
- quality score updates
- setup notes or blockers
