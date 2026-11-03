#!/usr/bin/env node
// Updates a work item manifest with transition validation.
//
// Status moves: backlog->ready|cancelled, ready->in_progress|backlog|cancelled, in_progress->blocked|done|cancelled,
// blocked->in_progress|cancelled. done and cancelled are terminal.
//   -> ready needs --authorized-by-user.   -> in_progress needs every dependency done.
//   -> done needs every stage done or skipped, each done stage linked to an accepted artifact.
// A stage may move to done only with an accepted artifact (--stage-artifact uuid).
// Identifier lists (--add-dependency, --remove-dependency, --set-owned-paths) split on commas (`\,` keeps a literal comma).
// Prose lists (--add-acceptance-criteria, --add-open-decision, --remove-open-decision) never split on commas: a value
// splits only on `||`; an option given several times is kept item for item.
// --route migrates the stage list (see .ai/README.md). It is applied first, in memory, with every other option of the
// same call; the manifest is saved once at the end, so any refusal leaves it untouched.
// Output: JSON { id, status }, plus route and stages with --route.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROUTES, ROUTE_STAGES, hasAcceptedFrp, needsFrp, STAGE_ROLES, STAGE_STATUSES, TRANSITIONS, WORK_STATUSES, args, expandList, findArtifact,
  getManifest, itemDir, oneOf, run, saveManifest, timestamp, workRoot,
} from './_common.mjs';

const SPEC = {
  id: 'string',
  status: 'string',
  'authorized-by-user': 'boolean',
  'stage-name': 'string',
  'stage-status': 'string',
  'stage-artifact': 'string',
  'add-dependency': 'list',
  'remove-dependency': 'list',
  'set-owned-paths': 'list',
  'add-acceptance-criteria': 'list',
  'add-open-decision': 'list',
  'remove-open-decision': 'list',
  route: 'string',
  'work-root': 'string',
};

/** Returns the migrated stage list, or throws when a stage that still matters would be dropped. */
function migrateStages(m, route) {
  const newNames = ROUTE_STAGES[route];
  const counterpart = (name) => {
    if (newNames.includes(name)) return name;
    if (name === 'simple' && newNames.includes('implement')) return 'implement';
    if (name === 'implement' && newNames.includes('simple')) return 'simple';
    return null;
  };
  const mapped = {};
  const refused = [];
  for (const s of m.stages) {
    const target = counterpart(s.name);
    if (target) {
      if (mapped[target]) throw new Error(`Stages '${mapped[target].name}' and '${s.name}' both map to '${target}' in route '${route}'; fix the manifest first`);
      mapped[target] = s;
    } else if (s.artifact || !['pending', 'skipped'].includes(s.status)) {
      refused.push(`'${s.name}' ${s.artifact ? `has artifact ${s.artifact}` : `is ${s.status}`}`);
    }
  }
  if (refused.length) {
    throw new Error(`Cannot change route '${m.route}' -> '${route}': stage ${refused.join(', ')} would be dropped. Only stages without an artifact that are pending or skipped can be dropped.`);
  }
  return newNames.map((name) => ({
    name,
    role: STAGE_ROLES[name],
    status: mapped[name] ? mapped[name].status : 'pending',
    artifact: mapped[name] ? mapped[name].artifact : null,
  }));
}

function applyStage(m, a, id) {
  const name = a['stage-name'];
  const status = a['stage-status'];
  if ((name === undefined) !== (status === undefined)) throw new Error('--stage-name and --stage-status go together');
  if (!name) {
    if (a['stage-artifact']) throw new Error('--stage-artifact needs --stage-name');
    return;
  }
  const stage = m.stages.find((s) => s.name === name);
  if (!stage) throw new Error(`Stage '${name}' is not part of route '${m.route}'`);
  if (status === 'done') {
    const uuid = a['stage-artifact'] || stage.artifact;
    if (!uuid) throw new Error('A stage can be done only with an accepted artifact (--stage-artifact <uuid>)');
    const e = findArtifact(m, uuid);
    if (!e) throw new Error(`Artifact ${uuid} is not in ${id}`);
    if (e.status !== 'accepted') throw new Error(`Artifact ${uuid} is '${e.status}', must be accepted before the stage is done`);
  }
  if (a['stage-artifact']) {
    if (!findArtifact(m, a['stage-artifact'])) throw new Error(`Artifact ${a['stage-artifact']} is not in ${id}`);
    stage.artifact = a['stage-artifact'];
  }
  stage.status = status;
}

