#!/usr/bin/env node
// Allocates a draft artifact for a work item from the template of its kind and registers it in the manifest.
// Usage: new-artifact.mjs --work-id APP-001 --kind plan [--supersedes <uuid>] [--author claude/<model>] [--work-root DIR]
// Output: JSON { uuid, path, relative_path, work_id, kind }
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  KINDS, UUID_RE, args, artifactTemplate, findArtifact, getManifest, itemDir, newUuid, oneOf, run, saveManifest,
  testAuthor, timestamp, workRoot, writeUtf8,
} from './_common.mjs';

run(() => {
  const a = args({ 'work-id': 'string', kind: 'string', supersedes: 'string', author: 'string', 'work-root': 'string' }, ['work-id', 'kind']);
  const workId = a['work-id'];
  const kind = oneOf('kind', a.kind, KINDS);
  const author = a.author ?? 'claude/unspecified';
  const sup = a.supersedes || null;
  const root = workRoot(a['work-root']);
  const m = getManifest(root, workId);
  if (['done', 'cancelled'].includes(m.status)) throw new Error(`${workId} is ${m.status}; no new artifacts`);
  const authorProblem = testAuthor(author);
  if (authorProblem) throw new Error(authorProblem);

  if (sup) {
    if (!UUID_RE.test(sup)) throw new Error('--supersedes must be a uuid v4');
    const old = findArtifact(m, sup);
    if (!old) throw new Error(`Artifact ${sup} is not in ${workId}`);
    if (old.status !== 'accepted') throw new Error(`Only an accepted artifact can be superseded; ${sup} is '${old.status}'`);
    if (old.kind !== kind) throw new Error(`Kind mismatch: superseded artifact is '${old.kind}', new one is '${kind}'`);
    if (m.artifacts.some((x) => x.supersedes === sup && x.status === 'draft')) throw new Error(`A draft superseding ${sup} already exists`);
  }

  const uuid = newUuid();
  const rel = `artifacts/${kind}-${uuid.slice(0, 8)}.md`;
  const full = join(itemDir(root, workId), rel);
  if (existsSync(full)) throw new Error(`Artifact file already exists: ${full}`);
  writeUtf8(full, artifactTemplate(kind, uuid, workId, author, timestamp(), sup));

  m.artifacts = [...m.artifacts, { uuid, kind, path: rel, status: 'draft', supersedes: sup, sha256: null }];
  saveManifest(root, m);
  return { uuid, path: full, relative_path: rel, work_id: workId, kind };
});
