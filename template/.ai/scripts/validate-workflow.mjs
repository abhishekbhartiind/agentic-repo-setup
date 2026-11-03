#!/usr/bin/env node
// Validates the agent workflow: manifests, artifacts, hashes, supersede chains, referenced paths, rule selectors,
// agent profile sync, staged protected paths, author vendors.
// Exit 0 = no failures (warnings allowed unless --strict). Exit 1 = at least one failure.
// --scope work : only docs/work (manifests, artifacts, hashes, chains, authors). Used by tests.
// --scope all  : everything (default).
// Usage: validate-workflow.mjs [--scope all|work] [--work-root DIR] [--strict]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  KINDS, REPO_ROOT, hasAcceptedFrp, needsFrp, ROUTE_STAGES, SCRIPTS_DIR, STAGE_ROLES, UUID_RE, args, matchesPolicy, oneOf, projectConfig, readArtifact,
  readJson, sha256File, testArtifactSections, testAuthor, workRoot,
} from './_common.mjs';

const fails = [];
const warns = [];
const bad = (m) => fails.push(m);
const warn = (m) => warns.push(m);

// ---- minimal JSON-schema checker (type, enum, pattern, required, properties, additionalProperties, items, minItems, minLength)
function isType(v, t) {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'null': return v === null;
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'boolean': return typeof v === 'boolean';
    case 'integer': return Number.isInteger(v);
    default: return true;
  }
}

