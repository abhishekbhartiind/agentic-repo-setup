#!/usr/bin/env node
// Claude Code PreToolUse hook. Constrains the restricted workflow roles
// (code-researcher, code-planner, code-reviewer, auditor; any -low/-medium/-high variant).
//
// Role identification: the hook input fields `agent_type` (the subagent name) and `agent_id`.
//   - no agent_type and no agent_id   -> main session, allowed
//   - agent_id but no agent_type      -> role unknown, DENY (fail closed)
//   - agent_type is a restricted role -> rules below apply
//   - any other agent_type            -> allowed
//   - unparsable input / no tool_name -> DENY (fail closed)
//
// Restricted roles:
//   Write/Edit/MultiEdit/NotebookEdit only on (a) an existing DRAFT artifact under <work root>/<ID>/artifacts/*.md or
//   (b) .claude/agent-memory/<agent_type or base role>/** for memory-enabled roles (researcher, reviewer, auditor).
//   Bash: no mutating git, no obvious file-writing commands or redirects.
//   Read/Grep/Glob/Bash: no access to .ai/project.json policy.protected_paths.
// Deny = exit 2 with the reason on stderr (Claude Code hook contract). Allow = exit 0, no output.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { REPO_ROOT, like } from './_common.mjs';

function deny(reason) {
  process.stderr.write(`BLOCKED by guard-claude-role-write: ${reason}\n`);
  process.exit(2);
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  deny('hook input is not valid JSON (fail closed)');
}
if (input === null || typeof input !== 'object') deny('hook input is not a JSON object (fail closed)');

const { agent_type: agentType, agent_id: agentId, tool_name: tool } = input;
const ti = input.tool_input ?? {};

if (!agentType) {
  if (agentId) deny('called from a subagent whose type is not reported (agent_type missing); role cannot be identified (fail closed)');
  process.exit(0); // main session
}
const roleMatch = /^(code-researcher|code-planner|code-reviewer|auditor)(-(low|medium|high))?$/.exec(agentType);
if (!roleMatch) process.exit(0);
const base = roleMatch[1];
if (!tool) deny('hook input has no tool_name (fail closed)');

const workRoot = process.env.AI_WORK_ROOT || join(REPO_ROOT, 'docs', 'work');
let protectedPaths;
try {
  protectedPaths = JSON.parse(readFileSync(join(REPO_ROOT, '.ai', 'project.json'), 'utf8')).policy.protected_paths;
  if (!Array.isArray(protectedPaths) || protectedPaths.length === 0) throw new Error('empty');
} catch {
  deny('cannot load policy.protected_paths from .ai/project.json (fail closed)');
}

const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');

/** True when a path/token refers to a protected file, or is a wildcard that could expand to a .env file. */
function isProtectedToken(token) {
  const t = norm(token.replace(/^["'`(),;]+|["'`(),;]+$/g, '')).toLowerCase();
  if (!t) return false;
  const leaf = t.slice(t.lastIndexOf('/') + 1);
  for (const pat of protectedPaths) {
    const p = norm(pat).toLowerCase();
    if (p.includes('/') ? like(t, `*${p}`) : like(leaf, p)) return true;
  }
  return /(^|\/)\.env[^/]*$/.test(t) && /[*?[]/.test(t); // e.g. .env* could expand to .env
}

function protectedHit(text) {
  return text.split(/[\s=]+/).find(isProtectedToken) ?? null;
}

const full = (p) => norm(resolve(isAbsolute(p) ? p : join(REPO_ROOT, p)));
const startsWithCi = (s, prefix) => s.toLowerCase().startsWith(prefix.toLowerCase());

function guardWrite() {
  const p = ti.file_path || ti.notebook_path;
  if (!p) deny(`${tool} without a file path (fail closed)`);
  const target = full(p);
  if (startsWithCi(target, `${norm(resolve(workRoot))}/`) && /\/[A-Z]{2,5}-\d{3,}\/artifacts\/[^/]+\.md$/i.test(target)) {
    const text = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
    if (/^---\n[\s\S]*?\nstatus: draft\n[\s\S]*?---/.test(text)) process.exit(0);
    deny(`'${p}' is not an existing draft artifact. Write only to the artifact the coordinator allocated (status: draft).`);
  }
  if (base !== 'code-planner') {
    for (const role of [agentType, base]) {
      if (startsWithCi(target, `${norm(join(REPO_ROOT, '.claude', 'agent-memory', role))}/`)) process.exit(0);
    }
  }
  const memory = base !== 'code-planner' ? ' and its own .claude/agent-memory/<role>/ directory' : '';
  deny(`${agentType} may write only its allocated draft artifact${memory}. '${p}' is outside that.`);
}

function guardRead() {
  for (const f of ['file_path', 'path', 'pattern', 'glob']) {
    const v = ti[f];
    if (typeof v === 'string' && v) {
      const hit = protectedHit(v);
      if (hit) deny(`${tool} of protected path '${hit}' is not allowed`);
    }
  }
  process.exit(0);
}

const BLOCKED_GIT = ['checkout', 'switch', 'restore', 'reset', 'clean', 'commit', 'push', 'rebase', 'merge', 'cherry-pick', 'am', 'revert', 'add', 'rm', 'mv', 'pull', 'apply', 'tag', 'worktree'];

function guardBash() {
  const cmd = String(ti.command ?? '');
  if (!cmd) deny('Bash without a command (fail closed)');

  const gitRe = /(?<![\w.-])git(?:\.exe)?\s+(?:(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?|-\w+)\s+)*(?<sub>[a-z][\w-]*)(?<rest>[^|;&\n]*)/gi;
  for (const m of cmd.matchAll(gitRe)) {
    const sub = m.groups.sub.toLowerCase();
    if (sub === 'stash') {
      if (/^(list|show)\b/.test(m.groups.rest.trim())) continue;
      deny("git stash is blocked (only 'git stash list' and 'git stash show' are allowed)");
    }
    if (BLOCKED_GIT.includes(sub)) deny(`git ${sub} is blocked for ${agentType} (restricted roles cannot change the working tree, index or history)`);
  }

  for (const m of cmd.matchAll(/(?<![=\-<>])\d?>>?(?!&)\s*(?<t>[^\s|;&]+)/g)) {
    const t = m.groups.t.replace(/^["']+|["']+$/g, '');
    if (!['/dev/null', '$null', 'nul', 'NUL'].includes(t)) deny(`output redirection to '${t}' is blocked; only the allocated artifact may be written, via the Write/Edit tools`);
  }
  const w = /(?<![\w-])(tee|rm|rmdir|del|mv|cp|mkdir|touch|truncate|sed\s+-i|npm\s+(?:install|i|uninstall|ci))(?![\w-])/i.exec(cmd);
  if (w) deny(`command '${w[1]}' modifies files and is blocked for ${agentType}`);

  const hit = protectedHit(cmd);
  if (hit) deny(`command references protected path '${hit}'`);
  process.exit(0);
}

if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) guardWrite();
else if (/^(Read|Grep|Glob)$/.test(tool)) guardRead();
else if (tool === 'Bash') guardBash();
process.exit(0);
