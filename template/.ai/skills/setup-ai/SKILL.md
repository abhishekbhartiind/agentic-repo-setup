---
name: setup-ai
description: Fill in or refresh the {{PROJECT_NAME}} AI workflow setup from the codebase - project context, commands, high-risk areas, path-scoped rules - then regenerate agents and validate. Use right after installing the template into an existing repo, or when the stack or layout changed.
argument-hint: "[area to refresh]"
disable-model-invocation: true
---

# Set up AI workflow

Canonical procedure. This is workflow work (`WF`): follow `.ai/AGENTS.md`.

1. Read, read-only: `.ai/project.json`, `.ai/project-context.md`, `AGENTS.md`, `CLAUDE.md`, the README, package or build manifests, CI config, existing docs, and the folder tree two levels deep. Never read protected paths (`policy.protected_paths`).
2. Draft, from what you read only:
   - the `<!-- setup-ai -->` sections of `.ai/project-context.md`: folder layout table, CI;
   - the command list: run each candidate once and keep only commands that exist and finish;
   - the high-risk areas row in `.ai/workflow.md`;
   - `agents.unverified` (what only a human can confirm) and `agents.docs_rule` in `.ai/project.json`;
   - the matching values in `template.answers` of `.ai/project.json` (`high_risk`, `unverified`, `docs_rule`, `stack`), so a template upgrade (`install.mjs --force`) re-renders the docs with them;
   - two to five path-scoped rules for the main code areas, each a canonical `.ai/rules/<area>.md` plus a selector `.claude/rules/<area>.md` in the same format as `.claude/rules/testing.md`.
3. Show the draft to the user in one round and apply their corrections. Do not invent conventions the code does not follow.
4. Write the files. Remove each `<!-- setup-ai -->` marker you filled.
5. Regenerate agents: `node .ai/scripts/generate-claude-agents.mjs`. Then run `node .ai/scripts/validate-workflow.mjs` and `node --test .ai/tests/*.test.mjs`, and report results honestly.
6. If the PRP still has `_TBD_` sections, suggest `/prp`. Never commit.
