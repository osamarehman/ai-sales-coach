import type { Pool } from "pg";
import { z } from "zod";
import { HttpError } from "../middleware/error";
import { decrypt } from "../lib/crypto";
import { fetchTranscript } from "./fathom";
import { formatTranscript } from "./transcript";
import { runAnalysis, persistAnalysis, type Completer } from "./analysis";
import { notifySlack, type SlackPoster } from "./notify";

const webhookSchema = z
  .object({
    recording_id: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    title: z.string().optional(),
    recorded_by: z
      .object({ email: z.string().optional(), name: z.string().optional() })
      .passthrough()
      .optional(),
    advisor_email: z.string().optional(),
  })
  .passthrough();

export interface NormalizedWebhook {
  recordingId: string;
  title: string;
  advisorEmail: string | null;
  advisorName: string | null;
}

// Port of the n8n "Process Webhook Data": tolerate array / object / {body:…} shapes.
export function normalizeFathomWebhook(body: unknown): NormalizedWebhook {
  let w: unknown = body;
  if (Array.isArray(body)) w = body[0];
  else if (body && typeof body === "object" && "body" in body) {
    const inner = (body as { body: unknown }).body;
    w = Array.isArray(inner) ? inner[0] : inner;
  }
  const p = webhookSchema.parse(w ?? {});
  const rid = p.recording_id ?? p.id;
  if (rid === undefined || rid === null || String(rid).trim() === "") {
    throw new HttpError(400, "missing recording_id");
  }
  return {
    recordingId: String(rid),
    title: p.title ?? "",
    advisorEmail: p.recorded_by?.email ?? p.advisor_email ?? null,
    advisorName: p.recorded_by?.name ?? null,
  };
}

// Empty/absent keyword = process every call.
export function matchesFilter(title: string, keyword: string | null | undefined): boolean {
  if (!keyword || keyword.trim() === "") return true;
  return title.toLowerCase().includes(keyword.toLowerCase());
}

export interface TenantRow {
  id: string;
  call_filter_keyword: string | null;
}

async function resolveTenant(pool: Pool, token: string): Promise<TenantRow | null> {
  const { rows } = await pool.query<TenantRow>(
    "select id, call_filter_keyword from tenants where webhook_token = $1",
    [token],
  );
  return rows[0] ?? null;
}

