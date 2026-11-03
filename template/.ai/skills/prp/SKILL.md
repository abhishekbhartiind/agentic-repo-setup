---
name: prp
description: Create or update the PRP (Product Requirements Prompt) for {{PROJECT_NAME}} - the product goals, users, scope and constraints every FRP traces to. Use when the user says PRP or product requirements, or before the first feature.
argument-hint: "[what changed]"
disable-model-invocation: true
---

# PRP

Canonical procedure. `$ARGUMENTS` optionally says what changed.

1. Read the PRP path from `.ai/project.json` (`instructions.prp`). If the file is missing, copy `.ai/templates/prp.md` there.
2. Gather facts from the repo first, read-only: README, existing product or design docs, package metadata, `.ai/project-context.md`. Never read protected paths.
3. For each `_TBD_` section (or each section `$ARGUMENTS` touches), propose an answer grounded in what you found and ask the user to confirm or correct it. Ask at most five questions per round. Do not invent product behavior.
4. Number goals `G1`, `G2`, ... and keep existing numbers stable: FRPs cite them. Retire a goal by marking it "(retired)", never by renumbering.
5. Replace every `_TBD_`. Write "Open question: ..." for anything still unknown.
6. Summarize the changes for the user. Never commit.
7. Run `node .ai/scripts/validate-workflow.mjs` and report its result.
