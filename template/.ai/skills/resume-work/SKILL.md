---
name: resume-work
description: Resume a {{PROJECT_NAME}} work item - read the manifest, latest handoff and repo state, then state the next executable stage. Use when the user says resume, continue, or names a work ID to pick up.
argument-hint: "[WORK-ID]"
disable-model-invocation: true
---

# Resume work

Canonical procedure. `$ARGUMENTS` is an optional work ID.

1. Run `node .ai/scripts/validate-workflow.mjs`. Report failures before continuing.
2. Pick the item: the given ID, else list `docs/work/*/work-item.json` and choose those with status `ready`, `in_progress` or `blocked`; if more than one, ask the user which.
3. Read its `work-item.json` and the newest accepted `handoff` artifact (by `created`). Read artifacts cited there (`artifact:<uuid>`), nothing more.
4. Read-only repo state: `git status --short` and `git rev-parse HEAD` compared with `base_commit`. Do not change anything in git.
5. Check executability (status `ready` or `in_progress`, all dependencies `done`). If `blocked`, show `open_decisions` and ask the user.
6. Report in a few lines: status, route, stage table, drafts awaiting acceptance, open decisions, and the single next step. Follow `.ai/workflow.md` for the stage; never skip allocation (`new-artifact.mjs`) and stage start (`update-work-item.mjs`) before delegating.
7. These remain pending unless the user confirmed them: {{UNVERIFIED}}.
