// Typed API client. Same-origin `/api/*` (Vite proxies to the backend on the
// compose network), cookie sessions so every call sends `credentials: "include"`.
// See backend/API.md for the contract.

import type {
  Analysis, ApiCall, CallDetail, CallRow, CallsPage, FathomMeetingsPage, LeaderboardRep,
  Me, RepTrends, SettingsData,
} from "./types";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    let details: unknown;
    try {
      const body = await res.json();
      message = body?.error ?? message;
      details = body?.details;
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, message, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

// ---------- Auth (BetterAuth) ----------
export const signUp = (b: { name: string; email: string; password: string }) =>
  req<unknown>("/api/auth/sign-up/email", { method: "POST", ...json(b) });
export const signIn = (b: { email: string; password: string }) =>
  req<unknown>("/api/auth/sign-in/email", { method: "POST", ...json(b) });
export const signOut = () => req<unknown>("/api/auth/sign-out", { method: "POST" });

// ---------- Session / tenant ----------
export const getMe = () => req<Me>("/api/me");

// ---------- Calls ----------
export interface CallsQuery {
  rep?: string;
  status?: string;
  outcome?: "qualified" | "disqualified";
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}

export async function getCalls(q: CallsQuery = {}): Promise<CallsPage> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== "" && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  return req<CallsPage>(`/api/calls${qs ? `?${qs}` : ""}`);
}

export const getCall = (id: string) => req<CallDetail>(`/api/calls/${id}`);

// ---------- Analytics ----------
export const getLeaderboard = () => req<{ reps: LeaderboardRep[] }>("/api/leaderboard");
export const getRepTrends = (id: string) => req<RepTrends>(`/api/reps/${id}/trends`);

// ---------- Settings ----------
export const getSettings = () => req<SettingsData>("/api/settings");
export const putSettings = (b: { call_filter_keyword: string }) =>
  req<SettingsData>("/api/settings", { method: "PUT", ...json(b) });
export const connectFathom = (apiKey: string) =>
  req<{ ok: boolean; connected: boolean; webhook_registered: boolean }>(
    "/api/settings/integrations/fathom", { method: "POST", ...json({ apiKey }) });
export const disconnectFathom = () =>
  req<{ ok: boolean; connected: boolean }>("/api/settings/integrations/fathom", { method: "DELETE" });
export const listFathomMeetings = (cursor?: string) =>
  req<FathomMeetingsPage>(`/api/settings/integrations/fathom/meetings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
export const backfillFathom = (recordingIds: string[]) =>
  req<{ ok: boolean; queued: { recording_id: string; call_id: string; duplicate: boolean }[] }>(
    "/api/settings/integrations/fathom/backfill", { method: "POST", ...json({ recordingIds }) });
export const connectSlack = (b: { botToken: string; channelId: string }) =>
  req<{ ok: boolean; connected: boolean; enabled: boolean; channel_id: string }>(
    "/api/settings/integrations/slack", { method: "POST", ...json(b) });
export const updateSlack = (b: { enabled?: boolean; channelId?: string }) =>
  req<{ ok: boolean; enabled: boolean; channel_id: string }>(
    "/api/settings/integrations/slack", { method: "PUT", ...json(b) });

// ---------- Mappers: API shapes → UI display types ----------

/** The current user's rep id, discovered from their own calls (reps are keyed by
 * email, separate from auth users). Returns undefined if they have no calls. */
export function findRepId(calls: ApiCall[], email: string): string | undefined {
  return calls.find((c) => c.rep && c.rep.email === email)?.rep?.id;
}

/** Display name for a rep, tolerating null / missing display_name. */
export function repName(rep: { display_name: string | null; email: string } | null): string {
  if (!rep) return "Unassigned";
  return rep.display_name || rep.email || "Unassigned";
}

/** "Acme — GAMEPLAN" → "Acme". Used for the avatar / prospect column. */
export function callProspect(title: string): string {
  const head = title.split(/[—–-]/)[0]?.trim();
  return head || title;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** received|skipped|fetching|analyzing|analyzed|failed → UI's 3-state pill. */
export function mapStatus(status: string): CallRow["status"] {
  if (status === "analyzed") return "analyzed";
  if (status === "failed") return "failed";
  return "pending";
}

export function toCallRow(c: ApiCall): CallRow {
  return {
    id: c.id,
    title: c.title,
    advisor: repName(c.rep),
    prospect: callProspect(c.title),
    date: formatDate(c.created_at),
    duration: "—", // not present on the list payload
    totalScore: c.total_score,
    outcome: c.status === "analyzed" ? c.outcome : null,
    status: mapStatus(c.status),
  };
}

/** Build the scorecard's display CallRow from the detail payload. */
export function detailToCallRow(d: CallDetail): CallRow {
  const c = d.call;
  return {
    id: c.id,
    title: c.title,
    advisor: repName(c.rep),
    prospect: callProspect(c.title),
    date: new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    duration: "—",
    totalScore: d.analysis?.total_score ?? null,
    outcome: d.analysis ? d.analysis.outcome : null,
    status: mapStatus(c.status),
  };
}

/** Reshape the API analysis into the UI's `Analysis` (keyed criteria → evaluations). */
export function toAnalysis(d: CallDetail): Analysis | null {
  const a = d.analysis;
  if (!a) return null;
  return {
    call_metadata: {
      call_id: d.call.id,
      advisor_name: repName(d.call.rep),
      prospect_name: callProspect(d.call.title),
      call_duration: "",
    },
    disqualification_summary: a.disqualification_summary,
    evaluations: a.criteria.map((c) => ({
      key: c.key,
      label: c.label,
      criterion: c.criterion,
      rating: c.rating,
      score: c.score,
      reasoning: c.reasoning,
      timestamp_events: c.timestamp_events,
    })),
    critical_moments: a.critical_moments,
    summary: a.summary,
  };
}
