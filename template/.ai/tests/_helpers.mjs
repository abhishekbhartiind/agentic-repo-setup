// Test helpers for .ai/tests (node:test). Scripts run as child processes against a temp work root, never docs/work.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
export const REPO_ROOT = resolve(SCRIPTS, '..', '..');

/** Runs a script; returns { code, out, err, json } (json is the parsed stdout when it is JSON). */
export function tool(name, argv = [], { input, env } = {}) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, `${name}.mjs`), ...argv], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    // not JSON output
  }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

export function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'ai-work-'));
}

export function prefix() {
  const cfg = JSON.parse(readFileSync(join(REPO_ROOT, '.ai', 'project.json'), 'utf8'));
  return cfg.work_ids.prefixes.find((p) => p.prefix !== 'WF').prefix;
}

export function newItem(root, { route = 'standard', p = prefix(), extra = [] } = {}) {
  const r = tool('new-work-item', ['--prefix', p, '--title', 'Test item', '--route', route, '--work-root', root, ...extra]);
  if (r.code !== 0) throw new Error(`new-work-item failed: ${r.err}`);
  return r.json;
}

export function newArtifact(root, id, kind = 'plan', extra = []) {
  const r = tool('new-artifact', ['--work-id', id, '--kind', kind, '--work-root', root, ...extra]);
  if (r.code !== 0) throw new Error(`new-artifact failed: ${r.err}`);
  return r.json;
}

/** Fills placeholders, sets a real author and, for review/audit, writes a valid verdict. */
export function makeReady(path, author = 'claude/claude-sonnet-5-5') {
  const t = readFileSync(path, 'utf8')
    .replace(/_TBD_/g, 'filled in by test')
    .replace(/^author: .*$/m, `author: ${author}`)
    .replace(/(## Verdict\s*\n\s*)filled in by test/, '$1APPROVE');
  writeFileSync(path, t);
}

export function accept(root, id, uuid) {
  return tool('set-artifact-status', ['--work-id', id, '--uuid', uuid, '--status', 'accepted', '--work-root', root]);
}

export function manifest(root, id) {
  return JSON.parse(readFileSync(join(root, id, 'work-item.json'), 'utf8'));
}