function checkSchema(value, schema, path, problems) {
  if ('type' in schema) {
    const types = [schema.type].flat();
    if (!types.some((t) => isType(value, t))) return problems.push(`${path}: expected type ${types.join('|')}`);
  }
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${path}: '${value}' not in [${schema.enum.join(', ')}]`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) problems.push(`${path}: '${value}' does not match ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${path}: shorter than ${schema.minLength}`);
  }
  if (isType(value, 'object')) {
    for (const r of schema.required ?? []) if (!(r in value)) problems.push(`${path}: missing required '${r}'`);
    const defined = Object.keys(schema.properties ?? {});
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!defined.includes(k)) problems.push(`${path}: unexpected property '${k}'`);
    }
    for (const d of defined) if (d in value) checkSchema(value[d], schema.properties[d], `${path}.${d}`, problems);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => checkSchema(v, schema.items, `${path}[${i}]`, problems));
  }
}

function checkAgainst(obj, schemaFile, label) {
  const problems = [];
  checkSchema(obj, readJson(schemaFile), label, problems);
  problems.forEach(bad);
}

function loadManifests(root, prefixes) {
  const manifests = {};
  if (!existsSync(root)) return manifests;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const mp = join(root, e.name, 'work-item.json');
    if (!existsSync(mp)) { bad(`${e.name}: work-item.json missing`); continue; }
    let m;
    try { m = JSON.parse(readFileSync(mp, 'utf8')); } catch (err) { bad(`${e.name}: work-item.json is not valid JSON (${err.message})`); continue; }
    checkAgainst(m, join(REPO_ROOT, '.ai', 'schemas', 'work-item.schema.json'), `${e.name}/work-item.json`);
    if (!m || typeof m !== 'object' || !('id' in m)) continue;
    if (m.id !== e.name) bad(`${e.name}: manifest id '${m.id}' differs from folder name`);
    if (prefixes.length && !prefixes.includes(String(m.id).replace(/-.*$/, ''))) bad(`${m.id}: prefix not in project.json work_ids`);
    manifests[m.id] = m;
  }
  return manifests;
}

function checkArtifactEntry(m, a, root, cfg) {
  const id = m.id;
  const u = String(a.uuid);
  const label = `${id}/${a.path}`;
  const file = join(root, id, String(a.path));
  if (a.path !== `artifacts/${a.kind}-${u.slice(0, 8)}.md`) bad(`${label}: path must be artifacts/<kind>-<first8 of uuid>.md`);
  if (!existsSync(file)) return bad(`${label}: file missing`);
  let fm;
  try { fm = readArtifact(file); } catch (err) { return bad(`${label}: ${err.message}`); }
  const meta = fm.meta;
  for (const k of ['id', 'work_id', 'kind', 'status', 'author', 'created', 'supersedes']) if (!(k in meta)) bad(`${label}: front matter lacks '${k}'`);
  if (!('id' in meta)) return;
  if (meta.id !== u) bad(`${label}: front matter id ${meta.id} differs from manifest ${u}`);
  if (!UUID_RE.test(meta.id ?? '')) bad(`${label}: id is not a lowercase uuid v4`);
  if (meta.work_id !== id) bad(`${label}: front matter work_id '${meta.work_id}' differs from ${id}`);
  if (meta.kind !== a.kind) bad(`${label}: front matter kind '${meta.kind}' differs from manifest '${a.kind}'`);
  if (!KINDS.includes(meta.kind)) bad(`${label}: unknown kind '${meta.kind}'`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(meta.created ?? '')) bad(`${label}: created is not ISO 8601`);
  if (cfg) { const ap = testAuthor(meta.author ?? '', cfg); if (ap) bad(`${label}: ${ap}`); }
  if ((meta.supersedes ?? null) !== (a.supersedes ?? null)) bad(`${label}: front matter supersedes differs from manifest`);
  if (['draft', 'rejected'].includes(a.status)) {
    if (meta.status !== a.status) bad(`${label}: front matter status '${meta.status}' differs from manifest '${a.status}'`);
    if (a.sha256) bad(`${label}: ${a.status} artifact must not carry a hash`);
  } else if (['accepted', 'superseded'].includes(a.status)) {
    if (meta.status !== 'accepted') bad(`${label}: file front matter must be frozen at 'accepted' (is '${meta.status}')`);
    if (!a.sha256) bad(`${label}: ${a.status} artifact has no recorded sha256`);
    else if (sha256File(file) !== a.sha256) bad(`${label}: HASH MISMATCH - accepted artifact was modified after acceptance`);
    testArtifactSections(a.kind, fm.body).forEach((p) => bad(`${label}: ${p}`));
  }
}

function checkManifest(m, manifests, root, uuidSeen, cfg) {
  const id = m.id;
  for (const d of m.dependencies ?? []) {
    if (!manifests[d]) bad(`${id}: dependency ${d} does not exist`);
    else if (['in_progress', 'done'].includes(m.status) && manifests[d].status !== 'done') bad(`${id}: is ${m.status} but dependency ${d} is ${manifests[d].status}`);
  }
  if (['ready', 'in_progress', 'done'].includes(m.status) && needsFrp(m) && !hasAcceptedFrp(m)) bad(`${id}: is ${m.status} without an accepted frp artifact`);
  const stages = m.stages ?? [];
  if (m.status === 'done') for (const s of stages) if (!['done', 'skipped'].includes(s.status)) bad(`${id}: done but stage '${s.name}' is ${s.status}`);
  const expected = ROUTE_STAGES[m.route];
  if (expected && stages.map((s) => s.name).join(',') !== expected.join(',')) bad(`${id}: stages do not match route '${m.route}'`);
  for (const s of stages) if (s.name in STAGE_ROLES && s.role !== STAGE_ROLES[s.name]) bad(`${id}: stage '${s.name}' has role '${s.role}'`);

  const artifacts = m.artifacts ?? [];
  const byId = {};
  for (const a of artifacts) {
    const u = String(a.uuid);
    if (uuidSeen[u]) bad(`${id}: duplicate artifact uuid ${u} (also in ${uuidSeen[u]})`);
    uuidSeen[u] = id;
    byId[u] = a;
    checkArtifactEntry(m, a, root, cfg);
  }
  for (const a of artifacts) {
    const label = `${id}/${a.path}`;
    if (a.supersedes) {
      const t = byId[a.supersedes];
      if (!t) { bad(`${label}: supersedes unknown artifact ${a.supersedes}`); continue; }
      if (t.kind !== a.kind) bad(`${label}: supersedes artifact of another kind`);
      if (a.status === 'accepted' && t.status !== 'superseded') bad(`${label}: accepted but its target ${a.supersedes} is '${t.status}', expected superseded`);
      const seen = new Set();
      for (let cur = a; cur && cur.supersedes; cur = byId[cur.supersedes]) {
        if (seen.has(cur.uuid)) { bad(`${label}: supersede cycle`); break; }
        seen.add(cur.uuid);
      }
    }
    if (a.status === 'superseded') {
      const n = artifacts.filter((x) => x.supersedes === a.uuid && ['accepted', 'superseded'].includes(x.status)).length;
      if (n !== 1) bad(`${label}: superseded but ${n} accepted artifacts supersede it (need exactly 1)`);
    }
  }
  for (const s of stages) {
    if (s.artifact) {
      const a = byId[s.artifact];
      if (!a) bad(`${id}: stage '${s.name}' references unknown artifact ${s.artifact}`);
      else if (s.status === 'done' && !['accepted', 'superseded'].includes(a.status)) bad(`${id}: stage '${s.name}' is done but artifact is '${a.status}'`);
    } else if (s.status === 'done') bad(`${id}: stage '${s.name}' is done without an artifact`);
  }
}

function backtickPaths(file) {
  return [...readFileSync(file, 'utf8').matchAll(/`((?:\.ai|\.claude|docs)\/[^`\s]*)`/g)].map((m) => m[1]);
}

