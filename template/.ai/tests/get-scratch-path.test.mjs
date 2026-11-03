import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { REPO_ROOT, tempRoot, tool } from './_helpers.mjs';

test('creates a per-user directory outside the repo', () => {
  const base = tempRoot();
  const r = tool('get-scratch-path', ['--sub-path', 'x'], { env: { AI_SCRATCH_BASE: base } });
  assert.equal(r.code, 0);
  const dir = r.out.trim();
  assert.ok(dir.startsWith(base));
  assert.ok(existsSync(dir));
});

test('refuses a scratch path inside the repo', () => {
  const r = tool('get-scratch-path', [], { env: { AI_SCRATCH_BASE: REPO_ROOT } });
  assert.equal(r.code, 1);
  assert.match(r.err, /inside the repo/);
});
