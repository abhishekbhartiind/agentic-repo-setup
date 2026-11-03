import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT, tempRoot, tool } from './_helpers.mjs';

test('the committed profiles are in sync', () => {
  const r = tool('generate-claude-agents', ['--check']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /in sync \(18 files\)/);
});

test('generates 18 profiles; memory only for researcher, reviewer and auditor', () => {
  const out = tempRoot();
  assert.equal(tool('generate-claude-agents', ['--out-dir', out]).code, 0);
  const files = readdirSync(out);
  assert.equal(files.length, 18);
  for (const f of files) {
    const text = readFileSync(join(out, f), 'utf8');
    assert.equal(/^memory: project$/m.test(text), /^(code-researcher|code-reviewer|auditor)-/.test(f), f);
  }
  const committed = readFileSync(join(REPO_ROOT, '.claude', 'agents', 'auditor-high.md'), 'utf8');
  assert.equal(readFileSync(join(out, 'auditor-high.md'), 'utf8'), committed);
});

test('--check reports drift and stray files', () => {
  const out = tempRoot();
  tool('generate-claude-agents', ['--out-dir', out]);
  writeFileSync(join(out, 'code-simple-low.md'), 'edited by hand');
  writeFileSync(join(out, 'stray.md'), 'x');
  const r = tool('generate-claude-agents', ['--check', '--out-dir', out]);
  assert.equal(r.code, 1);
  assert.match(r.err, /out of sync: code-simple-low\.md/);
  assert.match(r.err, /unexpected file stray\.md/);
});
