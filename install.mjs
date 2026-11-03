#!/usr/bin/env node
// Installs the AI workflow template (.ai/, .claude/, PRP, AGENTS.md and CLAUDE.md blocks) into a new or existing repo.
// It asks about the repo, proposing answers it detects from the repo itself. Nothing is committed.
//
// Usage: node install.mjs [repo-dir] [--yes] [--force] [--answers answers.json]
//   --yes      accept every detected default without asking (also used when stdin is not a terminal)
//   --answers  JSON file with answers by question key; asked questions default to these values
//   --force    upgrade an existing install: replace the template's tooling (scripts, tests, schemas, workflow docs,
//              skills) but keep project-owned files (project.json, project-context.md, rules, the PRP). Earlier
//              answers (saved in .ai/project.json "template") are the defaults.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'template');
const COMMAND_IDS = ['typecheck', 'lint', 'format-check', 'test', 'build'];
const PROVES = {
  typecheck: ['Types are consistent', 'Runtime behavior'],
  lint: ['Lint rules pass', 'Correctness'],
  'format-check': ['Formatting matches the formatter', 'Anything semantic'],
  test: ['The automated tests pass', 'Behavior the tests do not cover, real external services'],
  build: ['The project builds', 'That it runs correctly with real config'],
};
// Files the repo owns after install (filled by /setup-ai, /prp or by hand): written once, never overwritten.
const PROJECT_OWNED = new Set(['.ai/project-context.md', '.ai/rules/testing.md', '.ai/rules/config-and-env.md', '.claude/rules/testing.md', '.claude/rules/config-and-env.md']);
const DEFAULT_PROTECTED = ['.env', '.env.local', '.env.*.local', '.env.development', '.env.staging', '.env.production', '.env.test', 'credentials.json', '*.pem', '*.key', '*.p8', '*.p12', '*.keystore', '.claude/settings.local.json'];

// ---------- detection

