#!/usr/bin/env node
// Allocates the next work item ID for a prefix and creates docs/work/<ID>/ with work-item.json.
// base_commit is the current git HEAD (read-only `git rev-parse HEAD`); null when git fails or the repo has no commit.
// --depends-on is an identifier list: split on commas (`\,` keeps a literal comma).
// Usage: new-work-item.mjs --prefix APP --title "..." [--route standard] [--depends-on APP-001,APP-002]
//        [--status backlog|ready --authorized-by-user] [--work-root DIR]
// Output: JSON { id, path }
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_ROOT, ROUTES, ROUTE_STAGES, STAGE_ROLES, args, expandList, itemDir, oneOf, projectConfig, run, timestamp,
  workRoot, writeJson,
} from './_common.mjs';

function headCommit() {
  try {
    const head = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return /^[0-9a-f]{7,40}$/.test(head) ? head : null;
  } catch {
    return null;
  }
}

run(() => {
  const a = args(
    { prefix: 'string', title: 'string', route: 'string', 'depends-on': 'list', status: 'string', 'authorized-by-user': 'boolean', 'work-root': 'string' },
    ['prefix', 'title'],
  );
  const route = oneOf('route', a.route ?? 'standard', ROUTES);
  const status = oneOf('status', a.status ?? 'backlog', ['backlog', 'ready']);
  const dependsOn = expandList(a['depends-on']);
  const prefixes = projectConfig().work_ids.prefixes.map((p) => p.prefix);
  if (!prefixes.includes(a.prefix)) throw new Error(`Unknown prefix '${a.prefix}'. Allowed: ${prefixes.join(', ')}`);
  if (!a.title.trim()) throw new Error('Title must not be empty');
  if (status === 'ready' && route !== 'simple' && a.prefix !== 'WF') throw new Error(`A ${route} item starts in backlog: it needs an accepted frp artifact before it can be ready`);
  if (status === 'ready' && !a['authorized-by-user']) throw new Error("Status 'ready' requires --authorized-by-user (only the user authorizes work)");

  const root = workRoot(a['work-root']);
  mkdirSync(root, { recursive: true });
  for (const d of dependsOn) {
    if (!existsSync(join(itemDir(root, d), 'work-item.json'))) throw new Error(`Dependency ${d} does not exist`);
  }

  const start = a.prefix === 'WF' ? 0 : 1;
  let max = start - 1;
  const idRe = new RegExp(`^${a.prefix}-(\\d{3,})$`);
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const m = e.isDirectory() && idRe.exec(e.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const id = `${a.prefix}-${String(max + 1).padStart(3, '0')}`;
  const dir = itemDir(root, id);
  mkdirSync(dir); // fails if another process took the ID
  mkdirSync(join(dir, 'artifacts'));

  const now = timestamp();
  writeJson(join(dir, 'work-item.json'), {
    id,
    title: a.title.trim(),
    status,
    route,
    dependencies: dependsOn,
    base_commit: headCommit(),
    owned_paths: [],
    acceptance_criteria: [],
    stages: ROUTE_STAGES[route].map((name) => ({ name, role: STAGE_ROLES[name], status: 'pending', artifact: null })),
    artifacts: [],
    open_decisions: [],
    created: now,
    updated: now,
  });
  return { id, path: dir };
});
