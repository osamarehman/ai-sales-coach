import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { pool } from "../db";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../lib/async";
import { encrypt, decrypt } from "../lib/crypto";
import { HttpError } from "../middleware/error";
import {
  FathomError,
  createWebhook,
  deleteWebhook,
  listMeetings,
} from "../services/fathom";
import { enqueueCall, processCall, type TenantRow, type NormalizedWebhook } from "../services/ingest";

const router = Router();
router.use(requireAuth);

// Shape we keep in integrations.config for the Fathom provider.
interface FathomConfig {
  webhook_id?: string;
  webhook_secret_enc?: string; // encrypted whsec_… for future signature verification
}

function fathomWebhookUrl(webhookToken: string): string {
  return `${config.publicApiUrl}/api/webhooks/fathom/${webhookToken}`;
}

// Translate a Fathom API failure into a client-safe status: a bad/rejected key is the
// user's problem (400); anything else is an upstream fault (502).
function fathomHttpError(err: unknown): HttpError {
  if (err instanceof FathomError) {
    if (err.status === 401 || err.status === 403) {
      return new HttpError(400, "Fathom rejected the API key — check it and try again");
    }
    return new HttpError(502, "Fathom API is unavailable, please retry");
  }
  return err instanceof HttpError ? err : new HttpError(500, "internal error");
}

// Load the tenant row + decrypted Fathom key, or fail with a clear status.
async function loadFathom(
  db: Pool,
  tenantId: string,
): Promise<{ tenant: TenantRow & { webhook_token: string }; apiKey: string; cfg: FathomConfig }> {
  const { rows } = await db.query<{
    id: string;
    call_filter_keyword: string | null;
    webhook_token: string;
    encrypted_token: string | null;
    config: FathomConfig | null;
  }>(
    `select t.id, t.call_filter_keyword, t.webhook_token, i.encrypted_token, i.config
       from tenants t
       left join integrations i on i.tenant_id = t.id and i.provider = 'fathom'
      where t.id = $1`,
    [tenantId],
  );
  const r = rows[0];
  if (!r?.encrypted_token) throw new HttpError(400, "Fathom is not connected");
  return {
    tenant: { id: r.id, call_filter_keyword: r.call_filter_keyword, webhook_token: r.webhook_token },
    apiKey: decrypt(r.encrypted_token),
    cfg: r.config ?? {},
  };
}

// Current tenant settings + the Fathom webhook URL to paste into Fathom.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth!;
    const t = await pool.query<{ call_filter_keyword: string; webhook_token: string }>(
      "select call_filter_keyword, webhook_token from tenants where id = $1",
      [tenantId],
    );
    const integ = await pool.query<{
      provider: string;
      config: { enabled?: boolean; channel_id?: string; webhook_id?: string };
    }>("select provider, config from integrations where tenant_id = $1", [tenantId]);
    const by = new Map(integ.rows.map((r) => [r.provider, r.config]));
    res.json({
      call_filter_keyword: t.rows[0].call_filter_keyword,
      webhook_url: fathomWebhookUrl(t.rows[0].webhook_token),
      integrations: {
        fathom: {
          connected: by.has("fathom"),
          // Green state: the webhook is live in Fathom, so calls flow automatically.
          webhook_registered: Boolean(by.get("fathom")?.webhook_id),
        },
        slack: {
          connected: by.has("slack"),
          enabled: Boolean(by.get("slack")?.enabled),
          channel_id: by.get("slack")?.channel_id ?? null,
        },
      },
    });
  }),
);

const UpdateSettings = z.object({ call_filter_keyword: z.string().max(100) });
router.put(
  "/",
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth!;
    const input = UpdateSettings.parse(req.body);
    await pool.query("update tenants set call_filter_keyword = $2 where id = $1", [
      tenantId,
      input.call_filter_keyword,
    ]);
    res.json({ ok: true, call_filter_keyword: input.call_filter_keyword });
  }),
);

// Connect Fathom: the key is encrypted (AES-256-GCM) before it touches the DB, and we
// register the tenant's unique webhook URL with Fathom via their API — so it "turns
// green" and calls flow automatically without the user pasting anything into Fathom.
const ConnectFathom = z.object({ apiKey: z.string().min(10).max(500) });
router.post(
  "/integrations/fathom",
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth!;
    const { apiKey } = ConnectFathom.parse(req.body);

    // Resolve the tenant's webhook token + any previously-registered webhook.
    const cur = await pool.query<{ webhook_token: string; config: FathomConfig | null }>(
      `select t.webhook_token, i.config
         from tenants t
         left join integrations i on i.tenant_id = t.id and i.provider = 'fathom'
        where t.id = $1`,
      [tenantId],
    );
    const webhookToken = cur.rows[0].webhook_token;
    const priorWebhookId = cur.rows[0].config?.webhook_id;

    // Register (idempotent): drop any prior webhook, then create a fresh one pointing at
    // this tenant's isolated URL. If the key is bad, Fathom rejects here → 400, nothing stored.
    let webhook;
    try {
      if (priorWebhookId) await deleteWebhook(apiKey, priorWebhookId);
      webhook = await createWebhook(apiKey, fathomWebhookUrl(webhookToken));
    } catch (err) {
      throw fathomHttpError(err);
    }

    const newConfig: FathomConfig = {
      webhook_id: webhook.id,
      webhook_secret_enc: encrypt(webhook.secret),
    };
    await pool.query(
      `insert into integrations (tenant_id, provider, encrypted_token, config)
       values ($1, 'fathom', $2, $3)
       on conflict (tenant_id, provider)
         do update set encrypted_token = excluded.encrypted_token,
                       config = excluded.config, updated_at = now()`,
      [tenantId, encrypt(apiKey), JSON.stringify(newConfig)],
    );
    res.status(201).json({ ok: true, connected: true, webhook_registered: true });
  }),
);