function readJsonIfAny(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readIfAny(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function detectPython(repo, has) {
  const hasPy = has('pyproject.toml') || has('requirements.txt') || has('setup.py') || has('setup.cfg');
  if (!hasPy) return null;
  const text = `${readIfAny(join(repo, 'pyproject.toml'))}\n${readIfAny(join(repo, 'requirements.txt'))}\n${readIfAny(join(repo, 'requirements-dev.txt'))}`;
  const hasTool = (name) => new RegExp(`\\[tool\\.${name}(\\.|\\])|(^|["'\\s])${name}(\\[|[\\s"'=<>!~,]|$)`, 'im').test(text);
  const pm = has('uv.lock') ? 'uv' : has('poetry.lock') ? 'poetry' : has('Pipfile.lock') ? 'pipenv' : 'pip';
  const run = (cmd) => (pm === 'pip' ? cmd : `${pm} run ${cmd}`);
  const frameworks = [['django', 'Django'], ['fastapi', 'FastAPI'], ['flask', 'Flask']].filter(([d]) => hasTool(d)).map(([, n]) => n);
  return {
    pm,
    frameworks,
    commands: {
      typecheck: hasTool('mypy') ? run('mypy .') : hasTool('pyright') ? run('pyright') : '',
      lint: hasTool('ruff') ? run('ruff check .') : hasTool('flake8') ? run('flake8') : '',
      'format-check': hasTool('ruff') ? run('ruff format --check .') : hasTool('black') ? run('black --check .') : '',
      test: hasTool('pytest') || has('tests') || has('test') ? run('pytest') : '',
      build: pm === 'uv' ? 'uv build' : pm === 'poetry' ? 'poetry build' : /\[build-system\]/.test(text) ? 'python -m build' : '',
    },
  };
}

function detect(repo) {
  const pkg = readJsonIfAny(join(repo, 'package.json')) ?? {};
  const scripts = pkg.scripts ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (f) => existsSync(join(repo, f));
  const python = detectPython(repo, has);
  const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lock') || has('bun.lockb') ? 'bun' : has('package.json') ? 'npm' : python ? python.pm : 'npm';
  const stackNames = [
    ['next', 'Next.js'], ['@nestjs/core', 'NestJS'], ['expo', 'Expo / React Native'], ['react-native', 'React Native'],
    ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['@angular/core', 'Angular'], ['express', 'Express'],
    ['fastify', 'Fastify'], ['prisma', 'Prisma'], ['vite', 'Vite'],
  ].filter(([d]) => d in deps).map(([, n]) => n);
  if (python) stackNames.push('Python', ...python.frameworks);
  if (has('go.mod')) stackNames.push('Go');
  if (has('Cargo.toml')) stackNames.push('Rust');
  const ts = has('tsconfig.json');
  const envFiles = existsSync(repo) ? readdirSync(repo).filter((f) => /^\.env/.test(f) && !/example|sample|template/.test(f)) : [];
  return { pkg, scripts, deps, pm, python, stackNames, ts, envFiles, name: pkg.name?.replace(/^@[^/]+\//, '') || basename(repo) };
}

function runScript(pm, script) {
  if (pm === 'npm') return script === 'test' ? 'npm test' : `npm run ${script}`;
  return pm === 'bun' ? `bun run ${script}` : `${pm} ${script}`;
}

function detectCommand(det, id) {
  const s = det.scripts;
  const pick = (...names) => names.find((n) => s[n] && !/no test specified/.test(s[n]));
  const script = { typecheck: pick('typecheck', 'type-check', 'tsc'), lint: pick('lint'), 'format-check': pick('format:check', 'format-check', 'fmt:check'), test: pick('test'), build: pick('build') }[id];
  if (script) return runScript(det.pm, script);
  if (id === 'typecheck' && det.ts) return { npm: 'npx tsc --noEmit', pnpm: 'pnpm exec tsc --noEmit', yarn: 'yarn tsc --noEmit', bun: 'bunx tsc --noEmit' }[det.pm];
  if (det.python?.commands[id]) return det.python.commands[id];
  return '';
}

function defaultPrefix(name) {
  const words = name.split(/[^A-Za-z]+/).filter(Boolean);
  let p = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? 'app').slice(0, 3);
  p = p.toUpperCase().slice(0, 5);
  return p.length < 2 || p === 'WF' ? 'APP' : p;
}

function defaultUnverified(det) {
  if (det.stackNames.some((n) => /React Native|Expo/.test(n))) return 'emulator and device runs, store builds, calls to real external services, deployed environments';
  if (det.stackNames.some((n) => /Next|React|Vue|Svelte|Angular|Vite|Django|FastAPI|Flask/.test(n))) return 'browser checks at desktop and phone width, calls to real external services, deployed environments';
  return 'calls to real external services, migrations on a real database, deployed environments';
}

// ---------- questions

const list = (v) => (Array.isArray(v) ? v : String(v).split(',')).map((x) => x.trim()).filter(Boolean);

function questions(det) {
  return [
    { key: 'name', q: 'Project name', def: () => det.name, check: (v) => (v ? null : 'required') },
    { key: 'description', q: 'One-line description of the product', def: (a) => det.pkg.description || `${a.name}.` },
    { key: 'stack', q: 'Stack (framework, language, database, test runner)', def: () => [...det.stackNames, det.ts ? 'TypeScript' : null].filter(Boolean).join(', ') || 'Not described yet' },
    { key: 'prefix', q: 'Work-ID prefix for product work (2-5 capital letters, not WF)', def: (a) => defaultPrefix(a.name), check: (v) => (/^[A-Z]{2,5}$/.test(v) && v !== 'WF' ? null : 'use 2-5 capital letters, not WF') },
    { key: 'prp', q: 'Path of the PRP (product requirements) file', def: () => 'docs/PRP.md', check: (v) => (v && !v.startsWith('/') && !v.split('/').includes('..') ? null : 'use a path inside the repo') },
    ...COMMAND_IDS.map((id) => ({ key: `cmd_${id}`, q: `Command for ${id} (blank keeps the default, "-" skips)`, def: () => detectCommand(det, id) })),
    { key: 'protected', q: 'Protected files agents must never read (comma separated)', def: () => [...new Set([...DEFAULT_PROTECTED, ...det.envFiles])].join(', '), check: (v) => (list(v).length ? null : 'at least one') },
    { key: 'high_risk', q: 'High-risk areas (they get an extra audit stage)', def: () => 'auth and permissions, payments, database schema and migrations, env and build config, CI, dependency upgrades' },
    { key: 'unverified', q: 'Things only a human can confirm (agents report them as pending)', def: () => defaultUnverified(det) },
    { key: 'docs_rule', q: 'Rule for library and framework APIs', def: () => 'Before touching a framework or library API, read the installed version in the project manifest and the matching official docs. Do not answer from memory.' },
  ];
}

async function collectAnswers(det, preset, interactive) {
  const answers = {};
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    for (const q of questions(det)) {
      const def = preset[q.key] ?? q.def(answers) ?? '';
      let v = def;
      for (;;) {
        if (rl) {
          const got = (await rl.question(`${q.q}${def ? ` [${def}]` : ''}: `)).trim();
          v = got === '-' ? '' : got || def;
        }
        const problem = q.check?.(v);
        if (!problem) break;
        if (!rl) throw new Error(`${q.key}: ${problem}`);
        console.log(`  ${problem}`);
      }
      answers[q.key] = v;
    }
    if (!COMMAND_IDS.some((id) => answers[`cmd_${id}`])) answers.cmd_check = 'git diff --check';
    if (rl) {
      const ok = (await rl.question('\nInstall with these answers? [Y/n]: ')).trim().toLowerCase();
      if (ok && ok !== 'y' && ok !== 'yes') throw new Error('Cancelled; nothing was written');
    }
  } finally {
    rl?.close();
  }
  return answers;
}

// ---------- writing

function render(text, vars) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`template placeholder ${m} has no value`);
    return vars[k];
  });
}

