#!/usr/bin/env node
// Generates .claude/agents/<role>-<effort>.md (6 roles x low/medium/high) from one template.
// Repo-specific wording comes from .ai/project.json (policy.protected_paths, agents.docs_rule, agents.unverified).
// --check compares the files on disk with what would be generated and exits 1 on any difference or stray file.
// Usage: generate-claude-agents.mjs [--check] [--out-dir DIR]
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, REQUIRED_SECTIONS, args, projectConfig, run, writeUtf8 } from './_common.mjs';

const EFFORTS = ['low', 'medium', 'high'];
const ROLES = [
  { id: 'code-simple', purpose: 'Small, low-risk, single-stage changes (one file or a few lines) on the simple route.', tools: 'Read, Grep, Glob, Edit, Write, Bash', memory: false, restricted: false, artifact: 'implementation', sections: true },
  { id: 'code-researcher', purpose: 'Read-only research: finds facts in the repo and the official docs and writes a research artifact.', tools: 'Read, Grep, Glob, Bash, WebFetch, WebSearch, Edit, Write', memory: true, restricted: true, artifact: 'research', sections: false },
  { id: 'code-planner', purpose: 'Turns a goal and research into a concrete, verifiable implementation plan artifact. Never edits code.', tools: 'Read, Grep, Glob, Bash, Edit, Write', memory: false, restricted: true, artifact: 'plan', sections: false },
  { id: 'code-implementer', purpose: 'Implements an accepted plan inside the owned paths and writes an implementation artifact.', tools: 'Read, Grep, Glob, Edit, Write, Bash', memory: false, restricted: false, artifact: 'implementation', sections: false },
  { id: 'code-reviewer', purpose: 'Independent review of an implementation against its plan and acceptance criteria; ends with a verdict and capsule.', tools: 'Read, Grep, Glob, Bash, Edit, Write', memory: true, restricted: true, artifact: 'review', sections: false },
  { id: 'auditor', purpose: 'Security / contract / env-build-config audit for the high-risk route; ends with a verdict and capsule.', tools: 'Read, Grep, Glob, Bash, WebFetch, Edit, Write', memory: true, restricted: true, artifact: 'audit', sections: false },
];

const capsule = (unverified) => `## Capsule return format

Your final message to the coordinator is a capsule, nothing else (no long prose, no file dumps):

\`\`\`
CAPSULE
artifact: artifact:<uuid of your allocated artifact>
result: done | blocked
summary: <= 5 lines
evidence: each command you ran with its exit code
unverified: what you did NOT verify (${unverified} are always unverified unless the user confirmed)
blockers: none | what stops you and what decision is needed
next: the single recommended next step
\`\`\`

For review and audit artifacts the same five capsule headings (\`Capsule: Result\`, \`Capsule: Evidence\`, \`Capsule: Unverified\`, \`Capsule: Blockers\`, \`Capsule: Next\`) are the last sections of the artifact, after \`## Verdict\`.`;

