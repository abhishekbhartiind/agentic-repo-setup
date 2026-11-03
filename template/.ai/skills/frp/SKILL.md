---
name: frp
description: Write the FRP (Feature Requirements Prompt) for a {{PROJECT_NAME}} work item - problem, PRP goal, scope, testable acceptance criteria, contracts and risks - and record it as an accepted frp artifact. Use when the user starts a feature or says FRP.
argument-hint: "<WORK-ID or feature title>"
disable-model-invocation: true
---

# FRP

Canonical procedure. `$ARGUMENTS` is a work ID or a feature title. Product work on the `standard` and `high-risk` routes cannot become `ready` without an accepted FRP.

1. Work item: with a work ID, read its manifest. With a title, pick the route from `.ai/workflow.md` (ask the user when unsure; pick the higher one) and create it: `node .ai/scripts/new-work-item.mjs --prefix {{PREFIX}} --title "<title>" --route <route>`.
2. Read the PRP (`instructions.prp` in `.ai/project.json`) and choose the goal (`G#`) this feature serves. If none fits, stop and ask the user: update the PRP first with `/prp`, or confirm the feature is out of PRP scope and say so in the FRP.
3. Read the code the feature touches, read-only, so contracts and risks are real, not guessed.
4. Ask the user what the repo cannot tell you. Propose answers; at most five questions per round.
5. Allocate: `node .ai/scripts/new-artifact.mjs --work-id <ID> --kind frp --author claude/<your model id>`. Fill every section of the returned file:
   - **Problem**: what is wrong or missing today, for whom.
   - **PRP goal**: the `G#` it serves, one line why.
   - **Users and outcome**: who benefits and what they can do afterwards.
   - **Scope**: what changes.
   - **Acceptance criteria**: numbered, each observable and testable; no "should be fast".
   - **Contracts and data**: APIs, schemas, events, migrations, env variables, other repos that must follow.
   - **Risks**: what could break; anything that makes this `high-risk`.
   - **Out of scope**: what this feature deliberately leaves out.
   - **Open questions**: unresolved decisions ("none" if none).
6. Show the FRP to the user. Only after they approve: `node .ai/scripts/set-artifact-status.mjs --work-id <ID> --uuid <uuid> --status accepted`.
7. Copy the criteria into the manifest: `node .ai/scripts/update-work-item.mjs --id <ID> --add-acceptance-criteria "first||second||..."`. If the risks match the high-risk list in `.ai/workflow.md`, also pass `--route high-risk`. Record open questions with `--add-open-decision`.
8. Tell the user the item can move to `ready` once they authorize it. Never authorize it yourself. To change an accepted FRP, allocate a new one with `--supersedes <uuid>`.
