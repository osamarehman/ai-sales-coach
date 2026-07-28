export class FathomError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "FathomError";
  }
}

export interface FathomClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch; // injectable for tests
}

export type FetchTranscriptOptions = FathomClientOptions;

function baseUrl(opts: FathomClientOptions): string {
  return opts.baseUrl ?? process.env.FATHOM_BASE_URL ?? "https://api.fathom.ai/external/v1";
}

// One place for the authenticated call + uniform error surface.
async function fathomFetch(
  path: string,
  apiKey: string,
  init: RequestInit,
  opts: FathomClientOptions,
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await doFetch(`${baseUrl(opts)}${path}`, {
      ...init,
      headers: { "X-Api-Key": apiKey, ...(init.headers ?? {}) },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FathomError(`Fathom ${res.status}: ${body.slice(0, 300)}`, res.status);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// GET /external/v1/recordings/{id}/transcript with the tenant's X-Api-Key. Returns raw JSON.
export async function fetchTranscript(
  recordingId: string,
  apiKey: string,
  opts: FetchTranscriptOptions = {},
): Promise<unknown> {
  const res = await fathomFetch(
    `/recordings/${encodeURIComponent(recordingId)}/transcript`,
    apiKey,
    { method: "GET" },
    opts,
  );
  return res.json();
}

// --- Webhook management (POST/DELETE /webhooks) ---------------------------------

// Which recordings this webhook fires for. my_recordings = the key owner's own calls;
// my_shared_with_team_recordings = calls a teammate shared with them.
export const DEFAULT_TRIGGERED_FOR = ["my_recordings", "my_shared_with_team_recordings"] as const;

export interface CreatedWebhook {
  id: string;
  secret: string; // whsec_… used to verify webhook signatures
}

// POST /webhooks — register `destinationUrl` to receive new meeting content.
// Fathom requires at least one include_* true; we opt into summary (lightweight) and
// still fetch the full transcript by recording id in the pipeline.
export async function createWebhook(
  apiKey: string,
  destinationUrl: string,
  opts: FathomClientOptions = {},
): Promise<CreatedWebhook> {
  const res = await fathomFetch(
    "/webhooks",
    apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination_url: destinationUrl,
        triggered_for: DEFAULT_TRIGGERED_FOR,
        include_summary: true,
      }),
    },
    opts,
  );
  const body = (await res.json()) as { id?: string; secret?: string };
  if (!body.id || !body.secret) {
    throw new FathomError("Fathom webhook create returned no id/secret", res.status);
  }
  return { id: body.id, secret: body.secret };
}

// DELETE /webhooks/{id} — used to revoke on disconnect / before re-registering.
// 404 is treated as success (already gone).
export async function deleteWebhook(
  apiKey: string,
  webhookId: string,
  opts: FathomClientOptions = {},
): Promise<void> {
  try {
    await fathomFetch(`/webhooks/${encodeURIComponent(webhookId)}`, apiKey, { method: "DELETE" }, opts);
  } catch (err) {
    if (err instanceof FathomError && err.status === 404) return;
    throw err;
  }
}

// --- Listing past meetings (GET /meetings) --------------------------------------

export interface FathomMeeting {
  recordingId: string;
  title: string;
  recordedByEmail: string | null;
  recordedByName: string | null;
  createdAt: string | null;
  shareUrl: string | null;
}

export interface MeetingPage {
  items: FathomMeeting[];
  nextCursor: string | null;
}

interface RawMeeting {
  recording_id?: number | string;
  title?: string;
  meeting_title?: string;
  created_at?: string;
  share_url?: string;
  recorded_by?: { email?: string; name?: string } | null;
}

// GET /meetings — one page of the key owner's past meetings, newest-first as Fathom
// returns them. `cursor` pages via the response's next_cursor.
export async function listMeetings(
  apiKey: string,
  params: { cursor?: string } = {},
  opts: FathomClientOptions = {},
): Promise<MeetingPage> {
  const qs = new URLSearchParams();
  if (params.cursor) qs.set("cursor", params.cursor);
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fathomFetch(`/meetings${suffix}`, apiKey, { method: "GET" }, opts);
  const body = (await res.json()) as { items?: RawMeeting[]; next_cursor?: string | null };
  const items: FathomMeeting[] = (body.items ?? [])
    .filter((m) => m.recording_id !== undefined && m.recording_id !== null)
    .map((m) => ({
      recordingId: String(m.recording_id),
      title: m.title ?? m.meeting_title ?? "",
      recordedByEmail: m.recorded_by?.email ?? null,
      recordedByName: m.recorded_by?.name ?? null,
      createdAt: m.created_at ?? null,
      shareUrl: m.share_url ?? null,
    }));
  return { items, nextCursor: body.next_cursor ?? null };
}
