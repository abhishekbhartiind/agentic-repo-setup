# Artifact contract

Artifacts are the only way delegates hand work back. One artifact per stage.

## Format and storage

Markdown with YAML front matter (simple `key: value` lines):

```yaml
---
id: 3f2b8c1e-5a47-4d1e-9c0a-7b6e2d9f1a10   # uuid v4, lowercase
work_id: {{PREFIX}}-004
kind: plan            # frp | research | plan | implementation | review | audit | decision | handoff
status: draft         # draft | accepted | superseded | rejected
author: claude/claude-opus-5-5   # <vendor>/<model>; vendors allowed in .ai/project.json
created: 2026-10-22T12:00:00Z    # ISO 8601
supersedes: null      # uuid of the accepted artifact this one replaces, or null
---
```

Path: `docs/work/<WORK-ID>/artifacts/<kind>-<first 8 chars of uuid>.md`. Cite an artifact as `artifact:<uuid>`.

## Lifecycle (scripts only)

- `new-artifact.mjs` creates the draft from the template and registers it (author is the placeholder `claude/unspecified`; the producing agent sets the real `<vendor>/<model>`).
- Only the coordinator runs `set-artifact-status.mjs`.
- **accepted**: required sections present, no `_TBD_` placeholder left, author valid. The script writes `status: accepted` into the file, then records the file's SHA-256 in `work-item.json`. From then on the file is immutable; `validate-workflow.mjs` fails on any change (hash mismatch).
- **superseded**: accepting an artifact with `supersedes: <uuid>` marks the old one `superseded` **in the manifest only**. The old file keeps `status: accepted` in its front matter so its hash stays valid. The manifest is authoritative for `superseded`.
- **rejected**: only drafts; the draft's status line is rewritten.
- To change an accepted artifact, create a new one of the same kind with `--supersedes`.

## Required sections per kind

| Kind | Sections (`## ` headings, in this order) |
| --- | --- |
| frp | Problem, PRP goal, Users and outcome, Scope, Acceptance criteria, Contracts and data, Risks, Out of scope, Open questions |
| research | Question, Findings, Sources, Unknowns, Recommendation |
| plan | Goal, Scope, Approach, Steps, Risks, Verification, Out of scope |
| implementation | Summary, Files changed, Deviations from plan, Verification run, Not verified |
| review | Scope reviewed, Findings, Verification re-run, **Verdict**, then the capsule sections |
| audit | Scope audited, Risk analysis, Findings, **Verdict**, then the capsule sections |
| decision | Context, Options, Decision, Consequences |
| handoff | State, Done, Remaining, Blockers, Next steps, Files in flight |

### Verdict and capsule (review and audit)

`## Verdict` contains exactly one line: `APPROVE`, `CHANGES_REQUESTED` or `BLOCK`. After it, always, in this order:

`## Capsule: Result` - `## Capsule: Evidence` - `## Capsule: Unverified` - `## Capsule: Blockers` - `## Capsule: Next`

The same five items form the final message a delegate returns to the coordinator (see the agent profiles).

## Manifest

`docs/work/<ID>/work-item.json`, schema `.ai/schemas/work-item.schema.json`. Artifact entries: `uuid, kind, path` (relative to the work item folder), `status, supersedes, sha256`.

Optional `route_history`: array of `{ from, to, at }` (`from`/`to` are routes, `at` an ISO UTC timestamp), appended by `update-work-item.mjs --route` on each real route change and never rewritten. Manifests without it are valid.
