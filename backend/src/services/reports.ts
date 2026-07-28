import type { Pool } from "pg";
import { analysisSchema, toCriterionMap } from "../schemas/analysis";

export interface CallFilters {
  repId?: string;
  status?: string;
  outcome?: string;
  from?: string;
  to?: string;
  restrictRepEmail?: string; // set for non-managers → only their own calls
  page?: number;
  pageSize?: number;
}

// Tenant-scoped, filtered, paginated call list with denormalized score/outcome.
export async function listCalls(pool: Pool, tenantId: string, f: CallFilters) {
  const where: string[] = ["c.tenant_id = $1"];
  const params: unknown[] = [tenantId];
  const add = (col: string, val: unknown) => {
    params.push(val);
    where.push(`${col} $${params.length}`);
  };
  if (f.repId) add("c.rep_id =", f.repId);
  if (f.status) add("c.status =", f.status);
  if (f.outcome) add("a.outcome =", f.outcome);
  if (f.from) add("c.created_at >=", f.from);
  if (f.to) add("c.created_at <=", f.to);
  if (f.restrictRepEmail) add("r.email =", f.restrictRepEmail);

  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 25));
  const offset = (page - 1) * pageSize;
  const base = `from calls c
    left join reps r on r.id = c.rep_id
    left join analyses a on a.call_id = c.id
    where ${where.join(" and ")}`;

  const count = await pool.query<{ count: number }>(`select count(*)::int as count ${base}`, params);
  const rows = await pool.query(
    `select c.id, c.recording_id, c.title, c.status, c.created_at,
            r.id as rep_id, r.email as rep_email, r.display_name as rep_name,
            a.total_score, a.outcome, a.was_disqualified
     ${base}
     order by c.created_at desc
     limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, pageSize, offset],
  );

  return {
    calls: rows.rows.map((r) => ({
      id: r.id,
      recording_id: r.recording_id,
      title: r.title,
      status: r.status,
      created_at: r.created_at,
      rep: r.rep_id ? { id: r.rep_id, email: r.rep_email, display_name: r.rep_name } : null,
      total_score: r.total_score,
      outcome: r.outcome,
      was_disqualified: r.was_disqualified,
    })),
    page,
    page_size: pageSize,
    total: count.rows[0].count,
  };
}

// Full scorecard for one call. Returns null if not in tenant or (for members) not theirs.
export async function getCallScorecard(
  pool: Pool,
  tenantId: string,
  callId: string,
  restrictRepEmail?: string,
) {
  const c = await pool.query(
    `select c.id, c.recording_id, c.title, c.status, c.created_at, c.rep_id,
            r.email as rep_email, r.display_name as rep_name
     from calls c left join reps r on r.id = c.rep_id
     where c.id = $1 and c.tenant_id = $2`,
    [callId, tenantId],
  );
  if (c.rows.length === 0) return null;
  const call = c.rows[0];
  if (restrictRepEmail && call.rep_email !== restrictRepEmail) return null;

  const a = await pool.query(
    "select model, total_score, outcome, was_disqualified, created_at, raw_json from analyses where call_id = $1 and tenant_id = $2",
    [callId, tenantId],
  );
  let analysis = null;
  if (a.rows.length > 0) {
    const row = a.rows[0];
    const parsed = analysisSchema.safeParse(row.raw_json);
    analysis = {
      model: row.model,
      total_score: row.total_score,
      outcome: row.outcome,
      was_disqualified: row.was_disqualified,
      created_at: row.created_at,
      summary: row.raw_json?.summary ?? null,
      disqualification_summary: row.raw_json?.disqualification_summary ?? null,
      critical_moments: row.raw_json?.critical_moments ?? [],
      criteria: parsed.success ? toCriterionMap(parsed.data) : [],
    };
  }

  return {
    call: {
      id: call.id,
      recording_id: call.recording_id,
      title: call.title,
      status: call.status,
      created_at: call.created_at,
      rep: call.rep_id
        ? { id: call.rep_id, email: call.rep_email, display_name: call.rep_name }
        : null,
    },
    analysis,
  };
}

// Per-rep averages for managers.
export async function leaderboard(pool: Pool, tenantId: string) {
  const { rows } = await pool.query(
    `select r.id as rep_id, r.email, r.display_name,
            count(a.id)::int as calls_analyzed,
            round(avg(a.total_score)::numeric, 2)::float8 as avg_score,
            count(*) filter (where a.was_disqualified)::int as disqualified_count
     from reps r
     left join calls c on c.rep_id = r.id and c.tenant_id = r.tenant_id
     left join analyses a on a.call_id = c.id
     where r.tenant_id = $1
     group by r.id, r.email, r.display_name
     order by avg_score desc nulls last`,
    [tenantId],
  );
  return { reps: rows };
}

// One rep's score trend over time + per-criterion averages.
export async function repTrends(
  pool: Pool,
  tenantId: string,
  repId: string,
  restrictRepEmail?: string,
) {
  const rep = await pool.query<{ id: string; email: string; display_name: string | null }>(
    "select id, email, display_name from reps where id = $1 and tenant_id = $2",
    [repId, tenantId],
  );
  if (rep.rows.length === 0) return null;
  if (restrictRepEmail && rep.rows[0].email !== restrictRepEmail) return null;

  const points = await pool.query(
    `select to_char(date_trunc('day', a.created_at), 'YYYY-MM-DD') as date,
            round(avg(a.total_score)::numeric, 2)::float8 as avg_score,
            count(*)::int as calls
     from analyses a join calls c on c.id = a.call_id
     where c.tenant_id = $1 and c.rep_id = $2
     group by 1 order by 1`,
    [tenantId, repId],
  );

  const raws = await pool.query<{ raw_json: unknown }>(
    "select a.raw_json from analyses a join calls c on c.id = a.call_id where c.tenant_id = $1 and c.rep_id = $2",
    [tenantId, repId],
  );
  const sums = new Map<string, { sum: number; n: number; label: string }>();
  for (const row of raws.rows) {
    const parsed = analysisSchema.safeParse(row.raw_json);
    if (!parsed.success) continue;
    for (const crit of toCriterionMap(parsed.data)) {
      const cur = sums.get(crit.key) ?? { sum: 0, n: 0, label: crit.label };
      cur.sum += crit.score;
      cur.n += 1;
      sums.set(crit.key, cur);
    }
  }
  const by_criterion = [...sums.entries()].map(([key, v]) => ({
    key,
    label: v.label,
    avg_score: Math.round((v.sum / v.n) * 100) / 100,
  }));

  return { rep: rep.rows[0], points: points.rows, by_criterion };
}
