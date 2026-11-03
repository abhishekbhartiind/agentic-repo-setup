# agentic-repo-setup

A drop-in AI coding workflow for any repository, new or existing. One command asks a few questions about your repo and installs a structured way of working with Claude Code (and Codex):

- **PRP (Product Requirements Prompt):** one product-level requirements document. Every feature traces to a goal in it.
- **FRP (Feature Requirements Prompt):** one per feature, written with you before any code, with testable acceptance criteria.
- **Work items** that move through research, plan, implement and review (plus a security audit for high-risk work), each stage done by a specialised agent and handed back as a reviewable artifact.
- **A guard hook** that stops read-only agents from editing code, running mutating git commands or reading secrets such as `.env`.
- **Slash commands** (skills): `/setup-ai`, `/prp`, `/frp`, `/resume-work`, `/checkpoint-work`.

It needs only **Node.js 22+** and **git**. No npm packages, no PowerShell, no global installs.

## Contents

- [Quick start](#quick-start)
- [Requirements](#requirements)
- [Installing into a repo](#installing-into-a-repo)
- [What gets installed](#what-gets-installed)
- [How you use it](#how-you-use-it)
- [Reference](#reference)
- [Upgrading and removing](#upgrading-and-removing)
- [Troubleshooting](#troubleshooting)
- [Developing the template](#developing-the-template)
- [License](#license)

## Quick start

```bash
git clone https://github.com/abhishekbhartiind/agentic-repo-setup.git
node agentic-repo-setup/install.mjs path/to/your-repo
```

Answer the questions (press Enter to accept each suggested answer), then:

```bash
cd path/to/your-repo
claude
```

In Claude Code, run `/setup-ai` (existing repo), then `/prp`, then `/frp <your first feature>`.

## Requirements

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22 or newer | Runs the installer, the workflow scripts and the guard hook |
| git | any recent | Records the base commit of each work item and checks staged files |
| Claude Code | current | Uses the agents, rules, skills and hook. Codex can follow the same workflow by convention (see `.ai/routing-codex.md`) |

## Installing into a repo

```bash
node install.mjs [repo-dir] [--yes] [--answers answers.json] [--force]
```

Without `repo-dir` it asks for one. The folder may be empty (a new project) or an existing codebase.

### The questions

The installer looks at the repo first and proposes an answer for each question. It reads `package.json`, lockfiles, `tsconfig.json`, `pyproject.toml`, `go.mod` and `Cargo.toml`, and lists `.env*` file names. It never reads the contents of `.env` files.

| Question | Suggested answer comes from |
| --- | --- |
| Project name | `package.json` name, or the folder name |
| One-line description | `package.json` description |
| Stack | Dependencies (Next.js, NestJS, Expo, React, Vue, Svelte, Angular, Express, Fastify, Prisma, Vite, Django, FastAPI, Flask) and language files |
| Work-ID prefix | Initials of the name: `order-api` becomes `OA` |
| PRP path | `docs/PRP.md` |
| Commands for typecheck, lint, format-check, test, build | `package.json` scripts and the package manager (npm, pnpm, yarn or bun); for Python repos, `ruff`/`flake8`, `mypy`/`pyright`, `pytest` and `build`/`uv build`/`poetry build`, run through `uv`, `poetry` or `pipenv` when a matching lock file is present, otherwise plain |
| Protected files | Common secret files plus every `.env*` file found, except examples |
| High-risk areas | Auth, payments, database migrations, env and build config, CI, dependency upgrades |
| Things only a human can confirm | Chosen by stack, for example browser checks for web apps or device runs for mobile |
| Rule for library APIs | "Read the installed version and its official docs; do not answer from memory" |

At each prompt: press **Enter** to keep the suggestion, type a new value to replace it, or type **`-`** to skip a command. The installer shows nothing until you confirm the final "Install with these answers?" prompt.

### Options

| Option | Effect |
| --- | --- |
| `--yes` | Accept every suggested answer without asking. Also used automatically when there is no terminal (CI, scripts) |
| `--answers file.json` | Preset answers. Keys: `name`, `description`, `stack`, `prefix`, `prp`, `cmd_typecheck`, `cmd_lint`, `cmd_format-check`, `cmd_test`, `cmd_build`, `protected`, `high_risk`, `unverified`, `docs_rule` |
| `--force` | Upgrade an existing install (see [Upgrading](#upgrading-and-removing)) |
| `-h`, `--help` | Show usage |

Example answers file:

```json
{
  "name": "order-api",
  "description": "Order management API for the shop.",
  "prefix": "ORD",
  "prp": "docs/PRP.md",
  "cmd_test": "npm test",
  "high_risk": "payments, database migrations, auth, CI"
}
```

The installer never commits. It refuses to overwrite an existing install unless you pass `--force`.

## What gets installed

| Path | Contents |
| --- | --- |
| `.ai/` | The workflow: docs (`workflow.md`, `artifacts.md`, `GUIDE.md`, routing tables), schemas, Node scripts, their tests, canonical rules and skills, `project.json` (your answers as machine-readable config), `project-context.md`, the PRP skeleton |
| `.claude/agents/` | 18 generated agent profiles: 6 roles (simple, researcher, planner, implementer, reviewer, auditor) at low, medium and high effort |
| `.claude/rules/` | Path selectors that load the right rules when Claude touches matching files |
| `.claude/skills/` | Thin adapters for the slash commands |
| `.claude/settings.json` | The guard hook. Merged into your existing settings; your permissions and hooks are kept |
| `<PRP path>` | The PRP skeleton, only if the file does not exist yet |
| `AGENTS.md`, `CLAUDE.md` | A marked block is appended (`<!-- BEGIN:ai-workflow -->` ... `<!-- END:ai-workflow -->`). Your own content stays. Missing files are created |
| `.gitignore` | Adds `.claude/settings.local.json` |
| `.prettierignore` | Adds `.ai/`, `.claude/` and `docs/work/` when the repo uses Prettier, so the formatter never rewrites locked artifacts |

Work items you create later live in `docs/work/<ID>/`.

### What to commit

Commit `.ai/`, `.claude/` (except `settings.local.json`), `AGENTS.md`, `CLAUDE.md`, the PRP and, as you work, `docs/work/`. Never commit the protected files you listed.

## How you use it

Open Claude Code **inside the repo**, not in a parent folder; otherwise the hook, rules and skills do not load.

### 1. Fill in the setup (existing repos)

```
/setup-ai
```

Claude reads the code (never protected files) and drafts the folder layout, CI notes, verified commands, high-risk areas and two to five path-scoped rules for your main code areas. You confirm or correct it in one round.

### 2. Write the PRP

```
/prp
```

Claude drafts the product requirements from your README and docs, then asks about the gaps: problem, users, goals (numbered `G1`, `G2`, ...), non-goals, scope, key flows, constraints, success metrics, risks and open questions. Run `/prp` again whenever the product changes.

### 3. Start a feature with an FRP

```
/frp Customers can cancel an order within 30 minutes
```

Claude:

1. Creates a work item (for example `ORD-001`) and chooses its route with you.
2. Links the feature to a PRP goal.
3. Reads the relevant code, then interviews you about whatever the code cannot answer.
4. Writes the FRP: problem, PRP goal, users and outcome, scope, numbered acceptance criteria, contracts and data, risks, out of scope, open questions.
5. Records it once you approve, and copies the acceptance criteria into the work item.

### 4. Authorise and let the coordinator run it

Say **"ready"** (or "go ahead") for `ORD-001`. Only you can move a work item to `ready`. The main Claude Code session then acts as the **coordinator**:

| Route | Stages | Use for |
| --- | --- | --- |
| `simple` | one small change | One-place, low-risk fixes. No FRP needed |
| `standard` | research (optional) -> plan -> implement -> review | Normal features and fixes. FRP required |
| `high-risk` | standard + audit | The high-risk areas you listed. FRP required |

For each stage the coordinator allocates an artifact, delegates to the matching agent, reads the short result it returns, checks it against the acceptance criteria and accepts or rejects it. A review or audit ends with `APPROVE`, `CHANGES_REQUESTED` or `BLOCK`. After two failed attempts at the same stage it stops and asks you.

Accepted artifacts are locked with a SHA-256 hash; the validator fails if anyone edits one later. To change an accepted artifact, a new one supersedes it.

### 5. Pause and resume

```
/checkpoint-work      # before you stop or switch model or tool
/resume-work ORD-001  # in a later session
```

### 6. Review and commit

Agents never run `git add`, `commit` or `push`. You review the diff and commit. Things only a human can confirm (for example a browser check or a real payment) stay marked **pending** until you say they passed.

## Reference

### Slash commands

| Command | What it does |
| --- | --- |
| `/setup-ai [area]` | Fill in or refresh the project context, commands, high-risk areas and path rules from the code |
| `/prp [what changed]` | Create or update the PRP |
| `/frp <work ID or feature>` | Write the FRP and create or update the work item |
| `/resume-work [work ID]` | Show the item's state and the next step |
| `/checkpoint-work [work ID]` | Write a handoff so another session can continue |

### Terminal scripts

Run from the repo root. Each also runs directly, for example `./.ai/scripts/validate-workflow.mjs`.

| Command | Purpose |
| --- | --- |
| `node .ai/scripts/validate-workflow.mjs` | Check everything: manifests, artifacts and their hashes, FRP rule, PRP, rules, skills, agent sync, hook, staged secret files |
| `node .ai/scripts/new-work-item.mjs --prefix ORD --title "..." --route standard` | Create a work item |
| `node .ai/scripts/update-work-item.mjs --id ORD-001 --status ready --authorized-by-user` | Change status, stage, route, dependencies, owned paths, criteria or open decisions |
| `node .ai/scripts/new-artifact.mjs --work-id ORD-001 --kind plan` | Allocate a draft artifact (`frp`, `research`, `plan`, `implementation`, `review`, `audit`, `decision`, `handoff`) |
| `node .ai/scripts/set-artifact-status.mjs --work-id ORD-001 --uuid <uuid> --status accepted` | Accept (and hash-lock) or reject a draft |
| `node .ai/scripts/generate-claude-agents.mjs [--check]` | Regenerate or check the agent profiles |
| `node .ai/scripts/get-scratch-path.mjs` | Print a temp folder outside the repo |
| `node --test .ai/tests/*.test.mjs` | Run the workflow's own tests |

Results print as JSON; errors print `ERROR: ...` and exit with code 1. Full details: `.ai/README.md` and `.ai/workflow.md` in the installed repo.

### Guard hook

The hook runs before every tool call. It only restricts the read-only roles (researcher, planner, reviewer, auditor). They may write only their own draft artifact (and, for researcher, reviewer and auditor, their own memory folder). They cannot run mutating git commands, redirect output into files, or read protected files, including wildcards such as `.env*`. Your main session is not restricted.

## Upgrading and removing

### Upgrade

Pull a newer template, then re-run with `--force`:

```bash
node agentic-repo-setup/install.mjs path/to/your-repo --force
```

It replaces the template's tooling (scripts, tests, schemas, workflow docs, skills, agents, the `AGENTS.md` and `CLAUDE.md` blocks) and keeps what your repo owns: `.ai/project.json`, `.ai/project-context.md`, the testing and config rules, any rules you added, and the PRP. Your earlier answers, saved in `.ai/project.json` under `template.answers`, are the defaults.

### Remove

Delete `.ai/`, `.claude/agents/`, `.claude/rules/`, `.claude/skills/`, `.claude/agent-memory/` and `docs/work/` if you do not want to keep them. Remove the guard entry from `.claude/settings.json`, then delete the `ai-workflow` blocks from `AGENTS.md` and `CLAUDE.md`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Slash commands or the hook do nothing | Open Claude Code inside the repo, not a parent folder |
| `NOTE .gitignore ignores .claude` | Replace the `.claude` line with `.claude/settings.local.json`, or the shared setup cannot be committed |
| `WARN ... still has _TBD_ sections` | Run `/prp` to finish the PRP |
| `needs an accepted frp artifact` | Run `/frp <work ID>` and approve the FRP, or use the `simple` route for a small fix |
| `HASH MISMATCH` | An accepted artifact was edited. Restore it from git and create a new artifact with `--supersedes` instead |
| `Agent profiles not in sync` | Run `node .ai/scripts/generate-claude-agents.mjs`. Never edit `.claude/agents/*` by hand |
| `These files already exist` | The repo already has the setup. Use `--force` to upgrade |

## Developing the template

| Path | What |
| --- | --- |
| `install.mjs` | The installer: asks the questions, renders the template, merges settings and docs |
| `template/` | Files copied into a repo. `{{PLACEHOLDER}}` values come from the answers |
| `template/AGENTS.block.md`, `template/CLAUDE.block.md` | The blocks merged into `AGENTS.md` and `CLAUDE.md` |
| `test/install.test.mjs` | Installs into a new and an existing temp repo, re-runs, upgrades, and runs the installed workflow tests |

```bash
node --test test/*.test.mjs
```

## License

Released under the [MIT License](LICENSE).
