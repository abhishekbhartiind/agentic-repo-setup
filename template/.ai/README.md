# .ai - agent workflow system map

```
.ai/
  project.json            machine-readable facts: commands, protected paths, work-ID prefixes, author vendors
  project-context.md      stack, layout, env model, what each command proves
  workflow.md             coordinator procedure: lifecycle, routes, envelope, limits, handoff
  routing-claude.md       stage -> .claude/agents profile -> model alias -> effort
  routing-codex.md        minimal Codex equivalent
  artifacts.md            artifact format, lifecycle, section templates, capsule
  AGENTS.md               rules for editing this tooling
  GUIDE.md                short human guide
  schemas/                project.schema.json, work-item.schema.json
  rules/                  canonical path-scoped rules (testing, config-and-env, workflow-tooling, plus code-area rules from /setup-ai)
  skills/                 canonical skills: prp, frp, setup-ai, resume-work, checkpoint-work
  templates/              prp.md, the PRP skeleton (FRP sections come from new-artifact.mjs --kind frp)
  scripts/                Node tooling, run from the terminal (below)
  tests/                  node:test tests, one file per script
.claude/
  agents/                 18 generated profiles (6 roles x low|medium|high)
  rules/                  path selectors -> .ai/rules via @import
  skills/                 thin adapters -> .ai/skills
  settings.json           PreToolUse guard hook (+ existing plugin settings)
  agent-memory/           per-agent memory of researcher/reviewer/auditor profiles
docs/work/<ID>/           work-item.json + artifacts/<kind>-<first8>.md
```

## Scripts

| Script | Purpose |
| --- | --- |
| `new-work-item.mjs` | Allocate next ID (`WF` starts at 000, others at 001), create folder + manifest |
| `update-work-item.mjs` | Status/stage/dependency/owned path/criteria/decision changes with transition validation; `--route` changes the route and migrates the stages (see below) |
| `new-artifact.mjs` | Allocate a draft artifact from the template (JSON out: uuid, path) |
| `set-artifact-status.mjs` | Accept (records SHA-256, marks superseded target) or reject a draft |
| `get-scratch-path.mjs` | Per-user temp dir outside the repo |
| `validate-workflow.mjs` | Manifests, schemas, hashes, chains, referenced paths, selectors, agent sync, staged protected paths, author vendors |
| `guard-claude-role-write.mjs` | PreToolUse hook for restricted roles |
| `generate-claude-agents.mjs` | Generates / checks `.claude/agents/*` |
| `_common.mjs` | Shared helpers (imported) |

## Running the scripts

Run them from the repo root in any terminal; they need only Node 22+ (already required by the repo), no other install:

```bash
node .ai/scripts/validate-workflow.mjs
node .ai/scripts/new-work-item.mjs --prefix WF --title "..." --route standard
node --test .ai/tests/*.test.mjs
```

Each script also runs directly (`./.ai/scripts/validate-workflow.mjs`). Options are `--kebab-case`; unknown options are errors. Results print as compact JSON on stdout; errors print `ERROR: ...` on stderr with exit code 1. The guard hook exits 2 to deny.

## List arguments and `base_commit`

- **Identifier lists split on commas**: `new-work-item.mjs --depends-on` and `update-work-item.mjs --add-dependency`, `--remove-dependency`, `--set-owned-paths`. `--set-owned-paths a,b` gives two items; items are trimmed and empty items dropped. To keep a literal comma inside one item, escape it as `\,`.
- **Prose lists are never split on commas.** `--add-acceptance-criteria`, `--add-open-decision` and `--remove-open-decision` split only on `||`: `--add-acceptance-criteria 'Handles empty, null, and missing input||Second item'` gives two items. Giving the option more than once keeps each value as one item.
- **`base_commit`.** `new-work-item.mjs` records `git rev-parse HEAD` (read-only). It is `null` only when git fails (not a repository, no commit); creation still succeeds.

## Route change: `update-work-item.mjs --route`

`--route simple|standard|high-risk` changes a work item's route and migrates its stage list so it equals the new route's stages (what `validate-workflow.mjs` requires).

- **Mapping by name.** `simple` and `implement` map to each other in both directions (a simple stage's implementation artifact becomes the implement stage's artifact, and back); every other name maps to itself. Mapped stages keep their status and artifact. Role comes from the stage-role table in `_common.mjs`.
- **New stages** of the new route with no counterpart are added `pending`, artifact `null`. Stage order is the new route's order.
- **Drop rule.** A current stage with no counterpart in the new route is removed only when it has **no artifact and is `pending` or `skipped`**. Otherwise (artifact present, or `in_progress`/`done`) the whole call is refused and the message names the stage. Accepted artifacts are never deleted or modified; the manifest `artifacts` array is untouched.
- **Refusals.** `done` and `cancelled` items; an unknown route (parameter validation); a drop that breaks the rule. A refusal writes nothing.
- **Same route** is a no-op: success, nothing written, no `route_history` entry.
- **Atomic.** `--route` is processed first, in memory, together with the other parameters of the same call (stage parameters then see the new stage list). The manifest is saved once at the end, so any refusal leaves it byte-identical.
- **History.** Each real migration appends `{ from, to, at }` to the optional manifest array `route_history` (append only; `at` is an ISO UTC timestamp). Manifests without the field stay valid.
- **Output.** Without `--route` the output is unchanged: `{ id, status }`. With `--route` it also has `route` and `stages` (array of stage names).

## Guard hook: how the role is identified and its limits

Claude Code passes `agent_type` (the subagent name) and `agent_id` in the hook input when the hook fires inside a subagent (documented in the hooks reference). The guard applies to `code-researcher`, `code-planner`, `code-reviewer`, `auditor` and their `-low|-medium|-high` variants.

- No `agent_type`, no `agent_id`: main session; not restricted by this hook.
- `agent_id` without `agent_type`: role unknown, **blocked** (fail closed).
- Unparsable input, missing `tool_name`, unreadable `protected_paths`: **blocked**.
- Other agent types (`code-simple`, `code-implementer`, built-ins): not restricted by this hook.
- Deny is exit code 2 with the reason on stderr.

Known limitations (not faked):
- The hook cannot tell *which* draft artifact a role was allocated, only that the target is an existing draft artifact under `docs/work/<ID>/artifacts/`. Envelope discipline covers the rest.
- Bash is checked by pattern (git mutations, redirects, common file-writing commands, protected path tokens). A determined shell command (e.g. `node -e` writing a file, an alias, an encoded command) can bypass pattern checks. Restricted roles keep `Bash` so they can run the verification commands; treat the hook as a strong guardrail, not a sandbox.
- If a restricted subagent's hook input lacks both `agent_type` and `agent_id` (not expected from current docs), it is indistinguishable from the main session and is allowed.
- Nested `AGENTS.md` files are read by Claude Code only when no `CLAUDE.md` exists in the working directory or above; the `.claude/rules` selectors work either way.
- The hook was verified with sample hook JSON in node:test tests; it has not been observed firing inside a live Claude Code subagent session.
- The hook command uses `${CLAUDE_PROJECT_DIR}` so it works from any cwd.

## Requires `node`

The guard hook and all scripts run with `node` on `PATH`. If `node` is missing the hook fails with a non-blocking error, so restricted roles are **not** guarded.

The guard loads from `.claude/settings.json` of the project the session was opened in, so open Claude Code inside this repo, not in the parent folder.
