---
name: ux-reviewer
description: Review a rendered Pipeline page against a Figma design and file one GitHub Issue per independent visual or structural difference. Use with either an Issue number that contains a Figma reference or an explicit app URL and Figma URL pair.
---

# UX Reviewer

Compare a live rendered page to Figma and log differences. Do not implement fixes.

Start and finish with:

```text
MODEL: <model> | EFFORT: <effort>
```

## Inputs

Accept exactly one form:

- Issue number, such as `315`. Read the Issue and comments, extract the Figma URL, and resolve the app route.
- Explicit pair: `url:<app-url> figma:<figma-url>`.

Ask for clarification if neither form is provided.

## Required Context

Read:

1. `AGENTS.md`
2. `.codex/skills/issue/SKILL.md`

When useful, read the frontend code, product specs, and design docs for the page under review.

## Workflow

1. Resolve the app URL and Figma URL.
2. Extract Figma `fileKey` and `nodeId`.
3. Load Figma design context with Figma MCP. Use returned React/Tailwind as reference only; do not copy it into the app.
4. Open the app page with browser MCP.
5. Capture a structure snapshot and full-page screenshot. Use element screenshots for uncertain regions.
6. Populate representative content if needed using project scripts/fixtures. Pipeline is Rust + TypeScript; do not use Laravel or `php artisan` flows.
7. Compare section by section:
   - section presence and order
   - headings and copy
   - typography, alignment, spacing
   - colors, backgrounds, borders, shadows
   - grids, columns, responsive structure
   - images, icons, aspect ratios
   - extra or missing elements
   - truncation and dynamic text behavior
8. File one GitHub Issue per independent difference.
9. If a parent Issue was used, comment on it with links to filed Issues.

## Figma Assets

Figma MCP asset URLs expire. Download assets locally before relying on them for review evidence or fixture data. Leave review seed data/assets in place unless the user asks otherwise.

## Filing Findings

Use frontend flow labels so the manager sees the work:

- Default: `bug,frontend,backlog`
- Mechanical and self-contained fixes: `bug,frontend,trivial,backlog`

Do not use `bug,backlog` alone for frontend UX findings.

Issue body:

```markdown
**Parent issue:** #<number>
**App URL:** <url>
**Figma:** <figma-url including node-id>

**What Figma shows**
...

**What the app renders**
...

**Suggested fix scope**
...
```

## Rules

- Do not edit app code, styles, data builders, or existing Issues.
- Only add seed data/assets when needed to make the review realistic.
- Do not roll back seed data/assets added for review.
- Always review with realistic content; empty states are not valid unless the Figma target is an empty state.
- Prefer snapshots for text/structure and screenshots for visual differences.
- Drill into child Figma nodes when a top-level frame is too broad.

## Output

Report:

- app URL reviewed
- Figma file key and node id
- seed data/assets added, with paths and a note they were left in place
- table of filed Issue numbers and finding titles
- ambiguous items not filed and why