function checkRepo(cfg) {
  // Untracked or optional files (policy.protected_paths, e.g. .claude/settings.local.json) are absent on a fresh clone.
  const refPath = (from, token) => {
    const t = token.trim().replace(/[/.,:]+$/, '');
    if (/[<>*{}$]|\.\.\./.test(t)) return;
    if (cfg && matchesPolicy(t, cfg.policy.protected_paths)) return;
    if (!existsSync(join(REPO_ROOT, t))) bad(`${from}: references missing path '${token}'`);
  };
  if (cfg) {
    refPath('.ai/project.json instructions.project_context', cfg.instructions.project_context);
    refPath('.ai/project.json instructions.prp', cfg.instructions.prp);
    const prp = join(REPO_ROOT, cfg.instructions.prp);
    if (existsSync(prp) && readFileSync(prp, 'utf8').includes('_TBD_')) warn(`${cfg.instructions.prp} still has _TBD_ sections; fill it with the /prp skill`);
  }
  for (const f of ['AGENTS.md', 'CLAUDE.md']) {
    const p = join(REPO_ROOT, f);
    if (!existsSync(p)) { warn(`${f} does not exist (referenced by the workflow spec)`); continue; }
    backtickPaths(p).forEach((t) => refPath(f, t));
  }
  for (const f of readdirSync(join(REPO_ROOT, '.ai')).filter((n) => /^routing-.*\.md$/.test(n))) {
    const full = join(REPO_ROOT, '.ai', f);
    backtickPaths(full).forEach((t) => refPath(`.ai/${f}`, t));
    if (f === 'routing-claude.md') {
      const txt = readFileSync(full, 'utf8');
      for (const m of txt.matchAll(/`((?:code-simple|code-researcher|code-planner|code-implementer|code-reviewer|auditor)-(?:low|medium|high))`/g)) {
        if (!existsSync(join(REPO_ROOT, '.claude', 'agents', `${m[1]}.md`))) bad(`routing-claude.md: profile '${m[1]}' has no .claude/agents file`);
      }
    }
  }
  for (const req of ['.ai/project-context.md', '.ai/workflow.md', '.ai/routing-claude.md', '.ai/routing-codex.md', '.ai/artifacts.md', '.ai/AGENTS.md', '.ai/README.md', '.ai/GUIDE.md', '.claude/settings.json']) {
    if (!existsSync(join(REPO_ROOT, req))) bad(`required file missing: ${req}`);
  }

  // rule selectors
  const rulesDir = join(REPO_ROOT, '.claude', 'rules');
  const targets = new Set();
  for (const f of existsSync(rulesDir) ? readdirSync(rulesDir).filter((n) => n.endsWith('.md')) : []) {
    const imports = [...readFileSync(join(rulesDir, f), 'utf8').matchAll(/^@(\S+)\s*$/gm)].map((m) => m[1]);
    if (!imports.length) bad(`.claude/rules/${f}: has no @import of a canonical .ai file`);
    for (const i of imports) {
      const full = resolve(rulesDir, i);
      if (!existsSync(full)) bad(`.claude/rules/${f}: selector points to missing file '${i}'`);
      else targets.add(full.toLowerCase());
    }
  }
  const aiRules = join(REPO_ROOT, '.ai', 'rules');
  for (const f of existsSync(aiRules) ? readdirSync(aiRules).filter((n) => n.endsWith('.md')) : []) {
    if (!targets.has(join(aiRules, f).toLowerCase())) bad(`.ai/rules/${f}: no .claude/rules selector points to it`);
  }

  // skills adapters
  const skillsDir = join(REPO_ROOT, '.ai', 'skills');
  for (const s of existsSync(skillsDir) ? readdirSync(skillsDir) : []) {
    for (const p of [`.ai/skills/${s}/SKILL.md`, `.claude/skills/${s}/SKILL.md`]) if (!existsSync(join(REPO_ROOT, p))) bad(`skill file missing: ${p}`);
    const ad = join(REPO_ROOT, '.claude', 'skills', s, 'SKILL.md');
    if (existsSync(ad) && !readFileSync(ad, 'utf8').includes(`.ai/skills/${s}/SKILL.md`)) bad(`.claude/skills/${s}/SKILL.md does not point to the canonical .ai/skills/${s}/SKILL.md`);
  }

  // agent profiles in sync
  const gen = spawnSync(process.execPath, [join(SCRIPTS_DIR, 'generate-claude-agents.mjs'), '--check'], { encoding: 'utf8' });
  if (gen.status !== 0) `${gen.stdout}${gen.stderr}`.trim().split('\n').forEach((l) => bad(`agents: ${l}`));

  // hook registered
  try {
    if (!JSON.stringify(readJson(join(REPO_ROOT, '.claude', 'settings.json'))).includes('guard-claude-role-write.mjs')) bad('.claude/settings.json: PreToolUse guard hook not registered');
  } catch (err) { bad(`.claude/settings.json: ${err.message}`); }

  // protected paths staged (read-only)
  if (cfg) {
    try {
      const staged = execFileSync('git', ['-C', REPO_ROOT, 'diff', '--cached', '--name-only'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const f of staged.split('\n').filter(Boolean)) {
        if (matchesPolicy(f, cfg.policy.protected_paths)) bad(`protected path is staged: ${f}`);
      }
    } catch { warn('git diff --cached failed; staged-protected-path check skipped'); }
  }

  // declared npm scripts
  const pkgPath = join(REPO_ROOT, 'package.json');
  if (cfg && existsSync(pkgPath)) {
    const have = Object.keys(readJson(pkgPath).scripts ?? {});
    for (const c of cfg.commands) {
      const m = /^npm (?:run )?([\w:-]+)$/.exec(c.run);
      if (m && !have.includes(m[1])) warn(`command '${c.id}' runs '${c.run}' but package.json has no '${m[1]}' script`);
    }
  }
}

const a = args({ scope: 'string', 'work-root': 'string', strict: 'boolean' });
const scope = oneOf('scope', a.scope ?? 'all', ['all', 'work']);
const root = workRoot(a['work-root']);
let cfg = null;
try {
  cfg = projectConfig();
  if (scope === 'all') checkAgainst(cfg, join(REPO_ROOT, '.ai', 'schemas', 'project.schema.json'), '.ai/project.json');
} catch (err) { bad(`.ai/project.json: ${err.message}`); cfg = null; }
const prefixes = cfg ? cfg.work_ids.prefixes.map((p) => p.prefix) : [];

const manifests = loadManifests(root, prefixes);
const uuidSeen = {};
for (const m of Object.values(manifests)) checkManifest(m, manifests, root, uuidSeen, cfg);
if (scope === 'all') checkRepo(cfg);

for (const w of warns) console.log(`WARN  ${w}`);
for (const f of fails) console.log(`FAIL  ${f}`);
console.log(`validate-workflow: ${Object.keys(manifests).length} work item(s), ${fails.length} failure(s), ${warns.length} warning(s)`);
process.exit(fails.length + (a.strict ? warns.length : 0) ? 1 : 0);
