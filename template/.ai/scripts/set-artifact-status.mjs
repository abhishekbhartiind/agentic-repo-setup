#!/usr/bin/env node
// Accepts or rejects a draft artifact. Only the coordinator runs this.
// accepted: validates front matter, author, required sections and placeholders, writes the status into the file, then
//           records the SHA-256 of the final file in the manifest. The file is immutable from then on. A superseded
//           artifact is marked 'superseded' in the manifest only (its file is never touched, so its hash stays valid).
// rejected: only for drafts; rewrites the status line in the draft.
// Usage: set-artifact-status.mjs --work-id APP-001 --uuid <uuid> --status accepted|rejected [--work-root DIR]
// Output: JSON { uuid, status, sha256 }
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  args, findArtifact, getManifest, itemDir, oneOf, readArtifact, run, saveManifest, setFrontMatterValue, sha256File,
  testArtifactSections, testAuthor, workRoot,
} from './_common.mjs';

function acceptProblems(file, e, m, uuid, workId, dir) {
  const { meta, body } = readArtifact(file);
  const problems = [];
  if (meta.id !== uuid) problems.push(`front matter id '${meta.id}' does not match ${uuid}`);
  if (meta.work_id !== workId) problems.push(`front matter work_id '${meta.work_id}' does not match ${workId}`);
  if (meta.kind !== e.kind) problems.push(`front matter kind '${meta.kind}' does not match manifest '${e.kind}'`);
  if (meta.status !== 'draft') problems.push(`front matter status is '${meta.status}', expected draft`);
  const ap = testAuthor(meta.author ?? '');
  if (ap) problems.push(ap);
  else if (/\/(unspecified|pending)$/.test(meta.author)) problems.push('author model is still a placeholder; the producing agent must set <vendor>/<model>');
  if ((meta.supersedes || e.supersedes) && meta.supersedes !== e.supersedes) problems.push('front matter supersedes differs from the manifest');
  problems.push(...testArtifactSections(e.kind, body));

  let old = null;
  if (e.supersedes) {
    old = findArtifact(m, e.supersedes);
    if (!old || old.status !== 'accepted') {
      problems.push(`superseded artifact ${e.supersedes} is not accepted`);
      old = null;
    } else {
      const oldFile = join(dir, old.path);
      if (!existsSync(oldFile) || sha256File(oldFile) !== old.sha256) problems.push(`superseded artifact ${e.supersedes} fails its hash check`);
    }
  }
  return { problems, old };
}

run(() => {
  const a = args({ 'work-id': 'string', uuid: 'string', status: 'string', 'work-root': 'string' }, ['work-id', 'uuid', 'status']);
  const workId = a['work-id'];
  const uuid = a.uuid;
  const status = oneOf('status', a.status, ['accepted', 'rejected']);
  const root = workRoot(a['work-root']);
  const m = getManifest(root, workId);
  const e = findArtifact(m, uuid);
  if (!e) throw new Error(`Artifact ${uuid} is not in ${workId}`);
  if (e.status !== 'draft') throw new Error(`Artifact ${uuid} is '${e.status}'; only drafts change status (accepted artifacts are immutable)`);
  const dir = itemDir(root, workId);
  const file = join(dir, e.path);
  if (!existsSync(file)) throw new Error(`Artifact file missing: ${file}`);

  if (status === 'rejected') {
    setFrontMatterValue(file, 'status', 'rejected');
    e.status = 'rejected';
    saveManifest(root, m);
    return { uuid, status: 'rejected', sha256: null };
  }

  const { problems, old } = acceptProblems(file, e, m, uuid, workId, dir);
  if (problems.length) throw new Error(`Cannot accept ${uuid}:\n  - ${problems.join('\n  - ')}`);

  setFrontMatterValue(file, 'status', 'accepted');
  const hash = sha256File(file);
  e.status = 'accepted';
  e.sha256 = hash;
  if (old) old.status = 'superseded';
  saveManifest(root, m);
  return { uuid, status: 'accepted', sha256: hash };
});
