<!-- BEGIN:ai-workflow -->

## Agent workflow

Product requirements live in the PRP (`{{PRP_PATH}}`). Each feature gets an FRP (Feature Requirements Prompt) before work starts. Multi-step work runs as a tracked work item: prefix `{{PREFIX}}` for product work, `WF` for workflow tooling. Procedure: `.ai/workflow.md`. Human guide: `.ai/GUIDE.md`. Project facts: `.ai/project-context.md` and `.ai/project.json`.

- Use the work-item workflow when the user asks for a work item, an FRP, or names a work ID. Only the user moves an item to `ready`.
- Rules for changing the tooling itself: `.ai/AGENTS.md`.
- Never read or print {{PROTECTED_MD}}. Learn variable names from example env files.
- Agents do not commit, push or change git history. The user commits.
- Report only what was verified. These stay pending until confirmed: {{UNVERIFIED}}.

<!-- END:ai-workflow -->
