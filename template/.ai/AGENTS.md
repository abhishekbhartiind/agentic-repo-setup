# Editing the workflow tooling

For anyone changing `.ai/`, `.claude/agents`, `.claude/rules`, `.claude/skills`, `.claude/settings.json`, `AGENTS.md` or `CLAUDE.md`.

1. **Workflow changes are work items with the `WF` prefix.** Create one with `.ai/scripts/new-work-item.mjs --prefix WF --title "..."`. Only the user moves it to `ready`.
2. **Keep everything consistent in one change**: scripts, `.ai/schemas/*.json`, `.ai/artifacts.md`, `.ai/workflow.md`, routing tables, rules and tests. A new field, status or kind touches the schema, the scripts, the validator, the docs and the tests.
3. **Never hand-edit generated files.** `.claude/agents/*.md` come from `.ai/scripts/generate-claude-agents.mjs`; edit the template there and regenerate. The validator fails when they drift.
4. **Canonical vs adapters.** Rules live in `.ai/rules/`, skills in `.ai/skills/`. `.claude/rules/*` and `.claude/skills/*` are thin adapters that only select/point. No content duplication.
5. **Scripts**: Node 22+ ES modules (`.mjs`) with `#!/usr/bin/env node`, shared helpers in `_common.mjs`, clear error messages, non-zero exit on failure, no npm dependencies, no git commands that change anything (read-only `git diff --cached`, `rev-parse`, `status` only). Every script accepts a root override (`--work-root` / `AI_*` env vars) so tests never touch the real `docs/work`.
6. **Tests**: every script has a `node:test` file in `.ai/tests/`. Run `node --test .ai/tests/*.test.mjs`.
7. **Before finishing**: run `node .ai/scripts/validate-workflow.mjs` and `node --test .ai/tests/*.test.mjs`; report failures honestly.
8. **Claude Code specifics** (frontmatter keys, hook input, rule/skill formats) come from the current official docs, not memory. If something cannot be done, document the limitation here or in `.ai/README.md`.
9. Never edit product code, `package.json` or env files as part of workflow work, and never run git commands that change the tree or history; the user commits.
