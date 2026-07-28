import { createResource, For, Show } from "solid-js";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/icons";
import { Avatar, AsyncBoundary, EmptyState } from "../components/ui";
import { getLeaderboard, repName } from "../lib/api";

export function Team() {
  const [data] = createResource(getLeaderboard);
  const reps = () => data()?.reps ?? [];

  return (
    <AppShell
      crumbs={<b class="text-ink">Team</b>}
      actions={<button class="btn btn-sm btn-primary"><Icon name="plus" size={14} />Invite rep</button>}
    >
      <div class="mb-5">
        <h1 class="text-[22px] font-bold tracking-tight text-ink">Team</h1>
        <p class="text-muted text-[13.5px] mt-0.5">Reps ranked by average H.E.A.R.T. score.</p>
      </div>

      <AsyncBoundary data={data}>
        {() => (
          <Show
            when={reps().length > 0}
            fallback={<EmptyState title="No graded calls yet" hint="Rankings appear once your reps' calls have been analyzed." />}
          >
            <div class="card overflow-hidden">
              <div class="overflow-x-auto">
                <table class="table">
                  <thead><tr><th>#</th><th>Rep</th><th>Avg score</th><th>Calls analyzed</th><th>Disqualified</th></tr></thead>
                  <tbody>
                    <For each={reps()}>
                      {(r, i) => (
                        <tr>
                          <td class="text-muted">{i() + 1}</td>
                          <td>
                            <div class="flex items-center gap-2.5">
                              <Avatar name={repName(r)} size={22} />
                              <div class="leading-tight">
                                <b class="text-ink block">{repName(r)}</b>
                                <small class="text-muted">{r.email}</small>
                              </div>
                            </div>
                          </td>
                          <td class="font-bold text-ink">
                            <Show when={r.avg_score != null} fallback={<span class="text-muted font-normal">—</span>}>{r.avg_score!.toFixed(1)}</Show>
                          </td>
                          <td class="text-muted">{r.calls_analyzed}</td>
                          <td>
                            <Show when={r.disqualified_count > 0} fallback={<span class="text-muted">0</span>}>
                              <span class="chip chip-dq"><span class="dot" />{r.disqualified_count}</span>
                            </Show>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </div>
          </Show>
        )}
      </AsyncBoundary>
    </AppShell>
  );
}
