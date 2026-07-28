import type { Pool } from "pg";
import { decrypt } from "../lib/crypto";
import { renderHeadline, renderCriteria } from "./slack-render";
import { postMessage } from "./slack";
import type { AnalysisResult } from "./analysis";

export type SlackPoster = (args: {
  botToken: string;
  channelId: string;
  blocks: unknown[];
  text: string;
  threadTs?: string;
}) => Promise<{ ts: string }>;

interface SlackConfig {
  channel_id?: string;
  enabled?: boolean;
}

// Best-effort: if the tenant has Slack connected AND enabled, post the headline to
// the channel and the 11-criteria breakdown in its thread, then log a notification.
// Never throws — a Slack failure must not fail the analysis.
export async function notifySlack(
  pool: Pool,
  args: {
    tenantId: string;
    callId: string;
    title: string;
    repName: string | null;
    result: AnalysisResult;
    poster?: SlackPoster;
  },
): Promise<void> {
  const { tenantId, callId, title, repName, result } = args;
  const poster = args.poster ?? ((a) => postMessage(a));

  const integ = await pool.query<{ encrypted_token: string | null; config: SlackConfig }>(
    "select encrypted_token, config from integrations where tenant_id = $1 and provider = 'slack'",
    [tenantId],
  );
  const row = integ.rows[0];
  if (!row?.encrypted_token || !row.config?.enabled || !row.config?.channel_id) return;
  const channelId = row.config.channel_id;

  try {
    const botToken = decrypt(row.encrypted_token);
    const head = renderHeadline(title, repName, result);
    const headMsg = await poster({ botToken, channelId, blocks: head.blocks, text: head.text });
    const body = renderCriteria(result);
    await poster({
      botToken,
      channelId,
      blocks: body.blocks,
      text: body.text,
      threadTs: headMsg.ts,
    });
    await pool.query(
      `insert into notifications (tenant_id, call_id, channel, target, thread_ts, status)
       values ($1, $2, 'slack', $3, $4, 'sent')`,
      [tenantId, callId, channelId, headMsg.ts],
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await pool
      .query(
        `insert into notifications (tenant_id, call_id, channel, target, status, detail)
         values ($1, $2, 'slack', $3, 'failed', $4)`,
        [tenantId, callId, channelId, detail],
      )
      .catch(() => {});
    console.error(`[notify] slack post failed for call ${callId}: ${detail}`);
  }
}
