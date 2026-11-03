---
name: checkpoint-work
description: Checkpoint a {{PROJECT_NAME}} work item - write and accept a handoff artifact so another session or tool can resume. Use before stopping, switching model/tool, or when the user says checkpoint or handoff.
argument-hint: "[WORK-ID]"
disable-model-invocation: true
---

# Checkpoint work

Canonical procedure. `$ARGUMENTS` is an optional work ID (default: the item worked on in this session).

1. Read the manifest. Note stage states, drafts, open decisions.
2. Allocate: `node .ai/scripts/new-artifact.mjs --work-id <ID> --kind handoff --author claude/<your model id>`.
3. Fill every section of the returned file: State, Done, Remaining, Blockers, Next steps, Files in flight (from read-only `git status --short`). Cite artifacts as `artifact:<uuid>`. Replace every `_TBD_`.
4. If an earlier handoff exists and is accepted, pass `--supersedes <its uuid>` when allocating so the chain stays linear.
5. Accept: `node .ai/scripts/set-artifact-status.mjs --work-id <ID> --uuid <uuid> --status accepted`.
6. Run `node .ai/scripts/validate-workflow.mjs`; fix or report failures.
7. Tell the user what to commit (see `.ai/GUIDE.md`). Never run git add/commit/push.
