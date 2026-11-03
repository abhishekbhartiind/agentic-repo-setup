import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { accept, makeReady, manifest, newArtifact, newItem, tempRoot, tool } from './_helpers.mjs';

const update = (root, id, ...argv) => tool('update-work-item', ['--id', id, '--work-root', root, ...argv]);

const acceptFrp = (root, id) => {
  const frp = newArtifact(root, id, 'frp');
  makeReady(frp.path);
  assert.equal(accept(root, id, frp.uuid).code, 0);
};

test('standard product work needs an accepted FRP before ready', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const r = update(root, id, '--status', 'ready', '--authorized-by-user');
  assert.equal(r.code, 1);
  assert.match(r.err, /accepted frp/);
  acceptFrp(root, id);
  assert.equal(update(root, id, '--status', 'ready', '--authorized-by-user').code, 0);
  const wf = newItem(root, { p: 'WF' }).id;
  assert.equal(update(root, wf, '--status', 'ready', '--authorized-by-user').code, 0);
});

test('ready needs the user, in_progress needs done dependencies', () => {
  const root = tempRoot();
  const dep = newItem(root).id;
  const id = newItem(root, { extra: ['--depends-on', dep] }).id;
  acceptFrp(root, id);
  assert.equal(update(root, id, '--status', 'ready').code, 1);
  assert.equal(update(root, id, '--status', 'ready', '--authorized-by-user').code, 0);
  const r = update(root, id, '--status', 'in_progress');
  assert.equal(r.code, 1);
  assert.match(r.err, /not done/);
  assert.equal(update(root, id, '--status', 'done').code, 1); // invalid transition ready -> done
});

test('a stage is done only with an accepted artifact, and done needs every stage finished', () => {
  const root = tempRoot();
  const id = newItem(root, { route: 'simple' }).id;
  update(root, id, '--status', 'ready', '--authorized-by-user');
  update(root, id, '--status', 'in_progress');
  const art = newArtifact(root, id, 'implementation');
  assert.equal(update(root, id, '--stage-name', 'simple', '--stage-status', 'done', '--stage-artifact', art.uuid).code, 1);
  assert.equal(update(root, id, '--status', 'done').code, 1);
  makeReady(art.path);
  assert.equal(accept(root, id, art.uuid).code, 0);
  assert.equal(update(root, id, '--stage-name', 'simple', '--stage-status', 'done', '--stage-artifact', art.uuid).code, 0);
  assert.equal(update(root, id, '--status', 'done').code, 0);
  assert.equal(update(root, id, '--add-open-decision', 'x').code, 1); // terminal
});

test('identifier lists split on commas, prose lists only on ||', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  update(root, id, '--set-owned-paths', 'src/a.ts,src/b\\,c.ts');
  update(root, id, '--add-acceptance-criteria', 'Handles empty, null, and missing input||Second item');
  update(root, id, '--add-open-decision', 'one, still one', '--add-open-decision', 'two');
  const m = manifest(root, id);
  assert.deepEqual(m.owned_paths, ['src/a.ts', 'src/b,c.ts']);
  assert.deepEqual(m.acceptance_criteria, ['Handles empty, null, and missing input', 'Second item']);
  assert.deepEqual(m.open_decisions, ['one, still one', 'two']);
});

test('route change migrates stages, records history, and same route writes nothing', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const r = update(root, id, '--route', 'high-risk');
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.stages, ['research', 'plan', 'implement', 'review', 'audit']);
  assert.equal(manifest(root, id).route_history.length, 1);
  const before = readFileSync(join(root, id, 'work-item.json'), 'utf8');
  assert.equal(update(root, id, '--route', 'high-risk').code, 0);
  assert.equal(readFileSync(join(root, id, 'work-item.json'), 'utf8'), before);
});

test('route change refuses to drop a stage that has work, and leaves the manifest untouched', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const art = newArtifact(root, id, 'research');
  update(root, id, '--stage-name', 'research', '--stage-status', 'in_progress', '--stage-artifact', art.uuid);
  const before = readFileSync(join(root, id, 'work-item.json'), 'utf8');
  const r = update(root, id, '--route', 'simple');
  assert.equal(r.code, 1);
  assert.match(r.err, /'research' has artifact/);
  assert.equal(readFileSync(join(root, id, 'work-item.json'), 'utf8'), before);
});

test('simple and implement map to each other on a route change', () => {
  const root = tempRoot();
  const id = newItem(root, { route: 'simple' }).id;
  const art = newArtifact(root, id, 'implementation');
  update(root, id, '--stage-name', 'simple', '--stage-status', 'in_progress', '--stage-artifact', art.uuid);
  assert.equal(update(root, id, '--route', 'standard').code, 0);
  const impl = manifest(root, id).stages.find((s) => s.name === 'implement');
  assert.equal(impl.artifact, art.uuid);
  assert.equal(impl.status, 'in_progress');
});
