// Shared helpers for .ai/scripts. Node 22+, no dependencies.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.AI_REPO_ROOT || resolve(SCRIPTS_DIR, '..', '..');

export const KINDS = ['frp', 'research', 'plan', 'implementation', 'review', 'audit', 'decision', 'handoff'];
export const WORK_STATUSES = ['backlog', 'ready', 'in_progress', 'blocked', 'done', 'cancelled'];
export const ROUTES = ['simple', 'standard', 'high-risk'];
export const STAGE_STATUSES = ['pending', 'in_progress', 'done', 'skipped'];
export const STAGE_ROLES = {
  simple: 'code-simple',
  research: 'code-researcher',
  plan: 'code-planner',
  implement: 'code-implementer',
  review: 'code-reviewer',
  audit: 'auditor',
};
export const ROUTE_STAGES = {
  simple: ['simple'],
  standard: ['research', 'plan', 'implement', 'review'],
  'high-risk': ['research', 'plan', 'implement', 'review', 'audit'],
};
export const TRANSITIONS = {
  backlog: ['ready', 'cancelled'],
  ready: ['in_progress', 'backlog', 'cancelled'],
  in_progress: ['blocked', 'done', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  done: [],
  cancelled: [],
};
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const WORK_ID_RE = /^[A-Z]{2,5}-[0-9]{3,}$/;
export const PLACEHOLDER = '_TBD_';
export const REQUIRED_SECTIONS = {
  frp: ['Problem', 'PRP goal', 'Users and outcome', 'Scope', 'Acceptance criteria', 'Contracts and data', 'Risks', 'Out of scope', 'Open questions'],
  research: ['Question', 'Findings', 'Sources', 'Unknowns', 'Recommendation'],
  plan: ['Goal', 'Scope', 'Approach', 'Steps', 'Risks', 'Verification', 'Out of scope'],
  implementation: ['Summary', 'Files changed', 'Deviations from plan', 'Verification run', 'Not verified'],
  review: ['Scope reviewed', 'Findings', 'Verification re-run', 'Verdict', 'Capsule: Result', 'Capsule: Evidence', 'Capsule: Unverified', 'Capsule: Blockers', 'Capsule: Next'],
  audit: ['Scope audited', 'Risk analysis', 'Findings', 'Verdict', 'Capsule: Result', 'Capsule: Evidence', 'Capsule: Unverified', 'Capsule: Blockers', 'Capsule: Next'],
  decision: ['Context', 'Options', 'Decision', 'Consequences'],
  handoff: ['State', 'Done', 'Remaining', 'Blockers', 'Next steps', 'Files in flight'],
};

/** Product work on the standard and high-risk routes needs an accepted FRP (feature requirements) before it is ready. */
export const needsFrp = (m) => m.route !== 'simple' && !String(m.id).startsWith('WF-');
export const hasAcceptedFrp = (m) => (m.artifacts ?? []).some((a) => a.kind === 'frp' && ['accepted', 'superseded'].includes(a.status));

/** Runs a script body: prints its result (objects as compact JSON) and turns any error into `ERROR: ...` on stderr, exit 1. */
export function run(main) {
  try {
    const out = main();
    if (out !== undefined) process.stdout.write((typeof out === 'string' ? out : JSON.stringify(out)) + '\n');
  } catch (e) {
    process.stderr.write(`ERROR: ${e.message}\n`);
    process.exit(1);
  }
}

/** Parses `--kebab-case` options. `spec` maps option name -> 'string' | 'boolean' | 'list'. Unknown options are errors. */
export function args(spec, required = []) {
  const options = Object.fromEntries(
    Object.entries(spec).map(([k, t]) => [k, t === 'list' ? { type: 'string', multiple: true } : { type: t }]),
  );
  const { values } = parseArgs({ options, strict: true, allowPositionals: false });
  for (const r of required) if (values[r] === undefined) throw new Error(`--${r} is required`);
  return values;
}

export function oneOf(name, value, allowed) {
  if (value !== undefined && !allowed.includes(value)) throw new Error(`--${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

/**
 * Identifier lists split on unescaped commas (`\,` is a literal comma). Prose lists split only on `||`; a prose option
 * given more than once is kept item for item. Items are trimmed and empty ones dropped.
 */
export function expandList(values = [], prose = false) {
  const vals = values.filter((v) => v != null);
  if (prose && vals.length > 1) return vals.filter((v) => v.trim());
  const parts = vals.flatMap((v) => (prose ? v.split('||') : v.split(/(?<!\\),/).map((p) => p.replace(/\\,/g, ','))));
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function workRoot(override) {
  return override || process.env.AI_WORK_ROOT || join(REPO_ROOT, 'docs', 'work');
}

export function readJson(path) {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function projectConfig() {
  return readJson(join(REPO_ROOT, '.ai', 'project.json'));
}

export function writeUtf8(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replace(/\r\n/g, '\n'), 'utf8');
}

export function writeJson(path, obj) {
  writeUtf8(path, JSON.stringify(obj, null, 2) + '\n');
}

export function timestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function newUuid() {
  return randomUUID();
}

export function itemDir(root, id) {
  if (!WORK_ID_RE.test(id)) throw new Error(`Invalid work id '${id}'`);
  return join(root, id);
}

export function getManifest(root, id) {
  const p = join(itemDir(root, id), 'work-item.json');
  if (!existsSync(p)) throw new Error(`Work item ${id} not found at ${p}`);
  return readJson(p);
}

export function saveManifest(root, m) {
  m.updated = timestamp();
  writeJson(join(itemDir(root, m.id), 'work-item.json'), m);
}

/** Parses `---` front matter of simple `key: value` lines into { meta, body }. */
export function parseFrontMatter(text) {
  const t = text.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(t);
  if (!m) throw new Error('No YAML front matter found');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      let v = kv[2].trim();
      const q = /^"(.*)"$/.exec(v);
      if (q) v = q[1];
      meta[kv[1]] = v === 'null' || v === '~' ? null : v;
    } else if (line.trim()) throw new Error(`Unsupported front matter line: '${line}'`);
  }
  return { meta, body: m[2] };
}

export function readArtifact(path) {
  return parseFrontMatter(readFileSync(path, 'utf8'));
}

/** Rewrites one front matter key (draft artifacts only; accepted ones are immutable). */
export function setFrontMatterValue(path, key, value) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*$`, 'm');
  if (!re.test(text)) throw new Error(`Key '${key}' not found in ${path}`);
  writeUtf8(path, text.replace(re, () => `${key}: ${value ?? 'null'}`));
}

/** Returns a problem message, or null when the author is `<allowed vendor>/<model>`. */
export function testAuthor(author, cfg = projectConfig()) {
  const m = /^([a-z0-9-]+)\/([A-Za-z0-9._:-]+)$/.exec(author ?? '');
  if (!m) return `author '${author}' must look like <vendor>/<model>`;
  const allowed = cfg.authors.allowed_vendors;
  if (!allowed.includes(m[1])) return `author vendor '${m[1]}' not in allowed vendors (${allowed.join(', ')})`;
  return null;
}

export function artifactTemplate(kind, uuid, workId, author, created, supersedes) {
  let s = `---\nid: ${uuid}\nwork_id: ${workId}\nkind: ${kind}\nstatus: draft\nauthor: ${author}\ncreated: ${created}\nsupersedes: ${supersedes || 'null'}\n---\n\n# ${kind} - ${workId}\n`;
  for (const sec of REQUIRED_SECTIONS[kind]) s += `\n## ${sec}\n\n${PLACEHOLDER}\n`;
  if (kind === 'review' || kind === 'audit') {
    s += '\n<!-- Verdict section must be exactly one line: APPROVE | CHANGES_REQUESTED | BLOCK. Capsule sections come last. -->\n';
  }
  return s;
}

/** Returns the missing/unfilled problems of an artifact body (empty = ok). */
export function testArtifactSections(kind, body) {
  const problems = [];
  const heads = [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
  for (const s of REQUIRED_SECTIONS[kind]) if (!heads.includes(s)) problems.push(`missing section '## ${s}'`);
  if (body.includes(PLACEHOLDER)) problems.push(`unfilled placeholder ${PLACEHOLDER}`);
  if (kind === 'review' || kind === 'audit') {
    if (!/^##\s+Verdict\s*\n+\s*(APPROVE|CHANGES_REQUESTED|BLOCK)\s*$/m.test(body)) problems.push('Verdict must be APPROVE, CHANGES_REQUESTED or BLOCK');
    const v = heads.indexOf('Verdict');
    const c = heads.indexOf('Capsule: Result');
    if (v >= 0 && c >= 0 && c < v) problems.push('Capsule sections must come after Verdict');
  }
  return problems;
}

export function findArtifact(m, uuid) {
  return m.artifacts.find((a) => a.uuid === uuid) ?? null;
}

/** Case-insensitive wildcard match (`*`, `?`, `[...]`), like PowerShell's -like. */
export function like(text, pattern) {
  const re = pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${re}$`, 'is').test(text);
}

/** True when a forward-slash path matches a policy pattern: patterns with `/` match the path tail, others the file name. */
export function matchesPolicy(path, patterns) {
  const leaf = path.slice(path.lastIndexOf('/') + 1);
  return patterns.some((p) => (p.includes('/') ? like(path, `*${p}`) : like(leaf, p)));
}
