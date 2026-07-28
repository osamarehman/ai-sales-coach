// Domain/Data reader for the cue-framework store (cue_frameworks + cue_definitions +
// cue_goals + cue_knowledge). This is what the live cue engine calls: `loadPlaybook`
// once at call start (framework header + cue rules + scheduled goals), then
// `retrieveKnowledge` on demand during the call (e.g. an objection fires -> pull the
// matching diffusion pattern). Read-only, tenant-aware, parameterized SQL. No req/res.
import { pool } from "./db";

export interface CueFramework {
  id: string;
  slug: string;
  name: string;
  version: number;
  status: string;
  stageModel: unknown;
  gatingConfig: unknown;
}

export interface CueDefinition {
  cueKey: string;
  name: string;
  category: string | null;
  stage: string | null;
  triggerSignal: string;
  cueText: string;
  priority: string;
  confidenceMin: number | null;
  cooldownS: number | null;
}

// The runtime only needs the fields the goal-runner reads. The human-readable arm/condition/
// satisfied_by columns stay in cue_goals + goals.default.json as the authoritative spec, but the
// runner is driven entirely by `config`, so we don't load what nothing reads.
export interface CueGoal {
  goalKey: string;
  label: string;
  type: string;
  cueText: string;
  priority: string;
  config: unknown;
}

export interface KnowledgeEntry {
  id: string;
  kind: string;
  category: string | null;
  stage: string | null;
  objectionType: string | null;
  title: string;
  summary: string;
  content: unknown;
  tags: string[];
  triggerSignal: string | null;
  priority: string | null;
}

export const DEFAULT_FRAMEWORK_SLUG = "default-consultative-v1";

// Load a framework by slug: the tenant's own copy if it has one, else the global default.
export async function loadFramework(params: {
  slug?: string;
  tenantId?: string | null;
}): Promise<CueFramework | null> {
  const slug = params.slug ?? DEFAULT_FRAMEWORK_SLUG;
  const tenantId = params.tenantId ?? null;
  const { rows } = await pool.query(
    `select id, slug, name, version, status, stage_model, gating_config
       from cue_frameworks
      where slug = $1 and status = 'active' and (tenant_id = $2 or tenant_id is null)
      order by tenant_id nulls last,  -- a tenant's own framework wins over the global default
               version desc           -- ...and its newest active version
      limit 1`,
    [slug, tenantId],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    version: r.version,
    status: r.status,
    stageModel: r.stage_model,
    gatingConfig: r.gating_config,
  };
}

export async function loadCues(frameworkId: string): Promise<CueDefinition[]> {
  const { rows } = await pool.query(
    `select cue_key, name, category, stage, trigger_signal, cue_text, priority, confidence_min, cooldown_s
       from cue_definitions where framework_id = $1 order by sort_order, cue_key`,
    [frameworkId],
  );
  return rows.map((r) => ({
    cueKey: r.cue_key,
    name: r.name,
    category: r.category,
    stage: r.stage,
    triggerSignal: r.trigger_signal,
    cueText: r.cue_text,
    priority: r.priority,
    confidenceMin: r.confidence_min === null ? null : Number(r.confidence_min),
    cooldownS: r.cooldown_s,
  }));
}

export async function loadGoals(frameworkId: string): Promise<CueGoal[]> {
  const { rows } = await pool.query(
    `select goal_key, label, type, cue_text, priority, config
       from cue_goals where framework_id = $1 order by sort_order, goal_key`,
    [frameworkId],
  );
  return rows.map((r) => ({
    goalKey: r.goal_key,
    label: r.label,
    type: r.type,
    cueText: r.cue_text,
    priority: r.priority,
    config: r.config,
  }));
}

export interface Playbook {
  framework: CueFramework;
  cues: CueDefinition[];
  goals: CueGoal[];
}

// Everything the cue engine needs at call start, in one call.
export async function loadPlaybook(params: {
  slug?: string;
  tenantId?: string | null;
}): Promise<Playbook | null> {
  const framework = await loadFramework(params);
  if (!framework) return null;
  const [cues, goals] = await Promise.all([loadCues(framework.id), loadGoals(framework.id)]);
  // cue_key and goal_key share one dispatch map at runtime (the arbiter's cuesByKey), and a
  // goal there also drives fire-once memory. Per-table unique indexes don't guarantee cross-table
  // uniqueness, so fail fast on a collision rather than let a goal silently overwrite a cue def.
  const cueKeys = new Set(cues.map((c) => c.cueKey));
  const clash = goals.find((g) => cueKeys.has(g.goalKey));
  if (clash) {
    throw new Error(`framework ${framework.slug}: key "${clash.goalKey}" is both a cue_key and a goal_key`);
  }
  return { framework, cues, goals };
}

// On-demand retrieval during a call: pull relevant knowledge by category. All filters
// optional; combined with AND. `tags` matches on array overlap.
export async function retrieveKnowledge(
  frameworkId: string,
  filter: { kind?: string; stage?: string; objectionType?: string; tags?: string[]; limit?: number } = {},
): Promise<KnowledgeEntry[]> {
  const clauses: string[] = ["framework_id = $1"];
  const values: unknown[] = [frameworkId];
  if (filter.kind) {
    values.push(filter.kind);
    clauses.push(`kind = $${values.length}`);
  }
  if (filter.stage) {
    values.push(filter.stage);
    clauses.push(`stage = $${values.length}`);
  }
  if (filter.objectionType) {
    values.push(filter.objectionType);
    clauses.push(`objection_type = $${values.length}`);
  }
  if (filter.tags && filter.tags.length) {
    values.push(filter.tags);
    clauses.push(`tags && $${values.length}::text[]`);
  }
  // Coerce + clamp to a guaranteed integer in [1,100]. `?? 20` misses NaN/±Infinity, so
  // trunc+isFinite here (a raw `Math.min(Math.max(...))` would inline `limit NaN` and error).
  const rawLimit = Math.trunc(Number(filter.limit));
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20; // safe to inline
  const { rows } = await pool.query(
    `select id, kind, category, stage, objection_type, title, summary, content, tags, trigger_signal, priority
       from cue_knowledge where ${clauses.join(" and ")}
      order by case priority when 'critical' then 0 when 'helpful' then 1 when 'fyi' then 2 else 3 end, title, id
      limit ${limit}`,
    values,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    category: r.category,
    stage: r.stage,
    objectionType: r.objection_type,
    title: r.title,
    summary: r.summary,
    content: r.content,
    tags: r.tags,
    triggerSignal: r.trigger_signal,
    priority: r.priority,
  }));
}
