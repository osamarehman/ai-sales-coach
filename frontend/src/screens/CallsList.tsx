import { createResource, createSignal, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/icons";
import { Avatar, OutcomeBadge, StatusPill, AsyncBoundary, EmptyState } from "../components/ui";
import { getCalls, getLeaderboard, repName, toCallRow } from "../lib/api";
import { isManager, useSession } from "../lib/session";

const PAGE_SIZE = 25;
const RANGES: { id: string; label: string; days: number | null }[] = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "", label: "All time", days: null },
];

function dateRange(id: string): { from?: string; to?: string } {
  const days = RANGES.find((r) => r.id === id)?.days;
  if (!days) return {};
  return { from: new Date(Date.now() - days * 86_400_000).toISOString(), to: new Date().toISOString() };
}

export function CallsList() {
  const nav = useNavigate();
  const me = useSession();
  const manager = isManager(me);

  const [outcome, setOutcome] = createSignal("");
  const [repId, setRepId] = createSignal("");
  const [range, setRange] = createSignal("30");
  const [search, setSearch] = createSignal("");
  const [page, setPage] = createSignal(1);
  const resetPage = () => setPage(1);

  const [board] = createResource(() => (manager ? getLeaderboard() : Promise.resolve({ reps: [] })));
  const reps = () => board()?.reps ?? [];

  const query = () => ({ page: page(), outcome: outcome(), repId: repId(), range: range() });
  const [data] = createResource(query, (q) =>
    getCalls({
      page: q.page,
      page_size: PAGE_SIZE,
      outcome: (q.outcome || undefined) as "qualified" | "disqualified" | undefined,
      rep: q.repId || undefined,
      ...dateRange(q.range),
    }),
  );

  const allRows = () => (data()?.calls ?? []).map(toCallRow);
  const rows = () => {
    const s = search().trim().toLowerCase();
    if (!s) return allRows();
    return allRows().filter((r) => r.title.toLowerCase().includes(s) || r.advisor.toLowerCase().includes(s));
  };
  const total = () => Number(data()?.total ?? 0);
  const from = () => (total() === 0 ? 0 : (page() - 1) * PAGE_SIZE + 1);
  const to = () => Math.min(page() * PAGE_SIZE, total());
  const hasNext = () => page() * PAGE_SIZE < total();
  const anyFilter = () => Boolean(outcome() || repId() || range() !== "30" || search());

  return (
    <AppShell
      crumbs={<b class="text-ink">Calls</b>}
      actions={<button class="btn btn-sm">Export</button>}
    >
      <div class="flex items-start gap-4 mb-5">
        <div class="flex-1">
          <h1 class="text-[22px] font-bold tracking-tight text-ink">Calls</h1>
          <p class="text-muted text-[13.5px] mt-0.5">{manager ? "Every analyzed call across your team." : "Your analyzed calls."}</p>
        </div>
      </div>

      {/* filter bar */}
      <div class="flex flex-wrap items-center gap-2.5 mb-3.5">
        <div class="input flex items-center gap-2 flex-1 min-w-[180px] max-w-[240px] !py-0">
          <Icon name="search" size={15} class="text-faint shrink-0" />
          <input class="bg-transparent outline-none w-full text-[13px] text-ink placeholder:text-faint"
            placeholder="Search these results…" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
        </div>

        <Show when={manager}>
          <select class="input !w-auto" value={repId()} onChange={(e) => { setRepId(e.currentTarget.value); resetPage(); }}>
            <option value="">All reps</option>
            <For each={reps()}>{(r) => <option value={r.rep_id}>{repName(r)}</option>}</For>
          </select>
        </Show>

        <select class="input !w-auto" value={range()} onChange={(e) => { setRange(e.currentTarget.value); resetPage(); }}>
          <For each={RANGES}>{(r) => <option value={r.id}>{r.label}</option>}</For>
        </select>

        <select class="input !w-auto" value={outcome()} onChange={(e) => { setOutcome(e.currentTarget.value); resetPage(); }}>
          <option value="">Any outcome</option>
          <option value="qualified">Qualified</option>
          <option value="disqualified">Disqualified</option>
        </select>

        <div class="flex-1" />
        <span class="text-muted text-[12.5px]">{total()} result{total() === 1 ? "" : "s"}</span>
      </div>

      <AsyncBoundary data={data}>
        {() => (
          <Show
            when={rows().length > 0}
            fallback={
              <EmptyState
                title={anyFilter() ? "No calls match these filters" : "No calls yet"}
                hint={anyFilter()
                  ? "Try widening the date range or clearing a filter."
                  : "Analyzed calls appear here as Fathom sends them in. Connect Fathom in Settings to get started."}
              />
            }
          >
            <div class="card overflow-hidden">
              <div class="overflow-x-auto">
                <table class="table">
                  <thead>
                    <tr><th>Call</th><th>Advisor</th><th>Date</th><th>Score</th><th>Outcome</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    <For each={rows()}>
                      {(c) => (
                        <tr onClick={() => nav(`/calls/${c.id}`)}>
                          <td><div class="flex items-center gap-2.5"><Avatar name={c.prospect} size={22} /><b class="text-ink">{c.title}</b></div></td>
                          <td>{c.advisor}</td>
                          <td class="text-muted">{c.date}</td>
                          <td class="font-bold text-ink">{c.totalScore != null ? c.totalScore.toFixed(1) : <span class="text-muted font-normal">—</span>}</td>
                          <td><Show when={c.outcome} fallback={<span class="text-muted">—</span>}>{(o) => <OutcomeBadge outcome={o()} />}</Show></td>
                          <td><StatusPill status={c.status} /></td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <div class="flex items-center justify-between px-4 py-3 border-t" style={{ "border-color": "var(--line)" }}>
                <span class="text-muted text-[12.5px]">
                  {from()}–{to()} of {total()}
                  <Show when={search().trim()}> · {rows().length} shown</Show>
                </span>
                <div class="flex gap-2.5">
                  <button class="btn btn-sm" disabled={page() <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</button>
                  <button class="btn btn-sm" disabled={!hasNext()} onClick={() => setPage((p) => p + 1)}>Next →</button>
                </div>
              </div>
            </div>
          </Show>
        )}
      </AsyncBoundary>
    </AppShell>
  );
}
