import { createResource, createSignal, For, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { A, useNavigate } from "@solidjs/router";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/icons";
import { Avatar, CardHeader, AsyncBoundary, InlineError, Spinner } from "../components/ui";
import {
  backfillFathom, connectFathom, connectSlack, disconnectFathom, getSettings,
  listFathomMeetings, putSettings, signOut, updateSlack,
} from "../lib/api";
import { isManager, useSession } from "../lib/session";
import type { FathomMeeting, SettingsData } from "../lib/types";

type Tab = "integrations" | "account";
const tabs: { id: Tab; label: string }[] = [
  { id: "integrations", label: "Integrations" },
  { id: "account", label: "Account" },
];

function Field(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div class="field-label mb-1.5">{props.label}</div>
      <div class="input flex items-center text-ink" classList={{ mono: props.mono }}>{props.value}</div>
    </div>
  );
}

function Account() {
  const me = useSession();
  const nav = useNavigate();
  const [busy, setBusy] = createSignal(false);
  const role = () => me.user.role.charAt(0).toUpperCase() + me.user.role.slice(1);
  const out = async () => {
    setBusy(true);
    try { await signOut(); } catch { /* redirect regardless */ }
    nav("/login", { replace: true });
  };
  return (
    <div class="card">
      <CardHeader title="Account">
        <Avatar name={me.user.email} size={22} />
      </CardHeader>
      <div class="px-[18px] py-4 grid sm:grid-cols-2 gap-3.5">
        <Field label="Email" value={me.user.email} />
        <Field label="Role" value={role()} />
        <Field label="Workspace" value={me.tenant.name} />
        <Field label="Workspace ID" value={me.tenant.slug} mono />
      </div>
      <Show when={isManager(me)}>
        <div class="px-[18px] pb-4 -mt-1">
          <p class="text-xs text-muted">Manage your reps and see the leaderboard on the <A href="/team" class="text-ink font-semibold">Team</A> page.</p>
        </div>
      </Show>
      <div class="px-[18px] py-4 border-t flex items-center justify-between gap-4" style={{ "border-color": "var(--line)" }}>
        <div>
          <b class="text-ink">Sign out</b>
          <div class="text-xs text-muted">End your session on this device.</div>
        </div>
        <button class="btn shrink-0" onClick={out} disabled={busy()}>
          <Icon name="external" size={14} />{busy() ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

// Modal: list the connected account's past Fathom meetings and let the user pick which
// to grade. Opens automatically right after connecting, and from "Scan past meetings".
function PastMeetingsModal(props: { onClose: () => void }) {
  const [meetings, setMeetings] = createSignal<FathomMeeting[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [err, setErr] = createSignal<unknown>(null);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [submitting, setSubmitting] = createSignal(false);
  const [queuedCount, setQueuedCount] = createSignal<number | null>(null);

  const load = async (cur?: string) => {
    setLoading(true);
    setErr(null);
    try {
      const page = await listFathomMeetings(cur);
      setMeetings(cur ? [...meetings(), ...page.meetings] : page.meetings);
      setCursor(page.next_cursor);
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  };
  onMount(() => load());

  // Only meetings we haven't ingested yet can be picked (dedupe would skip the rest).
  const selectable = (m: FathomMeeting) => m.existing_status === null;
  const toggle = (id: string) => {
    const next = new Set(selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const analyze = async () => {
    const ids = [...selected()];
    if (!ids.length) return;
    setSubmitting(true);
    setErr(null);
    try {
      const r = await backfillFathom(ids);
      setQueuedCount(r.queued.length);
    } catch (e) {
      setErr(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Portal>
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.45)" }} onClick={props.onClose}>
        <div class="card w-full max-w-[620px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <CardHeader title="Analyze past meetings">
            <button class="btn btn-sm" onClick={props.onClose}><Icon name="external" size={13} />Close</button>
          </CardHeader>

          <Show when={queuedCount() === null} fallback={
            <div class="px-[18px] py-8 text-center space-y-3">
              <div class="text-ink text-[15px] font-semibold">Queued {queuedCount()} meeting{queuedCount() === 1 ? "" : "s"} for grading</div>
              <p class="text-muted text-[13px]">They’ll appear on your dashboard as scorecards within a minute or two.</p>
              <button class="btn btn-primary" onClick={props.onClose}>Done</button>
            </div>
          }>
            <div class="px-[18px] py-3 border-b text-[13px] text-muted" style={{ "border-color": "var(--line)" }}>
              Pick meetings to grade now. Already-imported calls are shown but can’t be re-run.
            </div>

            <div class="flex-1 overflow-y-auto px-[18px] py-2">
              <Show when={!loading() || meetings().length > 0} fallback={<Spinner label="Loading meetings…" />}>
                <Show when={err()}><div class="py-3"><InlineError error={err()} /></div></Show>
                <Show when={meetings().length === 0 && !loading()}>
                  <p class="text-muted text-[13px] py-6 text-center">No past meetings found in this Fathom account.</p>
                </Show>
                <ul class="divide-y" style={{ "border-color": "var(--line)" }}>
                  <For each={meetings()}>
                    {(m) => (
                      <li class="flex items-center gap-3 py-2.5">
                        <input type="checkbox" class="shrink-0" disabled={!selectable(m)}
                          checked={selected().has(m.recording_id)}
                          onChange={() => toggle(m.recording_id)} />
                        <div class="min-w-0 flex-1">
                          <div class="text-ink text-[13.5px] truncate">{m.title || "Untitled meeting"}</div>
                          <div class="text-muted text-[12px] truncate">
                            {m.recorded_by ?? "—"}{m.created_at ? ` · ${formatMeetingDate(m.created_at)}` : ""}
                          </div>
                        </div>
                        <Show when={m.existing_status}>
                          <span class="chip chip-yes shrink-0"><span class="dot" />{m.existing_status}</span>
                        </Show>
                        <Show when={!m.existing_status && !m.matches_filter}>
                          <span class="text-[11px] text-muted shrink-0" title="Outside your keyword filter — grading it anyway">off-filter</span>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={cursor()}>
                  <button class="btn btn-sm w-full mt-2" onClick={() => load(cursor()!)} disabled={loading()}>
                    {loading() ? "Loading…" : "Load more"}
                  </button>
                </Show>
              </Show>
            </div>

            <div class="px-[18px] py-3 border-t flex items-center justify-between gap-3" style={{ "border-color": "var(--line)" }}>
              <span class="text-[13px] text-muted">{selected().size} selected</span>
              <button class="btn btn-primary" onClick={analyze} disabled={submitting() || selected().size === 0}>
                {submitting() ? "Queuing…" : `Analyze ${selected().size || ""} selected`}
              </button>
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  );
}

function formatMeetingDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Integrations(props: { settings: SettingsData; onChange: () => void }) {
  const s = () => props.settings;
  const [showMeetings, setShowMeetings] = createSignal(false);

  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(s().webhook_url); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  // Call filter keyword (null = track server value)
  const [keywordDraft, setKeywordDraft] = createSignal<string | null>(null);
  const keyword = () => keywordDraft() ?? s().call_filter_keyword;
  const [savingKw, setSavingKw] = createSignal(false);
  const saveKeyword = async () => {
    setSavingKw(true);
    try { await putSettings({ call_filter_keyword: keyword().trim() }); setKeywordDraft(null); props.onChange(); }
    finally { setSavingKw(false); }
  };

  // Fathom connect / rotate. On success the webhook is registered server-side (green),
  // and we open the past-meetings modal so the user can grade existing calls immediately.
  const [fathomKey, setFathomKey] = createSignal("");
  const [savingFathom, setSavingFathom] = createSignal(false);
  const [fathomErr, setFathomErr] = createSignal<unknown>(null);
  const saveFathom = async () => {
    if (!fathomKey().trim()) return;
    setSavingFathom(true);
    setFathomErr(null);
    try {
      await connectFathom(fathomKey().trim());
      setFathomKey("");
      props.onChange();
      setShowMeetings(true);
    } catch (e) {
      setFathomErr(e);
    } finally {
      setSavingFathom(false);
    }
  };

  const [disconnecting, setDisconnecting] = createSignal(false);
  const disconnect = async () => {
    setDisconnecting(true);
    try { await disconnectFathom(); props.onChange(); } catch { /* ignore */ }
    finally { setDisconnecting(false); }
  };

  // Slack
  const [botToken, setBotToken] = createSignal("");
  const [channelId, setChannelId] = createSignal("");
  const [savingSlack, setSavingSlack] = createSignal(false);
  const connectSlackNow = async () => {
    if (!botToken().trim() || !channelId().trim()) return;
    setSavingSlack(true);
    try { await connectSlack({ botToken: botToken().trim(), channelId: channelId().trim() }); setBotToken(""); props.onChange(); }
    finally { setSavingSlack(false); }
  };
  const toggleSlack = async () => {
    const next = !s().integrations.slack.enabled;
    try { await updateSlack({ enabled: next }); props.onChange(); } catch { /* ignore */ }
  };

  return (
    <>
      {/* Fathom */}
      <Show when={showMeetings()}>
        <PastMeetingsModal onClose={() => { setShowMeetings(false); props.onChange(); }} />
      </Show>
      <div class="card mb-4">
        <CardHeader title="Fathom">
          <Avatar name="F" size={22} />
          <Show
            when={s().integrations.fathom.connected}
            fallback={<span class="chip chip-no"><span class="dot" />Not connected</span>}
          >
            <Show
              when={s().integrations.fathom.webhook_registered}
              fallback={<span class="chip chip-no"><span class="dot" />Connected · finish setup</span>}
            >
              <span class="chip chip-yes"><span class="dot" />Connected · auto-syncing</span>
            </Show>
          </Show>
        </CardHeader>
        <div class="px-[18px] py-4 space-y-3.5">
          <div>
            <div class="field-label mb-1.5">{s().integrations.fathom.connected ? "Rotate API key" : "API key"}</div>
            <div class="flex items-center gap-3">
              <input class="input flex-1" type="password" placeholder="Paste your Fathom API key"
                value={fathomKey()} onInput={(e) => setFathomKey(e.currentTarget.value)} />
              <button class="btn btn-primary shrink-0" onClick={saveFathom} disabled={savingFathom() || !fathomKey().trim()}>
                {savingFathom() ? "Connecting…" : s().integrations.fathom.connected ? "Rotate" : "Connect"}
              </button>
            </div>
            <p class="text-xs text-muted mt-1.5">Fathom → Settings → API &amp; Integrations → Generate API Key. Encrypted at rest. We register the webhook for you — no copy-paste needed.</p>
            <Show when={fathomErr()}><div class="mt-2"><InlineError error={fathomErr()} /></div></Show>
          </div>

          <Show when={s().integrations.fathom.connected}>
            <div class="flex items-center gap-3 flex-wrap pt-1">
              <button class="btn btn-primary btn-sm" onClick={() => setShowMeetings(true)}>
                <Icon name="external" size={13} />Scan past meetings
              </button>
              <button class="btn btn-sm" onClick={disconnect} disabled={disconnecting()}>
                {disconnecting() ? "Disconnecting…" : "Disconnect"}
              </button>
              <span class="text-xs text-muted">New calls grade automatically. Use scan to grade meetings recorded before you connected.</span>
            </div>
          </Show>

          {/* Advanced: the webhook URL is registered automatically; kept here for reference. */}
          <details>
            <summary class="field-label cursor-pointer select-none">Webhook URL (registered automatically)</summary>
            <div class="input flex items-center justify-between gap-2 mt-1.5">
              <span class="mono text-muted text-[12.5px] truncate">{s().webhook_url}</span>
              <button class="btn btn-sm shrink-0" onClick={copy}>
                <Icon name={copied() ? "check" : "copy"} size={13} />{copied() ? "Copied" : "Copy"}
              </button>
            </div>
          </details>

          <div>
            <div class="field-label mb-1.5">Call filter keyword</div>
            <div class="flex items-center gap-3 flex-wrap">
              <input class="input !w-[220px] mono" placeholder="(analyze all calls)"
                value={keyword()} onInput={(e) => setKeywordDraft(e.currentTarget.value)} />
              <button class="btn btn-sm" onClick={saveKeyword} disabled={savingKw() || keywordDraft() === null}>
                {savingKw() ? "Saving…" : "Save"}
              </button>
              <span class="text-xs text-muted">Only calls whose title contains this word are analyzed. Empty = all.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Slack */}
      <div class="card">
        <CardHeader title="Slack">
          <Avatar name="S" size={22} />
          <Show when={s().integrations.slack.connected} fallback={<span class="chip chip-no"><span class="dot" />Not connected</span>}>
            <span class="chip chip-yes"><span class="dot" />Connected</span>
          </Show>
        </CardHeader>
        <div class="px-[18px] py-4">
          <p class="text-muted mb-4">Post each scorecard to a channel as a headline plus a threaded 11-criteria breakdown.</p>
          <Show
            when={s().integrations.slack.connected}
            fallback={
              <div class="space-y-3.5">
                <div>
                  <div class="field-label mb-1.5">Bot token</div>
                  <input class="input" type="password" placeholder="xoxb-…"
                    value={botToken()} onInput={(e) => setBotToken(e.currentTarget.value)} />
                </div>
                <div>
                  <div class="field-label mb-1.5">Channel ID</div>
                  <input class="input !w-[260px] mono" placeholder="C0123456789"
                    value={channelId()} onInput={(e) => setChannelId(e.currentTarget.value)} />
                </div>
                <button class="btn btn-primary" onClick={connectSlackNow} disabled={savingSlack() || !botToken().trim() || !channelId().trim()}>
                  {savingSlack() ? "Connecting…" : "Connect Slack"}
                </button>
              </div>
            }
          >
            <div class="space-y-3.5">
              <div>
                <div class="field-label mb-1.5">Channel</div>
                <div class="input flex items-center mono text-muted !w-[260px]">{s().integrations.slack.channel_id ?? "—"}</div>
              </div>
              <div class="flex items-center justify-between pt-3 border-t" style={{ "border-color": "var(--line)" }}>
                <div>
                  <b class="text-ink">Post scorecards to Slack</b>
                  <div class="text-xs text-muted">Turn off to keep reporting dashboard-only.</div>
                </div>
                <button class="switch" data-on={s().integrations.slack.enabled ?? false} onClick={toggleSlack} aria-label="Toggle Slack posting" />
              </div>
            </div>
          </Show>
        </div>
      </div>
    </>
  );
}

export function Settings() {
  const [tab, setTab] = createSignal<Tab>("integrations");
  const [settings, { refetch }] = createResource(getSettings);

  return (
    <AppShell crumbs={<><span>Settings</span> / <b class="text-ink">Integrations</b></>}>
      <div class="max-w-[820px]">
        <div class="mb-5">
          <h1 class="text-[22px] font-bold tracking-tight text-ink">Settings</h1>
          <p class="text-muted text-[13.5px] mt-0.5">Connect your recorder and reporting channels.</p>
        </div>

        <div class="flex gap-1.5 mb-5 border-b" style={{ "border-color": "var(--line)" }}>
          <For each={tabs}>
            {(t) => (
              <button
                class="px-3 py-2 text-[13.5px] -mb-px border-b-2 border-transparent"
                classList={{ "!border-ink font-semibold text-ink": tab() === t.id, "text-muted": tab() !== t.id }}
                onClick={() => setTab(t.id)}
              >{t.label}</button>
            )}
          </For>
        </div>

        <Show when={tab() === "integrations"} fallback={<Account />}>
          <AsyncBoundary data={settings}>
            {(s) => <Integrations settings={s} onChange={refetch} />}
          </AsyncBoundary>
        </Show>
      </div>
    </AppShell>
  );
}
