import { createResource, For, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { AppShell } from "../components/AppShell";
import { Avatar, StatTile, OutcomeBadge, StatusPill, CardHeader, AsyncBoundary } from "../components/ui";
import { LineChart } from "../components/charts";
import { findRepId, getCalls, getRepTrends, toCallRow } from "../lib/api";
import { useSession } from "../lib/session";
import type { ApiCall } from "../lib/types";

const MAX_PER_CRITERION = 9.09;

function kpis(calls: ApiCall[]) {
  const analyzed = calls.filter((c) => c.status === "analyzed");
  const scored = analyzed.filter((c) => c.total_score != null);
  const avg = scored.length ? scored.reduce((s, c) => s + (c.total_score ?? 0), 0) / scored.length : null;
  const qualified = analyzed.filter((c) => c.outcome === "qualified").length;
  const disqualified = analyzed.filter((c) => c.outcome === "disqualified").length;
  const pending = calls.filter((c) => !["analyzed", "failed", "skipped"].includes(c.status)).length;
  return { analyzed: analyzed.length, avg, qualified, disqualified, pending };
}

export function Dashboard() {
  const me = useSession();
  const nav = useNavigate();
  const [data] = createResource(() => getCalls({ page_size: 100 }));
  const myRepId = () => {
    const cs = data()?.calls;
    return cs ? findRepId(cs, me.user.email) : undefined;
  };
  const [trends] = createResource(myRepId, (id) => getRepTrends(id));

  const firstName = () => (me.user.name || me.user.email).split(/[\s@]/)[0];
  const weakest = () =>
    [...(trends()?.by_criterion ?? [])]
      .sort((a, b) => a.avg_score - b.avg_score)
      .slice(0, 3);

  return (
    <AppShell crumbs={<b class="text-ink">Dashboard</b>}>
      <div class="flex items-start gap-4 mb-5">
        <div>
          <h1 class="text-[22px] font-bold tracking-tight text-ink">Good to see you, {firstName()}</h1>
          <p class="text-muted text-[13.5px] mt-0.5">{me.tenant.name} · your team at a glance.</p>
        </div>
      </div>

      <AsyncBoundary data={data}>
        {(page) => {
          const k = kpis(page.calls);
          const recent = () => page.calls.slice(0, 5).map(toCallRow);
          return (
            <>
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-4">
                <StatTile label="Calls analyzed" value={String(k.analyzed)} delta={`${page.total} total`} />
                <StatTile label="Avg total score" value={k.avg != null ? k.avg.toFixed(1) : "—"} delta="out of 100" />
                <StatTile label="Qualified / DQ" value={`${k.qualified} · ${k.disqualified}`} delta={k.analyzed ? `${Math.round((k.qualified / k.analyzed) * 100)}% qualified` : undefined} />
                <StatTile label="Analyses pending" value={String(k.pending)} delta={k.pending ? "running now" : "all caught up"} />
              </div>

              <div class="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <div class="card overflow-hidden">
                  <CardHeader title="Recent calls">
                    <A href="/calls" class="btn btn-sm btn-ghost">View all →</A>
                  </CardHeader>
                  <Show when={recent().length > 0} fallback={<p class="px-[18px] py-8 text-center text-muted text-[13px]">No calls yet — connect Fathom to start grading.</p>}>
                    <div class="overflow-x-auto">
                      <table class="table">
                        <thead><tr><th>Call</th><th>Advisor</th><th>Score</th><th>Outcome</th></tr></thead>
                        <tbody>
                          <For each={recent()}>
                            {(c) => (
                              <tr onClick={() => nav(`/calls/${c.id}`)}>
                                <td><div class="flex items-center gap-2.5"><Avatar name={c.prospect} size={22} /><b class="text-ink">{c.prospect}</b></div></td>
                                <td>{c.advisor}</td>
                                <td class="font-bold text-ink">{c.totalScore != null ? c.totalScore.toFixed(1) : <span class="text-muted font-normal">—</span>}</td>
                                <td><Show when={c.outcome} fallback={<StatusPill status={c.status} />}>{(o) => <OutcomeBadge outcome={o()} />}</Show></td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </Show>
                </div>

                <div class="flex flex-col gap-4">
                  <div class="card">
                    <CardHeader title="Your weakest criteria" />
                    <div class="px-[18px] py-3.5">
                      <Show when={weakest().length > 0} fallback={<p class="text-muted text-[13px] py-2">Grade a few calls to see where to focus.</p>}>
                        <For each={weakest()}>
                          {(c) => {
                            const pct = Math.max(4, Math.round((c.avg_score / MAX_PER_CRITERION) * 100));
                            return (
                              <div class="mb-4 last:mb-0">
                                <div class="flex justify-between mb-2 text-[13px]"><span class="text-ink-2">{c.label}</span><span class="mono text-muted">avg {c.avg_score.toFixed(1)}</span></div>
                                <div class="h-2 rounded-full" style={{ width: "100%", background: "var(--surface-2)" }}>
                                  <div class="h-2 rounded-full" style={{ width: `${pct}%`, background: "var(--accent)" }} />
                                </div>
                              </div>
                            );
                          }}
                        </For>
                      </Show>
                    </div>
                  </div>
                  <div class="card p-[18px]">
                    <div class="text-[11px] uppercase tracking-[.07em] text-faint font-bold pb-1">Score trend</div>
                    <Show
                      when={(trends()?.points.length ?? 0) > 0}
                      fallback={<div class="grid place-items-center h-24 text-muted text-[12.5px]">Not enough graded calls yet</div>}
                    >
                      <LineChart points={trends()!.points.map((p) => ({ label: p.date, value: p.avg_score, meta: `${p.calls} call${p.calls === 1 ? "" : "s"}` }))} height={110} />
                    </Show>
                  </div>
                </div>
              </div>
            </>
          );
        }}
      </AsyncBoundary>
    </AppShell>
  );
}