function templateFiles(dir = TEMPLATE, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) templateFiles(p, out);
    else out.push(relative(TEMPLATE, p));
  }
  return out;
}

function upsertBlock(path, block, fresh) {
  if (!existsSync(path)) return writeFileSync(path, fresh);
  const text = readFileSync(path, 'utf8');
  const re = /<!-- BEGIN:ai-workflow -->[\s\S]*?<!-- END:ai-workflow -->\n?/;
  writeFileSync(path, re.test(text) ? text.replace(re, () => block) : `${text.trimEnd()}\n\n${block}`);
}

function appendMissingLines(path, lines, create) {
  if (!existsSync(path) && !create) return;
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const have = new Set(text.split('\n').map((l) => l.trim()));
  const add = lines.filter((l) => !have.has(l));
  if (add.length) writeFileSync(path, `${text.trimEnd()}${text.trim() ? '\n' : ''}${add.join('\n')}\n`);
}

function install(repo, a, force) {
  const commands = Object.entries(a).filter(([k, v]) => k.startsWith('cmd_') && v).map(([k, v]) => ({ id: k.slice(4), run: v }));
  const protectedPaths = list(a.protected);
  if (!protectedPaths.includes('.claude/settings.local.json')) protectedPaths.push('.claude/settings.local.json');
  const vars = {
    PROJECT_NAME: a.name,
    DESCRIPTION: a.description,
    STACK: a.stack,
    PREFIX: a.prefix,
    PRP_PATH: a.prp,
    HIGH_RISK: a.high_risk,
    UNVERIFIED: a.unverified,
    PROTECTED_MD: protectedPaths.map((p) => `\`${p}\``).join(', '),
    COMMANDS_TABLE: commands.map(({ id, run }) => `| \`${run}\` (${id}) | ${(PROVES[id] ?? ['The command succeeds', 'Anything else'])[0]} | ${(PROVES[id] ?? ['', 'Anything else'])[1]} |`).join('\n'),
  };

  const files = templateFiles().filter((f) => !f.endsWith('.block.md') && f !== '.claude/settings.json');
  const conflicts = files.filter((f) => existsSync(join(repo, f)));
  if (conflicts.length && !force) {
    throw new Error(`These files already exist (rerun with --force to upgrade the tooling):\n  ${conflicts.slice(0, 10).join('\n  ')}${conflicts.length > 10 ? '\n  ...' : ''}`);
  }

  mkdirSync(repo, { recursive: true });
  for (const f of files) {
    if (PROJECT_OWNED.has(f) && existsSync(join(repo, f))) continue;
    const dest = join(repo, f);
    mkdirSync(dirname(dest), { recursive: true });
    const src = readFileSync(join(TEMPLATE, f));
    writeFileSync(dest, /\.(md|json|mjs)$/.test(f) ? render(src.toString('utf8'), vars) : src);
    if (/^\.ai\/scripts\/[^_][^/]*\.mjs$/.test(f)) chmodSync(dest, 0o755);
  }

  const projectJson = join(repo, '.ai', 'project.json');
  const existing = readJsonIfAny(projectJson);
  if (existing) {
    // Upgrade: keep the repo's config (commands and rules may have been tuned by /setup-ai); only refresh the saved answers.
    writeFileSync(projectJson, `${JSON.stringify({ ...existing, template: { answers: a } }, null, 2)}\n`);
  } else writeFileSync(projectJson, `${JSON.stringify({
    $schema: './schemas/project.schema.json',
    identity: { name: a.name, platform: a.stack, language: a.stack.includes('TypeScript') ? 'TypeScript' : 'See stack', router: 'See project-context', package_manager: detect(repo).pm },
    instructions: { project_context: '.ai/project-context.md', prp: a.prp },
    commands,
    policy: { protected_paths: protectedPaths, sensitive_environment_variables: ['*_SECRET', '*_TOKEN', '*_KEY', '*_PASSWORD', 'DATABASE_URL'] },
    storage: { secrets: 'Secrets live only in the protected files above and the deployment platform; agents never read or print them.' },
    work_ids: { prefixes: [{ prefix: 'WF', meaning: 'workflow work (agent tooling, .ai/, .claude/)' }, { prefix: a.prefix, meaning: 'product work' }] },
    authors: { allowed_vendors: ['claude', 'codex', 'openai'] },
    agents: { docs_rule: a.docs_rule, unverified: a.unverified },
    template: { answers: a },
  }, null, 2)}\n`);

  // Hook: merge into an existing settings.json instead of replacing it.
  const settingsPath = join(repo, '.claude', 'settings.json');
  const hookEntry = JSON.parse(readFileSync(join(TEMPLATE, '.claude', 'settings.json'), 'utf8')).hooks.PreToolUse[0];
  const settings = readJsonIfAny(settingsPath) ?? {};
  if (!JSON.stringify(settings).includes('guard-claude-role-write.mjs')) {
    settings.hooks = { ...settings.hooks, PreToolUse: [...(settings.hooks?.PreToolUse ?? []), hookEntry] };
  }
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  const prpPath = join(repo, a.prp);
  if (!existsSync(prpPath)) {
    mkdirSync(dirname(prpPath), { recursive: true });
    writeFileSync(prpPath, render(readFileSync(join(TEMPLATE, '.ai', 'templates', 'prp.md'), 'utf8'), vars));
  }

  const agentsBlock = render(readFileSync(join(TEMPLATE, 'AGENTS.block.md'), 'utf8'), vars);
  const claudeBlock = render(readFileSync(join(TEMPLATE, 'CLAUDE.block.md'), 'utf8'), vars);
  upsertBlock(join(repo, 'AGENTS.md'), agentsBlock, `# ${a.name}\n\n${a.description}\n\n${agentsBlock}`);
  upsertBlock(join(repo, 'CLAUDE.md'), claudeBlock, `# CLAUDE.md\n\n${claudeBlock}\n@AGENTS.md\n`);
  appendMissingLines(join(repo, 'CLAUDE.md'), ['@AGENTS.md'], false);

  appendMissingLines(join(repo, '.gitignore'), ['.claude/settings.local.json'], true);
  // Accepted artifacts are hash-locked: a formatter must never rewrite them.
  const usesPrettier = 'prettier' in (detect(repo).deps ?? {});
  appendMissingLines(join(repo, '.prettierignore'), ['.ai/', '.claude/', 'docs/work/'], usesPrettier);
}

