import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { manifest, newItem, prefix, tempRoot, tool } from './_helpers.mjs';

const P = prefix();

test('starts product IDs at 001 and WF at 000, with folder, artifacts dir and manifest', () => {
  const root = tempRoot();
  assert.equal(newItem(root).id, `${P}-001`);
  assert.equal(newItem(root).id, `${P}-002`);
  assert.equal(newItem(root, { p: 'WF' }).id, 'WF-000');
  assert.ok(existsSync(join(root, `${P}-001`, 'artifacts')));
  const m = manifest(root, `${P}-001`);
  assert.equal(m.status, 'backlog');
  assert.deepEqual(m.stages.map((s) => s.name), ['research', 'plan', 'implement', 'review']);
  assert.match(m.base_commit ?? '', /^([0-9a-f]{7,40})?$/);
});

test('route decides the stages', () => {
  const root = tempRoot();
  assert.deepEqual(manifest(root, newItem(root, { route: 'simple' }).id).stages.map((s) => s.name), ['simple']);
  assert.equal(manifest(root, newItem(root, { route: 'high-risk' }).id).stages.at(-1).role, 'auditor');
});

test('refuses unknown prefixes, missing dependencies and unauthorized ready', () => {
  const root = tempRoot();
  assert.equal(tool('new-work-item', ['--prefix', 'XX', '--title', 't', '--work-root', root]).code, 1);
  assert.equal(tool('new-work-item', ['--prefix', P, '--title', 't', '--depends-on', `${P}-099`, '--work-root', root]).code, 1);
  assert.equal(tool('new-work-item', ['--prefix', P, '--title', 't', '--status', 'ready', '--work-root', root]).code, 1);
  assert.equal(tool('new-work-item', ['--prefix', P, '--title', 't', '--status', 'ready', '--authorized-by-user', '--work-root', root]).code, 1); // standard needs an FRP first
  assert.equal(tool('new-work-item', ['--prefix', P, '--title', 't', '--route', 'simple', '--status', 'ready', '--authorized-by-user', '--work-root', root]).code, 0);
});

test('--depends-on splits on commas', () => {
  const root = tempRoot();
  const a = newItem(root).id;
  const b = newItem(root).id;
  const c = newItem(root, { extra: ['--depends-on', `${a},${b}`] }).id;
  assert.deepEqual(manifest(root, c).dependencies, [a, b]);
});
