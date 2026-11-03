<!-- BEGIN:ai-workflow -->

## Claude Code workflow

Open Claude Code inside this repo, so `.claude/settings.json`, rules, agents and skills load. For a work item this session is the coordinator: follow `.ai/workflow.md` and pick agents and models from `.ai/routing-claude.md`.

- `/prp`: create or update the product requirements (PRP).
- `/frp <feature>`: write the feature requirements (FRP) and the work item.
- `/resume-work` and `/checkpoint-work`: pick up and hand off.
- `/setup-ai`: fill in or refresh this setup from the codebase.

Regenerate `.claude/agents/*` with `.ai/scripts/generate-claude-agents.mjs`; never hand-edit them.

<!-- END:ai-workflow -->