function notes(repo) {
  const out = [];
  const gi = existsSync(join(repo, '.gitignore')) ? readFileSync(join(repo, '.gitignore'), 'utf8').split('\n').map((l) => l.trim()) : [];
  for (const d of ['.claude', '.claude/', '.ai', '.ai/']) {
    if (gi.includes(d)) out.push(`.gitignore ignores ${d}, so the shared setup cannot be committed. Replace that line with .claude/settings.local.json.`);
  }
  if (spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { stdio: 'ignore' }).status !== 0) out.push('No git commit yet: work items record base_commit as null until there is one.');
  return out;
}

function run(repo, script, ...argv) {
  const r = spawnSync(process.execPath, [join(repo, '.ai', 'scripts', script), ...argv], { cwd: repo, encoding: 'utf8' });
  return { code: r.status, text: `${r.stdout}${r.stderr}`.trim() };
}

// ---------- main

async function main() {
  const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { yes: { type: 'boolean' }, force: { type: 'boolean' }, answers: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (o.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  const interactive = !o.yes && process.stdin.isTTY;
  let target = positionals[0];
  if (!target && interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    target = (await rl.question(`Repo to set up [${process.cwd()}]: `)).trim() || process.cwd();
    rl.close();
  }
  const repo = resolve(target ?? process.cwd());
  const isNew = !existsSync(repo) || readdirSync(repo).filter((f) => f !== '.git').length === 0;
  console.log(`\nSetting up the AI workflow in ${repo} (${isNew ? 'new' : 'existing'} repo)\n`);

  const saved = readJsonIfAny(join(repo, '.ai', 'project.json'))?.template?.answers ?? {};
  const preset = { ...saved, ...(o.answers ? JSON.parse(readFileSync(o.answers, 'utf8')) : {}) };
  const answers = await collectAnswers(detect(repo), preset, interactive);
  install(repo, answers, o.force);

  const gen = run(repo, 'generate-claude-agents.mjs');
  const val = run(repo, 'validate-workflow.mjs');
  console.log(`\n${gen.text}\n${val.text}`);
  for (const n of notes(repo)) console.log(`NOTE  ${n}`);
  console.log(`
Done. Nothing was committed. Next:
  1. cd ${repo} and open Claude Code there.
  2. ${isNew ? 'Run /prp to write the product requirements.' : 'Run /setup-ai so Claude fills in the project context and rules from the code, then /prp.'}
  3. Start a feature with /frp <feature>.
  4. Review the changes and commit .ai/, .claude/ (not settings.local.json), AGENTS.md, CLAUDE.md and ${answers.prp}.`);
  if (gen.code !== 0 || val.code !== 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
