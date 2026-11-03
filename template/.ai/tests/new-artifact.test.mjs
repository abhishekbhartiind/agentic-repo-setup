import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { manifest, newArtifact, newItem, prefix, tempRoot, tool } from './_helpers.mjs';

test('allocates a draft from the template and registers it', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  const a = newArtifact(root, id, 'review');
  assert.match(a.relative_path, new RegExp(`^artifacts/review-${a.uuid.slice(0, 8)}\\.md$`));
  const text = readFileSync(a.path, 'utf8');
  assert.match(text, /^status: draft$/m);
  assert.match(text, /^## Verdict$/m);
  assert.match(text, /^## Capsule: Next$/m);
  assert.deepEqual(manifest(root, id).artifacts[0], { uuid: a.uuid, kind: 'review', path: a.relative_path, status: 'draft', supersedes: null, sha256: null });
});

test('refuses unknown items, bad authors and superseding a draft', () => {
  const root = tempRoot();
  const id = newItem(root).id;
  assert.notEqual(tool('new-artifact', ['--work-id', `${prefix()}-099`, '--kind', 'plan', '--work-root', root]).code, 0);
  assert.equal(tool('new-artifact', ['--work-id', id, '--kind', 'plan', '--author', 'acme/x', '--work-root', root]).code, 1);
  const draft = newArtifact(root, id);
  assert.equal(tool('new-artifact', ['--work-id', id, '--kind', 'plan', '--supersedes', draft.uuid, '--work-root', root]).code, 1);
});
