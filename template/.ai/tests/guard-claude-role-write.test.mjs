import assert from 'node:assert/strict';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import { REPO_ROOT, accept, makeReady, newArtifact, newItem, tempRoot, tool } from './_helpers.mjs';

const BASES = ['code-researcher', 'code-planner', 'code-reviewer', 'auditor'];
const ROLES = BASES.flatMap((b) => [b, `${b}-low`, `${b}-medium`, `${b}-high`]);
const MEMORY = new Set(['code-researcher', 'code-reviewer', 'auditor']);
const baseOf = (role) => role.replace(/-(low|medium|high)$/, '');

let root;
let draft;
let accepted;
let id;

const guard = (agent, toolName, toolInput, { noType = false } = {}) => {
  const input = { session_id: 's', cwd: REPO_ROOT, hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput };
  if (agent) {
    if (!noType) input.agent_type = agent;
    input.agent_id = 'agent-1';
  }
  return tool('guard-claude-role-write', [], { input: JSON.stringify(input), env: { AI_WORK_ROOT: root } }).code;
};

before(() => {
  root = tempRoot();
  id = newItem(root).id;
  draft = newArtifact(root, id).path;
  const acc = newArtifact(root, id);
  makeReady(acc.path);
  accept(root, id, acc.uuid);
  accepted = acc.path;
});

describe('role identification', () => {
  test('main session and unrestricted agents are allowed', () => {
    assert.equal(guard(null, 'Write', { file_path: 'src/a.ts' }), 0);
    assert.equal(guard('code-implementer-medium', 'Write', { file_path: 'src/a.ts' }), 0);
  });
  test('fails closed on an unknown role, bad JSON or a missing tool name', () => {
    assert.equal(guard('x', 'Write', { file_path: 'src/a.ts' }, { noType: true }), 2);
    assert.equal(tool('guard-claude-role-write', [], { input: 'not json' }).code, 2);
    assert.equal(guard('auditor', undefined, {}), 2);
  });
});

describe('writes', () => {
  for (const role of ROLES) {
    test(`${role} writes only its draft artifact (and its memory if memory-enabled)`, () => {
      assert.equal(guard(role, 'Write', { file_path: draft }), 0);
      assert.equal(guard(role, 'Edit', { file_path: accepted }), 2);
      assert.equal(guard(role, 'Write', { file_path: join(root, id, 'artifacts', 'new.md') }), 2);
      assert.equal(guard(role, 'Write', { file_path: join(root, id, 'artifacts', '..', 'work-item.json') }), 2);
      assert.equal(guard(role, 'Write', { file_path: 'src/main.ts' }), 2);
      assert.equal(guard(role, 'Write', { file_path: `.claude/agent-memory/${role}/MEMORY.md` }), MEMORY.has(baseOf(role)) ? 0 : 2);
      assert.equal(guard(role, 'Write', { file_path: '.claude/agent-memory/someone-else/MEMORY.md' }), 2);
    });
  }
});

describe('protected paths and Bash', () => {
  for (const role of BASES) {
    test(`${role} cannot read protected files`, () => {
      for (const p of ['.env', '.env.production', join(REPO_ROOT, '.env.production'), '.env.development.local', '.env.local', 'credentials.json', 'certs/server.pem', 'a/b/AuthKey.p8', 'cert.p12', '.claude/settings.local.json']) {
        assert.equal(guard(role, 'Read', { file_path: p }), 2, p);
      }
      assert.equal(guard(role, 'Grep', { pattern: 'KEY', path: '.env.local' }), 2);
      assert.equal(guard(role, 'Glob', { pattern: '.env*' }), 2);
      assert.equal(guard(role, 'Bash', { command: 'cat .env' }), 2);
      assert.equal(guard(role, 'Bash', { command: 'cat .env*' }), 2);
      assert.equal(guard(role, 'Bash', { command: 'type "config\\.env.local"' }), 2);
    });
    test(`${role} can read normal files and .env.example`, () => {
      assert.equal(guard(role, 'Read', { file_path: 'package.json' }), 0);
      assert.equal(guard(role, 'Read', { file_path: '.env.example' }), 0);
    });
    test(`${role} cannot run mutating git, redirects or file-writing commands`, () => {
      for (const c of ['git commit -m x', 'git -C . add .', 'git stash', 'echo hi > src/a.ts', 'rm -rf src', 'sed -i s/a/b/ x', 'npm install left-pad']) {
        assert.equal(guard(role, 'Bash', { command: c }), 2, c);
      }
      for (const c of ['git status --short', 'git diff HEAD', 'git stash list', 'npm test 2>/dev/null', 'ls src']) {
        assert.equal(guard(role, 'Bash', { command: c }), 0, c);
      }
    });
  }
});
