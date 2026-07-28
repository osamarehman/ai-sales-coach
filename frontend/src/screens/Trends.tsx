import { createResource, For, Show } from "solid-js";
import { AppShell } from "../components/AppShell";
import { Avatar, CardHeader, AsyncBoundary, EmptyState, Spinner } from "../components/ui";
import { LineChart, Donut } from "../components/charts";
import { findRepId, getCalls, getLeaderboard, getRepTrends, repName } from "../lib/api";
import { isManager, useSession } from "../lib/session";

const MAX_PER_CRITERION = 9.09;

function BarRow(props: { label: string; value: string; pct: number }) {
  return (
    <div class="mb-3.5 last:mb-0">
      <div class="flex justify-between mb-2 text-[13px]"><span class="text-ink-2">{props.label}</span><span class="mono text-muted">{props.value}</span></div>
      <div class="h-2 rounded-full" style={{ background: "var(--surface-2)" }}>
        <div class="h-2 rounded-full" style={{ width: `${Math.max(3, props.pct)}%`, background: "var(--accent)" }} />
      </div>
    </div>
  );
}

export function Trends() {
  const me = useSession();
  const manager = isManager(me);
  const [calls] = createResource(() => getCalls({ page_size: 100 }));
  const myRepId = () => {
    const cs = calls()?.calls;
    return cs ? findRepId(cs, me.user.email) : undefined;
  };
  const [trends] = createResource(myRepId, (id) => getRepTrends(id));
  const [board] = createResource(() => (manager ? getLeaderboard() : Promise.resolve({ reps: [] })));

  const mix = () => {
    const analyzed = (calls()?.calls ?? []).filter((c) => c.status === "analyzed");
    const q = analyzed.filter((c) => c.outcome === "qualified").length;
    const dq = analyzed.filter((c) => c.outcome === "disqualified").length;
    const total = q + dq || 1;
    return { q, dq, qPct: Math.round((q / total) * 100), dqPct: Math.round((dq / total) * 100) };
  };

  // Inside the calls boundary: undefined repId means "loaded, but no calls for you".
  const noPersonalData = () => myRepId() === undefined;

  return (
    <AppShell crumbs={<b class="text-ink">Trends</b>}>
      <div class="mb-5">
        <h1 class="text-[22px] font-bold tracking-tight text-ink">Trends</h1>
        <p class="text-muted text-[13.5px] mt-0.5">How your scores move over time and which criteria drive them.</p>
      </div>

      <AsyncBoundary data={calls}>
        {() => (
          <>
            <div class="grid gap-4 lg:grid-cols-[2fr_1fr] mb-4">
              <div class="card p-[18px]">
                <div class="flex items-center justify-between">
                  <b class="text-ink">Average score over time</b>
                  <Show when={trends()}>{(t) => <span class="text-muted text-xs mono">{t().points.length} day{t().points.length === 1 ? "" : "s"}</span>}</Show>
                </div>
                <div class="mt-2">
                  <Show when={trends()} fallback={noPersonalData() ? <p class="text-muted text-[13px] py-10 text-center">No graded calls for you yet.</p> : <Spinner />}>
                    {(t) => (
                      <Show when={t().points.length > 0} fallback={<p class="text-muted text-[13px] py-10 text-center">Not enough graded calls yet.</p>}>
                        <LineChart points={t().points.map((p) => ({ label: p.date, value: p.avg_score, meta: `${p.calls} call${p.calls === 1 ? "" : "s"}` }))} height={180} />
                        <div class="flex justify-between text-[11px] text-faint mt-1 px-1">
                          <span>{t().points[0].date}</span>
                          <Show when={t().points.length > 1}><span>{t().points[t().points.length - 1].date}</span></Show>
                        </div>
                      </Show>
                    )}
                  </Show>
                </div>
              </div>
              <div class="card p-[18px]">
                <div class="text-[11px] uppercase tracking-[.07em] text-faint font-bold pb-3">Outcome mix</div>
                <Donut
                  segments={[
                    { value: mix().q, color: "var(--pos)", label: "Qualified" },
                    { value: mix().dq, color: "var(--dq)", label: "Disqualified" },
                  ]}
                  centerTop={<>{mix().q + mix().dq === 0 ? "—" : `${mix().qPct}%`}</>}
                  centerSub={mix().q + mix().dq === 0 ? "no data" : "qualified"}
                />
                <div class="flex justify-center gap-4 mt-3.5 text-[12.5px]">
                  <span class="pill"><span class="dot" style={{ background: "var(--pos)" }} />Qualified {mix().q}</span>
                  <span class="pill"><span class="dot" style={{ background: "var(--dq)" }} />Disqualified {mix().dq}</span>
                </div>
              </div>
            </div>

            <div class="grid gap-4" classList={{ "lg:grid-cols-2": manager }}>
              <div class="card">
                <CardHeader title="Per-criterion average"><span class="text-muted text-xs">out of 9.09</span></CardHeader>
                <div class="px-[18px] py-3.5">
                  <Show when={trends()} fallback={noPersonalData() ? <p class="text-muted text-[13px] py-2">No criteria data yet.</p> : <Spinner />}>
                    {(t) => (
                      <Show when={t().by_criterion.length > 0} fallback={<p class="text-muted text-[13px] py-2">No criteria data yet.</p>}>
                        <For each={t().by_criterion}>
                          {(c) => <BarRow label={c.label} value={c.avg_score.toFixed(1)} pct={(c.avg_score / MAX_PER_CRITERION) * 100} />}
                        </For>
                      </Show>
                    )}
                  </Show>
                </div>
              </div>

              <Show when={manager}>
                <div class="card overflow-hidden">
                  <CardHeader title="Leaderboard"><span class="chip chip-dq"><span class="dot" />Managers only</span></CardHeader>
                  <AsyncBoundary data={board}>
                    {(b) => (
                      <Show when={b.reps.length > 0} fallback={<div class="p-6"><EmptyState title="No ranked reps yet" /></div>}>
                        <div class="overflow-x-auto">
                          <table class="table">
                            <thead><tr><th>#</th><th>Rep</th><th>Avg</th><th>Calls</th></tr></thead>
                            <tbody>
                              <For each={b.reps}>
                                {(r, i) => (
                                  <tr>
                                    <td class="text-muted">{i() + 1}</td>
                                    <td><div class="flex items-center gap-2.5"><Avatar name={repName(r)} size={22} /><b class="text-ink">{repName(r)}</b></div></td>
                                    <td class="font-bold text-ink"><Show when={r.avg_score != null} fallback={<span class="text-muted font-normal">—</span>}>{r.avg_score!.toFixed(1)}</Show></td>
                                    <td class="text-muted">{r.calls_analyzed}</td>
                                  </tr>
                                )}
                              </For>
                            </tbody>
                          </table>
                        </div>
                      </Show>
                    )}
                  </AsyncBoundary>
                </div>
              </Show>
            </div>
          </>
        )}
      </AsyncBoundary>
    </AppShell>
  );
}
