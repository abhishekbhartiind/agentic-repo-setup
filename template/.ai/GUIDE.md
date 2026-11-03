# Human guide

## Start work

0. Once per repo: run `/prp` so the PRP (`{{PRP_PATH}}`) describes the product. For an existing codebase run `/setup-ai` first.
1. For a feature: run `/frp <feature>`. The coordinator interviews you, writes the FRP, and you approve it.
2. Ask the coordinator (main Claude Code session) for a work item: "create {{PREFIX}} work item: <title>, route standard". It runs `new-work-item.mjs` (status `backlog`).
3. Say explicitly "ready" / "go ahead" to authorize it. Only you move work to `ready`.
4. The coordinator runs the stages (research -> plan -> implement -> review, plus audit for high-risk) and reports capsules.

## Resume

Run the `resume-work` skill (`/resume-work`, optionally with a work ID). It reads the manifest and the latest handoff, shows `git status` read-only, and names the next stage.

## Checkpoint

Run `/checkpoint-work` before stopping or switching tool/model. It writes and accepts a `handoff` artifact and runs `validate-workflow.mjs`.

## What you commit

You commit everything yourself; agents never run `git add/commit/push`.

- Commit: `.ai/`, `.claude/agents`, `.claude/rules`, `.claude/skills`, `.claude/settings.json`, `.claude/agent-memory/.gitkeep` (agent memory files if you want to share them), `docs/work/`.
- Never commit: {{PROTECTED_MD}}.
- Before committing run `node .ai/scripts/validate-workflow.mjs` (it also fails if a protected path is staged).

## Things only you confirm

These stay "pending" until you say they passed: {{UNVERIFIED}}.
