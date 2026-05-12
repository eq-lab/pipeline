---
name: ux-reviewer
description: Review a rendered application page against its Figma design and file one GitHub Issue per visual/structural difference found. Accepts either an Issue number (resolves the app URL + Figma URL from the Issue body/comments) or a direct pair of app URL and Figma URL.
argument-hint: "<issue-number> | url:<app-url> figma:<figma-url>"
model: opus
effort: high
---

# UX-Reviewer

Use this skill when the user asks to review a rendered page against its Figma design and log each difference as a new GitHub Issue.

At the start of your response, output: MODEL: <your model name> | EFFORT: <your effort level>

This line MUST also appear at the start of your final return message to the caller. If invoked as a subagent, the caller only sees your final message — include the MODEL/EFFORT line there as the very first line.

## Arguments

Accept exactly one of the following input forms:

1. **An Issue number** (e.g. `42`). The Issue must exist (`gh issue view 42`). Extract the Figma URL from the Issue body/comments. Resolve the app URL from the route the Issue describes — if unclear, ask the user.
2. **An explicit pair**: `url:<app-url> figma:<figma-url>` — for example `url:http://localhost:3000/lenders figma:https://www.figma.com/design/.../?node-id=22-326`.

If neither form is provided, ask the user.

## Required Context

Read these before taking action:

1. `AGENTS.md`
2. The `issue` skill: `.claude/skills/issue/SKILL.md` — for label conventions when filing new Issues.

Read additional context only as needed:

- The frontend code that renders the page under review (templates, components, data builders).
- Related product specs (`docs/product-specs/`) and design docs (`docs/design-docs/`) for intent.

## Workflow

1. **Resolve inputs**
   - If an Issue number was passed: `gh issue view <number> -c`, grab the Figma URL from body or comments, and map the Issue's page to an absolute app URL.
   - If a `url:` / `figma:` pair was passed: use them directly.
   - Extract the Figma `fileKey` and `nodeId` from the Figma URL.

2. **Load the Figma design**
   - Call `mcp__figma__get_design_context` with the `fileKey` and `nodeId`. Keep the returned code, asset URLs, and screenshot in context. Treat returned React/Tailwind code as a *reference only* — do not copy styling verbatim.
   - Optionally call `mcp__figma__get_screenshot` for specific child nodes when a section needs a closer look.

3. **Open the app page**
   - Reuse a running Chrome DevTools session if available; otherwise start one.
   - If navigation reports a stale-lock error, run `pkill -f "chrome-devtools-mcp/chrome-profile"` once, then retry.
   - `mcp__chrome-devtools__navigate_page` to load the app URL, then `take_snapshot` for structure and `take_screenshot` with `fullPage: true` for visual reference.

4. **Populate realistic content if needed**
   - If the page renders dynamic data and the current state is empty/unrealistic, populate representative content using project-appropriate tooling (seed scripts, dev fixtures, smart-contract dev mocks, etc.). Pipeline is a Rust + TS monorepo, not a Laravel app — there is **no Filament admin and no `php artisan` flow**. Look in `scripts/` and `packages/` for existing seed/fixture commands.
   - Download Figma image assets locally before referencing them — Figma asset URLs expire after ~7 days.
   - Only add data; do **not** change schema, code, or styling in this step.
   - Any data and assets you add are intended to persist for future reviews — do not roll them back.

5. **Compare section-by-section**
   - Walk top to bottom. For each Figma section, compare against the matching part of the rendered app. Note differences in:
     - presence/absence of sections
     - ordering of sections
     - headings (including hardcoded ones not in Figma)
     - typography (weight, size, alignment)
     - colors, backgrounds, shadows, borders, card vs plain styling
     - grid/column counts and spacing
     - text content rendering (paragraph splitting, truncation)
     - images present, aspect ratio, position
     - extra elements present in the app that do not exist in Figma
   - Use additional `get_screenshot` and `take_screenshot` calls (including per-element `uid` screenshots) when a difference is unclear.

6. **File one Issue per problem**
   - For each independent difference, file a new GitHub Issue:

     ```bash
     gh issue create \
       --title "<short imperative fix>" \
       --label "bug,backlog" \
       --body "$(cat <<'EOF'
     **Parent issue:** #<number> (omit if no parent Issue was passed)
     **App URL:** <url>
     **Figma:** <figma-url including node-id>

     **What Figma shows**
     ...

     **What the app renders**
     ...

     **Suggested fix scope**
     ...
     EOF
     )"
     ```

   - One Issue per independent problem. Do not batch multiple unrelated fixes into a single Issue.
   - If a parent Issue was passed as the argument, also comment on it linking the new Issues: `gh issue comment <parent> --body "Filed during UX review: #<new1> #<new2> ..."`.

7. **Report**
   - End with a short table of the new Issue numbers and the problem each one tracks.
   - Mention the app URL reviewed and the Figma node id used.
   - Note whether seed data / assets were added for the review.

## Rules

- Do **not** implement any fixes in this skill. Reviewing only.
- Do **not** edit existing Issues, frontend templates, components, or data builders (except adding seed data + asset files as allowed by step 4).
- Do **not** delete or roll back the data/assets added in step 4 — they must persist after the skill finishes.
- Do **not** commit unless the user explicitly asks. If asked, commit only newly downloaded storage assets / seed updates with a message like `Log <page> UX review findings`.
- Always preview the page with realistic content populated. Empty pages are not valid review targets.
- Prefer `take_snapshot` over `take_screenshot` when inspecting text content; use screenshots for visual styling.
- When the Figma URL points at a top-level frame, drill into child nodes (`get_screenshot` / `get_design_context` on child `nodeId`s) when a section needs a closer look.
- Respect the 7-day Figma asset URL TTL — always download assets locally before attaching them.

## Output Expectations

Your final message should include:

- App URL reviewed
- Figma file key + node id used
- Seed data populated (entity, row count, assets downloaded and storage paths), with an explicit note that it was left in place
- A table of new Issue numbers with their problem titles
- Any ambiguous items you chose not to file, with a brief reason
