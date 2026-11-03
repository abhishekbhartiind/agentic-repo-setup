import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { accept, makeReady, manifest, newArtifact, newItem, tempRoot, tool } from './_helpers.mjs';

test('refuses to accept an unfilled draft or a placeholder author', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const a = newArtifact(root, id);
  const r = accept(root, id, a.uuid);
  assert.equal(r.code, 1);
  assert.match(r.err, /unfilled placeholder/);
  makeReady(a.path, 'claude/unspecified');
  assert.match(accept(root, id, a.uuid).err, /placeholder/);
});

test('accept freezes the file and records its hash; accepted artifacts never change status again', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const a = newArtifact(root, id);
  makeReady(a.path);
  const r = accept(root, id, a.uuid);
  assert.equal(r.code, 0);
  assert.match(readFileSync(a.path, 'utf8'), /^status: accepted$/m);
  assert.equal(r.json.sha256, createHash('sha256').update(readFileSync(a.path)).digest('hex'));
  assert.equal(manifest(root, id).artifacts[0].sha256, r.json.sha256);
  assert.equal(accept(root, id, a.uuid).code, 1);
});

test('review needs a valid verdict', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const a = newArtifact(root, id, 'review');
  makeReady(a.path);
  writeFileSync(a.path, readFileSync(a.path, 'utf8').replace('APPROVE', 'LGTM'));
  assert.match(accept(root, id, a.uuid).err, /Verdict must be/);
});

test('superseding marks the old artifact superseded in the manifest only', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const old = newArtifact(root, id);
  makeReady(old.path);
  accept(root, id, old.uuid);
  const oldText = readFileSync(old.path, 'utf8');
  const next = newArtifact(root, id, 'plan', ['--supersedes', old.uuid]);
  makeReady(next.path);
  assert.equal(accept(root, id, next.uuid).code, 0);
  const statuses = Object.fromEntries(manifest(root, id).artifacts.map((x) => [x.uuid, x.status]));
  assert.deepEqual(statuses, { [old.uuid]: 'superseded', [next.uuid]: 'accepted' });
  assert.equal(readFileSync(old.path, 'utf8'), oldText);
});

test('reject rewrites the draft status', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const a = newArtifact(root, id);
  assert.equal(tool('set-artifact-status', ['--work-id', id, '--uuid', a.uuid, '--status', 'rejected', '--work-root', root]).code, 0);
  assert.match(readFileSync(a.path, 'utf8'), /^status: rejected$/m);
});
