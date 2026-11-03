import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { accept, makeReady, manifest, newArtifact, newItem, tempRoot, tool } from './_helpers.mjs';

const validate = (root) => tool('validate-workflow', ['--scope', 'work', '--work-root', root]);
const save = (root, id, m) => writeFileSync(join(root, id, 'work-item.json'), JSON.stringify(m, null, 2));

test('the real repo layout has no failures', () => {
  const r = tool('validate-workflow');
  assert.match(r.out, / 0 failure\(s\)/, r.out);
  assert.equal(r.code, 0);
});

test('fresh items and accepted artifacts validate', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const a = newArtifact(root, id);
  makeReady(a.path);
  accept(root, id, a.uuid);
  assert.equal(validate(root).code, 0);
});

test('detects a modified accepted artifact', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const a = newArtifact(root, id);
  makeReady(a.path);
  accept(root, id, a.uuid);
  writeFileSync(a.path, readFileSync(a.path, 'utf8') + '\nedited later\n');
  assert.match(validate(root).out, /HASH MISMATCH/);
});

test('detects schema problems, stage/route drift and missing dependencies', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const m = manifest(root, id);
  save(root, id, { ...m, route: 'simple', dependencies: ['XX-001'], extra: 1 });
  const out = validate(root).out;
  assert.match(out, /stages do not match route 'simple'/);
  assert.match(out, /dependency XX-001 does not exist/);
  assert.match(out, /unexpected property 'extra'/);
});

test('flags product work that is ready without an accepted FRP', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  save(root, id, { ...manifest(root, id), status: 'ready' });
  assert.match(validate(root).out, /is ready without an accepted frp artifact/);
});

test('route_history is optional but must be well formed', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const m = manifest(root, id);
  save(root, id, { ...m, route_history: [{ from: 'simple', to: 'standard', at: '2026-10-27T10:00:00Z' }] });
  assert.equal(validate(root).code, 0);
  save(root, id, { ...m, route_history: [{ from: 'simple', to: 'weird' }] });
  const out = validate(root).out;
  assert.match(out, /not in \[simple, standard, high-risk\]/);
  assert.match(out, /missing required 'at'/);
});
