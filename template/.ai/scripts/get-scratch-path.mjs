#!/usr/bin/env node
// Prints a per-user temp directory outside the repo (created if missing).
// Override the base with $AI_SCRATCH_BASE (used by tests).
// Usage: get-scratch-path.mjs [--sub-path NAME]
import { mkdirSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { REPO_ROOT, args, projectConfig, run } from './_common.mjs';

run(() => {
  const a = args({ 'sub-path': 'string' });
  const base = process.env.AI_SCRATCH_BASE || tmpdir();
  const user = userInfo().username.replace(/[^\w.-]/g, '_');
  let name;
  try {
    name = projectConfig().identity.name;
  } catch {
    name = basename(REPO_ROOT);
  }
  const full = resolve(join(base, name, user, a['sub-path'] ?? ''));
  // macOS and Windows file systems are case-insensitive by default.
  const fold = (p) => (process.platform === 'linux' ? p : p.toLowerCase());
  const repo = resolve(REPO_ROOT) + sep;
  if (fold(full + sep).startsWith(fold(repo))) throw new Error(`Scratch path ${full} is inside the repo`);
  mkdirSync(full, { recursive: true });
  return full;
});