async function upsertRep(
  pool: Pool,
  tenantId: string,
  email: string,
  name: string | null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into reps (tenant_id, email, display_name) values ($1, $2, $3)
     on conflict (tenant_id, email)
       do update set display_name = coalesce(excluded.display_name, reps.display_name)
     returning id`,
    [tenantId, email, name],
  );
  return rows[0].id;
}

export interface ReceiveResult {
  callId: string;
  status: string;
  duplicate: boolean;
  process: boolean;
}

// Core: map advisor→rep, apply the tenant's keyword filter, dedupe on
// (tenant_id, recording_id), create the call row. Shared by the webhook path and the
// past-meeting backfill so both dedupe and status transitions behave identically.
// `force` bypasses the keyword filter (used when the user hand-picks meetings to grade).
export async function enqueueCall(
  pool: Pool,
  tenant: TenantRow,
  norm: NormalizedWebhook,
  opts: { force?: boolean } = {},
): Promise<ReceiveResult> {
  const repId = norm.advisorEmail
    ? await upsertRep(pool, tenant.id, norm.advisorEmail, norm.advisorName)
    : null;
  const matched = opts.force || matchesFilter(norm.title, tenant.call_filter_keyword);
  const status = matched ? "received" : "skipped";

  const ins = await pool.query<{ id: string }>(
    `insert into calls (tenant_id, recording_id, source, title, rep_id, status)
     values ($1, $2, 'fathom', $3, $4, $5)
     on conflict (tenant_id, recording_id) do nothing
     returning id`,
    [tenant.id, norm.recordingId, norm.title, repId, status],
  );
  if (ins.rows.length === 0) {
    const ex = await pool.query<{ id: string; status: string }>(
      "select id, status from calls where tenant_id = $1 and recording_id = $2",
      [tenant.id, norm.recordingId],
    );
    return { callId: ex.rows[0].id, status: ex.rows[0].status, duplicate: true, process: false };
  }
  return { callId: ins.rows[0].id, status, duplicate: false, process: matched };
}

// Fast path for the webhook: resolve tenant by token, then enqueue.
export async function receiveWebhook(
  pool: Pool,
  token: string,
  body: unknown,
): Promise<ReceiveResult> {
  const norm = normalizeFathomWebhook(body);
  const tenant = await resolveTenant(pool, token);
  if (!tenant) throw new HttpError(404, "unknown webhook token");
  return enqueueCall(pool, tenant, norm);
}

export interface ProcessDeps {
  fetchTranscriptImpl?: (recordingId: string, apiKey: string) => Promise<unknown>;
  complete?: Completer;
  slackPoster?: SlackPoster;
}

async function setStatus(pool: Pool, callId: string, status: string): Promise<void> {
  await pool.query("update calls set status = $2, updated_at = now() where id = $1", [
    callId,
    status,
  ]);
}

async function loadFathomKey(pool: Pool, tenantId: string): Promise<string> {
  const { rows } = await pool.query<{ encrypted_token: string | null }>(
    "select encrypted_token from integrations where tenant_id = $1 and provider = 'fathom'",
    [tenantId],
  );
  const enc = rows[0]?.encrypted_token;
  if (!enc) throw new Error("No Fathom integration connected for this tenant");
  return decrypt(enc);
}

async function loadActiveRubric(
  pool: Pool,
  tenantId: string,
): Promise<{ id: string; system_prompt: string }> {
  const { rows } = await pool.query<{ id: string; system_prompt: string }>(
    "select id, system_prompt from rubrics where tenant_id = $1 and is_active order by version desc limit 1",
    [tenantId],
  );
  if (rows.length === 0) throw new Error("No active rubric for this tenant");
  return rows[0];
}

// Background pipeline: fetch transcript → analyze → persist, moving the call through
// fetching → analyzing → analyzed, or → failed on any error. External calls injectable.
export async function processCall(pool: Pool, callId: string, deps: ProcessDeps = {}): Promise<void> {
  const fetchTx = deps.fetchTranscriptImpl ?? ((id, key) => fetchTranscript(id, key));
  try {
    const c = await pool.query<{ tenant_id: string; recording_id: string }>(
      "select tenant_id, recording_id from calls where id = $1",
      [callId],
    );
    if (c.rows.length === 0) throw new Error(`call ${callId} not found`);
    const { tenant_id, recording_id } = c.rows[0];

    await setStatus(pool, callId, "fetching");
    const key = await loadFathomKey(pool, tenant_id);
    const transcript = await fetchTx(recording_id, key);
    await pool.query("update calls set raw_transcript = $2, updated_at = now() where id = $1", [
      callId,
      JSON.stringify(transcript),
    ]);

    await setStatus(pool, callId, "analyzing");
    const rubric = await loadActiveRubric(pool, tenant_id);
    const result = await runAnalysis({
      systemPrompt: rubric.system_prompt,
      transcriptText: formatTranscript(transcript),
      complete: deps.complete,
    });
    await persistAnalysis(pool, { tenantId: tenant_id, callId, rubricId: rubric.id, result });
    await setStatus(pool, callId, "analyzed");

    // Best-effort Slack notification (notifySlack never throws).
    const meta = await pool.query<{ title: string | null; rep_name: string | null }>(
      "select c.title, r.display_name as rep_name from calls c left join reps r on r.id = c.rep_id where c.id = $1",
      [callId],
    );
    await notifySlack(pool, {
      tenantId: tenant_id,
      callId,
      title: meta.rows[0]?.title ?? "Sales call",
      repName: meta.rows[0]?.rep_name ?? null,
      result,
      poster: deps.slackPoster,
    });
  } catch (err) {
    await setStatus(pool, callId, "failed").catch(() => {});
    console.error(`[ingest] processCall ${callId} failed:`, err instanceof Error ? err.message : err);
    throw err;
  }
}
