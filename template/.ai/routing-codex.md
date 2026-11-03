# Routing for Codex

Minimal mapping. Codex reads `AGENTS.md` (root and nested) and has no native subagent profiles here; the same envelope and artifact contract apply (`.ai/workflow.md`, `.ai/artifacts.md`). Codex runs as `author: codex/<model>` or `openai/<model>`.

| Stage | Role | How |
| --- | --- | --- |
| simple | code-simple | One Codex session with the envelope; low reasoning effort |
| research | code-researcher | Read-only session, writes only the allocated research artifact; medium effort |
| plan | code-planner | Read-only session, writes only the plan artifact; high effort |
| implement | code-implementer | Session limited to `owned_paths`; medium effort |
| review | code-reviewer | Fresh session, never the implementing one; high effort |
| audit | auditor | Fresh session, high-risk route only; high effort |

Limitations: the PreToolUse guard is Claude Code specific. For Codex the read-only rules are convention only; the validator (`validate-workflow.mjs`) still catches modified accepted artifacts and staged protected paths.