function applyStatus(m, a, root) {
  const status = a.status;
  if (!status) return;
  if (status === m.status) throw new Error(`${m.id} is already '${status}'`);
  if (!TRANSITIONS[m.status].includes(status)) {
    throw new Error(`Invalid transition ${m.status} -> ${status}. Allowed from ${m.status}: ${TRANSITIONS[m.status].join(', ')}`);
  }
  if (status === 'ready' && !a['authorized-by-user']) throw new Error("Status 'ready' requires --authorized-by-user (only the user authorizes work)");
  if (status === 'ready' && needsFrp(m) && !hasAcceptedFrp(m)) throw new Error(`${m.id} needs an accepted frp artifact (feature requirements, see the /frp skill) before it can be ready`);
  if (status === 'in_progress') {
    for (const d of m.dependencies) {
      const dm = getManifest(root, d);
      if (dm.status !== 'done') throw new Error(`Dependency ${d} is '${dm.status}', not done`);
    }
  }
  if (status === 'done') {
    for (const s of m.stages) {
      if (!['done', 'skipped'].includes(s.status)) throw new Error(`Stage '${s.name}' is '${s.status}'; all stages must be done or skipped`);
    }
    if (!m.stages.some((s) => s.status === 'done')) throw new Error('At least one stage must be done');
  }
  m.status = status;
}

run(() => {
  const a = args(SPEC, ['id']);
  oneOf('status', a.status, WORK_STATUSES);
  oneOf('stage-name', a['stage-name'], Object.keys(STAGE_ROLES));
  oneOf('stage-status', a['stage-status'], STAGE_STATUSES);
  oneOf('route', a.route, ROUTES);
  for (const k of ['add-dependency', 'remove-dependency', 'set-owned-paths']) if (a[k]) a[k] = expandList(a[k]);
  for (const k of ['add-acceptance-criteria', 'add-open-decision', 'remove-open-decision']) if (a[k]) a[k] = expandList(a[k], true);

  const id = a.id;
  const given = Object.keys(a).filter((k) => a[k] !== undefined);
  const root = workRoot(a['work-root']);
  const m = getManifest(root, id);
  const terminal = ['done', 'cancelled'].includes(m.status);

  if (a.route && terminal) throw new Error(`${id} is ${m.status}; it is terminal and its route cannot be changed`);
  if (terminal && given.length > 1) throw new Error(`${id} is ${m.status}; it is terminal and cannot be edited`);

  let routeNoop = false;
  if (a.route) {
    if (a.route === m.route) {
      routeNoop = given.every((k) => ['id', 'route', 'work-root'].includes(k));
    } else {
      const stages = migrateStages(m, a.route);
      m.route_history = [...(m.route_history ?? []), { from: m.route, to: a.route, at: timestamp() }];
      m.route = a.route;
      m.stages = stages;
    }
  }

  applyStage(m, a, id);

  for (const d of a['add-dependency'] ?? []) {
    if (d === id) throw new Error('A work item cannot depend on itself');
    if (!existsSync(join(itemDir(root, d), 'work-item.json'))) throw new Error(`Dependency ${d} does not exist`);
    if (!m.dependencies.includes(d)) m.dependencies = [...m.dependencies, d];
  }
  if (a['remove-dependency']) m.dependencies = m.dependencies.filter((d) => !a['remove-dependency'].includes(d));
  if (a['set-owned-paths']) m.owned_paths = a['set-owned-paths'];
  if (a['add-acceptance-criteria']) m.acceptance_criteria = [...m.acceptance_criteria, ...a['add-acceptance-criteria']];
  if (a['add-open-decision']) m.open_decisions = [...m.open_decisions, ...a['add-open-decision']];
  if (a['remove-open-decision']) m.open_decisions = m.open_decisions.filter((d) => !a['remove-open-decision'].includes(d));

  applyStatus(m, a, root);

  if (!routeNoop) saveManifest(root, m);
  const result = { id: m.id, status: m.status };
  if (a.route) Object.assign(result, { route: m.route, stages: m.stages.map((s) => s.name) });
  return result;
});
