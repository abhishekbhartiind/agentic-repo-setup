# Coordinator workflow

The main Claude Code session is the **coordinator**. It plans delegation, builds envelopes, runs the scripts in `.ai/scripts/`, and accepts or rejects artifacts. Delegates (subagents in `.claude/agents/`) only produce one artifact each. Nobody commits; the user commits.

## Work item lifecycle

```
backlog -> ready -> in_progress -> blocked | done | cancelled
              (blocked -> in_progress)
```

- `backlog -> ready` needs the user's authorization (`update-work-item.mjs --authorized-by-user`, only after the user said so).
- A work item is **executable** only when status is `ready` (or `in_progress`) **and** every dependency is `done`. `update-work-item.mjs` refuses `-> in_progress` otherwise.
- `done` needs every stage `done` or `skipped`, each `done` stage linked to an **accepted** artifact.
- `done` and `cancelled` are terminal.
- **PRP and FRP.** The PRP (Product Requirements Prompt, `{{PRP_PATH}}`) describes the whole product: goals, users, scope, constraints. Keep it current with `/prp`. Product work on the `standard` and `high-risk` routes needs an accepted **FRP** (Feature Requirements Prompt, artifact kind `frp`) before `backlog -> ready`: the coordinator writes it with the user via `/frp`, traces it to a PRP goal, and copies its acceptance criteria into the manifest. `simple` items and `WF` items need no FRP. `update-work-item.mjs` and `validate-workflow.mjs` enforce this.
- IDs: `WF-nnn` workflow work (tooling, `.ai/`, `.claude/`), `{{PREFIX}}-nnn` product work. Create with `new-work-item.mjs`.

## Routes

| Route | Stages | Use for |
| --- | --- | --- |
| `simple` | `code-simple` (one stage, implementation artifact) | Small, low-risk, one-place changes |
| `standard` | research (optional, may be `skipped`) -> plan -> implement -> review | Normal features and fixes |
| `high-risk` | standard + audit (`auditor`) | {{HIGH_RISK}} |

When unsure between two routes, pick the higher one.

**Changing the route mid-flight:** `update-work-item.mjs --id <id> --route <route>` migrates the stage list (stages matched by name, `simple` <-> `implement`; status and artifacts kept; new stages `pending`). A stage that no longer applies is dropped only if it has no artifact and is `pending` or `skipped`; otherwise the call is refused. `done` and `cancelled` items are refused. Each change is recorded in the manifest `route_history`. Details in `.ai/README.md`.

## Per-stage procedure (coordinator)

1. Check the work item is executable. Set the work item `in_progress` if it is not yet.
2. Allocate: `new-artifact.mjs --work-id <id> --kind <kind>` (add `--supersedes <uuid>` to replace an accepted artifact). Note the returned `uuid` and `path`.
3. Start the stage: `update-work-item.mjs --id <id> --stage-name <stage> --stage-status in_progress --stage-artifact <uuid>`.
4. Build the envelope and delegate with the Agent tool: `subagent_type` = the profile from `.ai/routing-claude.md`, and pass the `model` alias from that table (profiles use `model: inherit`, so the per-invocation model is what selects it).
5. Read the returned **capsule** only. Open the artifact and check it against the acceptance criteria. Never accept your own unreviewed output for stages that have a reviewer.
6. Accept: `set-artifact-status.mjs --work-id <id> --uuid <uuid> --status accepted`, then `update-work-item.mjs ... --stage-status done`. Or reject (`--status rejected`) and re-allocate with a fresh artifact and a corrected envelope.
7. Review/audit verdicts: `APPROVE` continues; `CHANGES_REQUESTED` returns to implement with a new envelope citing the review artifact; `BLOCK` stops and asks the user.

## The envelope

Every delegation message contains exactly these fields (no more context than needed):

| Field | Content |
| --- | --- |
| `work_id` | e.g. `{{PREFIX}}-004` |
| `stage` | `simple` / `research` / `plan` / `implement` / `review` / `audit` |
| `goal` | One paragraph: the outcome this delegate must produce |
| `acceptance_criteria` | The work item criteria that apply to this stage |
| `owned_paths` | Paths the delegate may change (implementers); `none` for read-only roles |
| `base_commit` | The manifest `base_commit` |
| `input_artifacts` | `artifact:<uuid>` citations the delegate must read |
| `allocated_artifact` | The path and uuid from `new-artifact.mjs` |
| `verification_commands` | Command ids from `.ai/project.json` to run, or `none` |
| `stop_conditions` | When to stop and return a blocked capsule |

The delegate returns a capsule (format in `.ai/artifacts.md` and in every agent profile).

## Progress limit

After **2 delegated blockers on the same goal** (two blocked capsules, or two rejected artifacts for the same stage), stop. Tell the user what is blocked, what was tried, and the options. Do not make a third attempt without an answer. Record unresolved questions with `update-work-item.mjs --add-open-decision`.

## Handoff and checkpoint

- Before every handoff (end of session, switching tool or model, or asking the user to review), run `node .ai/scripts/validate-workflow.mjs` and fix or report every failure.
- A checkpoint is a `handoff` artifact (State, Done, Remaining, Blockers, Next steps, Files in flight) allocated and accepted with the scripts. Use the `checkpoint-work` skill; resume with `resume-work`.
- Handoffs list files in flight and uncommitted state read-only (`git status`). Never stage, commit or push.
- Temp files go to `.ai/scripts/get-scratch-path.mjs`, never into the repo.

## Hard rules

- Never touch protected paths (`.ai/project.json` `policy.protected_paths`) and never print sensitive environment variables.
- Never fake verification: {{UNVERIFIED}} stay `pending` until the user confirms.
- Dependencies are added only with the project's package manager after the user approves.
- When a work item is done, the coordinator updates the PRP and `.ai/project-context.md` if it changed product scope, architecture or conventions.
