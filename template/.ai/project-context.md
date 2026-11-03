# {{PROJECT_NAME}} - project context

{{DESCRIPTION}} Machine-readable facts: `.ai/project.json`. Product requirements: `{{PRP_PATH}}` (the PRP).

Sections marked `<!-- setup-ai -->` are filled from the codebase by the `/setup-ai` skill.

## Stack

{{STACK}}

## Folder layout

<!-- setup-ai --> Not described yet.

## Env model

Protected files, never read or printed by agents: {{PROTECTED_MD}}. Agents learn variable names from example files (for example `.env.example`). A change to env or build config takes the high-risk route.

## What each command proves (and does not)

| Command (id) | Proves | Does NOT prove |
| --- | --- | --- |
{{COMMANDS_TABLE}}

These stay **pending** until the user confirms them: {{UNVERIFIED}}. Agents report them as unverified, never as passed.

## CI

<!-- setup-ai --> Not described yet. The CI does not run `.ai/scripts/validate-workflow.mjs` unless you add it; run it locally before a handoff.