// Disconnect Fathom: revoke the webhook in Fathom (best-effort) and drop the integration.
router.delete(
  "/integrations/fathom",
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth!;
    const { apiKey, cfg } = await loadFathom(pool, tenantId);
    if (cfg.webhook_id) {
      await deleteWebhook(apiKey, cfg.webhook_id).catch(() => {
        /* best-effort — we still remove our record below */
      });
    }
    await pool.query("delete from integrations where tenant_id = $1 and provider = 'fathom'", [
      tenantId,
    ]);
    res.json({ ok: true, connected: false });
  }),
);

// List the connected account's past Fathom meetings so the user can pick which to grade.
// Marks meetings we've already ingested and whether they match the current keyword filter.
router.get(
  "/integrations/fathom/meetings",
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth!;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const { tenant, apiKey } = await loadFathom(pool, tenantId);

    let page;
    try {
      page = await listMeetings(apiKey, { cursor });
    } catch (err) {
      throw fathomHttpError(err);
    }

    // Which of these recordings are already in our system (any status)?
    const ids = page.items.map((m) => m.recordingId);
    const existing = ids.length
      ? await pool.query<{ recording_id: string; status: string }>(
          "select recording_id, status from calls where tenant_id = $1 and recording_id = any($2)",
          [tenantId, ids],
        )
      : { rows: [] as { recording_id: string; status: string }[] };
    const statusById = new Map(existing.rows.map((r) => [r.recording_id, r.status]));

    const keyword = tenant.call_filter_keyword;
    res.json({
      keyword,
      next_cursor: page.nextCursor,
      meetings: page.items.map((m) => ({
        recording_id: m.recordingId,
        title: m.title,
        recorded_by: m.recordedByName ?? m.recordedByEmail,
        created_at: m.createdAt,
        share_url: m.shareUrl,
        matches_filter: !keyword || m.title.toLowerCase().includes(keyword.toLowerCase()),
        existing_status: statusById.get(m.recordingId) ?? null,
      })),
    });
  }),
);

// Backfill: grade a hand-picked set of past meetings. Reuses the webhook pipeline
// (dedupe + processCall), and force-grades the picks regardless of the keyword filter.
const Backfill = z.object({ recordingIds: z.array(z.string().min(1)).min(1).max(50) });
router.post(
  "/integrations/fathom/backfill",
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth!;
    const { recordingIds } = Backfill.parse(req.body);
    const { tenant, apiKey } = await loadFathom(pool, tenantId);

    // Pull one page to recover titles/advisor for the picked ids. (v1: picks come from
    // the first page the modal showed; ids not on it still ingest with an empty title.)
    let known = new Map<string, NormalizedWebhook>();
    try {
      const page = await listMeetings(apiKey);
      known = new Map(
        page.items.map((m) => [
          m.recordingId,
          {
            recordingId: m.recordingId,
            title: m.title,
            advisorEmail: m.recordedByEmail,
            advisorName: m.recordedByName,
          },
        ]),
      );
    } catch (err) {
      throw fathomHttpError(err);
    }

    const queued: { recording_id: string; call_id: string; duplicate: boolean }[] = [];
    for (const rid of recordingIds) {
      const norm: NormalizedWebhook = known.get(rid) ?? {
        recordingId: rid,
        title: "",
        advisorEmail: null,
        advisorName: null,
      };
      const result = await enqueueCall(pool, tenant, norm, { force: true });
      queued.push({ recording_id: rid, call_id: result.callId, duplicate: result.duplicate });
      if (result.process) {
        setImmediate(() => {
          processCall(pool, result.callId).catch(() => {
            /* status set to 'failed' inside processCall */
          });
        });
      }
    }
    res.status(202).json({ ok: true, queued });
  }),
);

// Connect Slack: bot token (xoxb-…) encrypted; channel + enabled stored in config.
const ConnectSlack = z.object({ botToken: z.string().min(10), channelId: z.string().min(3) });
router.post(
  "/integrations/slack",
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth!;
    const { botToken, channelId } = ConnectSlack.parse(req.body);
    await pool.query(
      `insert into integrations (tenant_id, provider, encrypted_token, config)
       values ($1, 'slack', $2, $3)
       on conflict (tenant_id, provider)
         do update set encrypted_token = excluded.encrypted_token, config = excluded.config, updated_at = now()`,
      [tenantId, encrypt(botToken), JSON.stringify({ channel_id: channelId, enabled: true })],
    );
    res.status(201).json({ ok: true, connected: true, enabled: true, channel_id: channelId });
  }),
);

// Toggle Slack posting on/off or change the channel.
const UpdateSlack = z.object({
  enabled: z.boolean().optional(),
  channelId: z.string().min(3).optional(),
});
router.put(
  "/integrations/slack",
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth!;
    const input = UpdateSlack.parse(req.body);
    const cur = await pool.query<{ config: { enabled?: boolean; channel_id?: string } }>(
      "select config from integrations where tenant_id = $1 and provider = 'slack'",
      [tenantId],
    );
    if (cur.rows.length === 0) return res.status(404).json({ error: "slack not connected" });
    const cfg = { ...cur.rows[0].config };
    if (input.enabled !== undefined) cfg.enabled = input.enabled;
    if (input.channelId !== undefined) cfg.channel_id = input.channelId;
    await pool.query(
      "update integrations set config = $2, updated_at = now() where tenant_id = $1 and provider = 'slack'",
      [tenantId, JSON.stringify(cfg)],
    );
    res.json({ ok: true, ...cfg });
  }),
);

export default router;
