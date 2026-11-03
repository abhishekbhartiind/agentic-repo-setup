import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const INSTALL = join(dirname(fileURLToPath(import.meta.url)), '..', 'install.mjs');
const temp = () => mkdtempSync(join(tmpdir(), 'ai-template-'));
const install = (repo, ...argv) => spawnSync(process.execPath, [INSTALL, repo, '--yes', ...argv], { encoding: 'utf8', input: '' });
const read = (repo, f) => readFileSync(join(repo, f), 'utf8');
const json = (repo, f) => JSON.parse(read(repo, f));

function existingRepo() {
  const repo = temp();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: '@acme/order-api', description: 'Order API', scripts: { lint: 'eslint .', test: 'vitest run', build: 'tsc -p .' }, devDependencies: { prettier: '3', '@nestjs/core': '10' } }));
  writeFileSync(join(repo, 'tsconfig.json'), '{}');
  writeFileSync(join(repo, 'AGENTS.md'), '# Order API\n\nOwn rules.\n');
  writeFileSync(join(repo, 'CLAUDE.md'), '# Claude\n\nBe nice.\n');
  mkdirSync(join(repo, '.claude'));
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } }));
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: repo });
  return repo;
}

test('new repo: installs, validates, and the installed workflow tests pass', () => {
  const repo = join(temp(), 'my-shop');
  const r = install(repo);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, / 0 failure\(s\)/);
  assert.match(read(repo, 'docs/PRP.md'), /^# my-shop - PRP/m);
  assert.match(read(repo, 'AGENTS.md'), /prefix `MS` for product work/);
  assert.match(read(repo, 'CLAUDE.md'), /@AGENTS\.md/);
  assert.doesNotMatch(read(repo, '.ai/workflow.md'), /\{\{/);
  const tests = readdirSync(join(repo, '.ai/tests')).filter((f) => f.endsWith('.test.mjs')).map((f) => `.ai/tests/${f}`);
  // Without NODE_TEST_CONTEXT the nested run is a real, separate test run instead of reporting into this one.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const t = spawnSync(process.execPath, ['--test', ...tests], { cwd: repo, encoding: 'utf8', env });
  assert.equal(t.status, 0, t.stdout.slice(-3000));
  assert.match(t.stdout, /ℹ fail 0/);
  assert.ok(Number(/ℹ pass (\d+)/.exec(t.stdout)?.[1]) >= 55, t.stdout.slice(-500));
});

test('existing repo: keeps its docs and hooks, detects commands, protects artifacts from the formatter', () => {
  const repo = existingRepo();
  const r = install(repo);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const cfg = json(repo, '.ai/project.json');
  assert.equal(cfg.identity.name, 'order-api');
  assert.deepEqual(cfg.commands.map((c) => c.run), ['npx tsc --noEmit', 'npm run lint', 'npm test', 'npm run build']);
  assert.equal(cfg.work_ids.prefixes[1].prefix, 'OA');
  assert.match(read(repo, 'AGENTS.md'), /^# Order API\n\nOwn rules\.\n\n<!-- BEGIN:ai-workflow -->/);
  assert.match(read(repo, 'CLAUDE.md'), /Be nice\.[\s\S]*<!-- END:ai-workflow -->\n@AGENTS\.md/);
  const hooks = json(repo, '.claude/settings.json');
  assert.deepEqual(hooks.permissions, { allow: ['Bash(ls)'] });
  assert.equal(hooks.hooks.PreToolUse.length, 2);
  assert.match(read(repo, '.prettierignore'), /^docs\/work\/$/m);
  assert.match(read(repo, '.gitignore'), /^\.claude\/settings\.local\.json$/m);
});

test('python repo: detects stack and commands without a package.json', () => {
  const repo = temp();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'pyproject.toml'), '[project]\nname = "order-api"\ndependencies = ["fastapi"]\n\n[tool.ruff]\nline-length = 100\n\n[tool.mypy]\nstrict = true\n\n[build-system]\nrequires = ["hatchling"]\n');
  writeFileSync(join(repo, 'requirements.txt'), 'pytest==8.0.0\n');
  writeFileSync(join(repo, 'uv.lock'), '');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: repo });

  const r = install(repo);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const cfg = json(repo, '.ai/project.json');
  assert.equal(cfg.identity.package_manager, 'uv');
  assert.deepEqual(cfg.commands.map((c) => c.run), ['uv run mypy .', 'uv run ruff check .', 'uv run ruff format --check .', 'uv run pytest', 'uv build']);
  assert.match(cfg.identity.platform, /Python, FastAPI/);
});

test('answers file sets the answers', () => {
  const repo = temp();
  const answers = join(temp(), 'a.json');
  writeFileSync(answers, JSON.stringify({ name: 'Billing', prefix: 'BIL', prp: 'docs/product/PRP.md' }));
  assert.equal(install(repo, '--answers', answers).status, 0);
  assert.equal(json(repo, '.ai/project.json').work_ids.prefixes[1].prefix, 'BIL');
  assert.match(read(repo, 'docs/product/PRP.md'), /^# Billing - PRP/m);
});

test('refuses to overwrite; --force upgrades tooling but keeps project-owned files and answers', () => {
  const repo = existingRepo();
  assert.equal(install(repo).status, 0);
  const r = install(repo);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exist/);

  writeFileSync(join(repo, '.ai/project-context.md'), '# tuned by /setup-ai\n');
  writeFileSync(join(repo, 'docs/PRP.md'), read(repo, 'docs/PRP.md').replace('- G1: _TBD_', '- G1: Ship orders'));
  const cfg = json(repo, '.ai/project.json');
  cfg.commands.push({ id: 'e2e', run: 'npm run e2e' });
  writeFileSync(join(repo, '.ai/project.json'), JSON.stringify(cfg, null, 2));
  writeFileSync(join(repo, '.ai/scripts/new-work-item.mjs'), '// stale');

  assert.equal(install(repo, '--force').status, 0);
  assert.equal(read(repo, '.ai/project-context.md'), '# tuned by /setup-ai\n');
  assert.match(read(repo, 'docs/PRP.md'), /G1: Ship orders/);
  assert.ok(json(repo, '.ai/project.json').commands.some((c) => c.id === 'e2e'));
  assert.match(read(repo, '.ai/scripts/new-work-item.mjs'), /Allocates the next work item ID/);
  assert.equal(read(repo, 'AGENTS.md').match(/BEGIN:ai-workflow/g).length, 1);
  assert.equal(read(repo, 'CLAUDE.md').match(/@AGENTS\.md/g).length, 1);
});