function roleBody(r, name, cfg) {
  const protectedList = cfg.policy.protected_paths.map((p) => `\`${p}\``).join(', ');
  let s = `# ${name}

${r.purpose}

Canonical procedure: \`.ai/workflow.md\`. Project facts: \`.ai/project-context.md\`. Artifact contract: \`.ai/artifacts.md\`.

## Delegated role rules

1. Work only from the envelope the coordinator gave you (work_id, stage, goal, acceptance criteria, owned paths, base commit, input artifacts, allocated artifact, verification commands, stop conditions). If a field is missing or contradictory, stop and return a blocked capsule.
2. Your output is exactly one artifact: the allocated draft \`${r.artifact}\` file. Fill every section, set \`author\` to \`claude/<your model id>\`, keep \`status: draft\`. Never accept, reject or supersede artifacts and never edit \`work-item.json\`; the coordinator does that with \`.ai/scripts\`.
3. Cite sources as \`artifact:<uuid>\`. Accepted artifacts are immutable; do not edit them.
4. Never run git commands that change the working tree, index or history (checkout, switch, restore, reset, clean, commit, push, rebase, merge, cherry-pick, am, revert, stash, add). The user commits.
5. Never read, print or copy protected paths (${protectedList}) or sensitive environment variables.
6. ${cfg.agents.docs_rule}
7. Use only the commands in \`.ai/project.json\`. Do not install dependencies; ask the coordinator. Report missing scripts instead of inventing replacements.
8. These stay "pending" until the user confirms them: ${cfg.agents.unverified}. Say so in \`unverified\`.
9. Two blockers on the same goal: stop and return a blocked capsule. Do not loop.`;
  if (r.restricted) {
    const mem = r.memory ? ' and your own `.claude/agent-memory/` directory' : '';
    s += `\n10. You are a restricted role. A PreToolUse hook (\`.ai/scripts/guard-claude-role-write.mjs\`) blocks writes outside your allocated artifact${mem}, git-mutating Bash commands and reads of protected paths. Do not try to work around it; return a blocked capsule instead.`;
  } else {
    s += "\n10. Edit only files inside the envelope's `owned_paths` plus your allocated artifact. If you need another file, stop and ask via a blocked capsule.";
  }
  if (r.memory) {
    s += `

## Memory

Your persistent memory directory is \`.claude/agent-memory/${name}/\` (Claude Code derives it from the agent name; \`memory: project\`). \`MEMORY.md\` there is the index: one line per memory, \`- [Title](file.md) - hook\`. Each memory is its own file:

\`\`\`markdown
---
name: <kebab-case-slug>
description: <one-line summary used to decide relevance>
metadata:
  type: user | feedback | project | reference
---

<the fact; for feedback/project add **Why:** and **How to apply:** lines>
\`\`\`

Save durable, non-obvious lessons only (not code structure, not facts already in the repo or git history). Never store secrets. Update an existing memory instead of duplicating it. Memory files are not artifacts and never replace the allocated artifact.`;
  }
  if (r.sections) {
    const list = REQUIRED_SECTIONS[r.artifact].map((sec, i) => `${i + 1}. \`## ${sec}\``).join('\n');
    s += `

## Implementation artifact sections

Your \`implementation\` artifact must contain these \`## \` sections, in this order (see \`.ai/artifacts.md\`):

${list}

Fill every section; no \`_TBD_\` placeholder may remain. Put "none" where a section has nothing to report.`;
  }
  return `${s}\n\n${capsule(cfg.agents.unverified)}\n`;
}

export function expectedProfiles(cfg = projectConfig()) {
  const out = {};
  for (const r of ROLES) {
    for (const e of EFFORTS) {
      const name = `${r.id}-${e}`;
      const fm = `---\nname: ${name}\ndescription: ${r.purpose} Effort: ${e}. Spawned only by the coordinator with a bounded envelope.\ntools: ${r.tools}\nmodel: inherit\neffort: ${e}\n${r.memory ? 'memory: project\n' : ''}---\n\n`;
      out[`${name}.md`] = fm + roleBody(r, name, cfg);
    }
  }
  return out;
}

run(() => {
  const a = args({ check: 'boolean', 'out-dir': 'string' });
  const out = a['out-dir'] || join(REPO_ROOT, '.claude', 'agents');
  const expected = expectedProfiles();
  if (a.check) {
    const bad = [];
    for (const [file, text] of Object.entries(expected)) {
      const p = join(out, file);
      if (!existsSync(p)) bad.push(`missing ${file}`);
      else if (readFileSync(p, 'utf8').replace(/\r\n/g, '\n') !== text) bad.push(`out of sync: ${file}`);
    }
    if (existsSync(out)) {
      for (const f of readdirSync(out)) if (f.endsWith('.md') && !(f in expected)) bad.push(`unexpected file ${f}`);
    }
    if (bad.length) throw new Error(`Agent profiles not in sync (run .ai/scripts/generate-claude-agents.mjs):\n  ${bad.join('\n  ')}`);
    return `Agent profiles in sync (${Object.keys(expected).length} files)`;
  }
  mkdirSync(out, { recursive: true });
  for (const [file, text] of Object.entries(expected)) writeUtf8(join(out, file), text);
  return `Generated ${Object.keys(expected).length} agent profiles in ${out}`;
});
