import { createResource, createSignal, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/icons";
import { ScoreDial, RatingChip, OutcomeBadge, StatusPill, CardHeader, GroupLabel, AsyncBoundary, EmptyState } from "../components/ui";
import { CRITERIA_GROUPS } from "../lib/types";
import type { Evaluation, Analysis, CriticalMoment, CallRow } from "../lib/types";
import { getCall, detailToCallRow, toAnalysis } from "../lib/api";

const impactColor: Record<string, string> = {
  Positive: "var(--pos)", Negative: "var(--neg)", Neutral: "var(--faint)",
};

function CriterionRow(props: { evaluation: Evaluation; defaultOpen?: boolean }) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false);
  const hasDetail = () => Boolean(props.evaluation.reasoning) || props.evaluation.timestamp_events.length > 0;
  return (
    <div class="border-b last:border-b-0" style={{ "border-color": "var(--line)" }}>
      <button
        class="w-full flex items-center gap-3 px-[18px] py-3.5 text-left"
        classList={{ "cursor-pointer hover:bg-surface-2": hasDetail() }}
        onClick={() => hasDetail() && setOpen(!open())}
      >
        <span class="font-semibold text-ink flex-1 min-w-0">{props.evaluation.criterion}</span>
        <RatingChip rating={props.evaluation.rating} />
        <span class="font-bold text-ink tabular-nums w-12 text-right">{props.evaluation.score.toFixed(2)}</span>
        <Show when={hasDetail()}>
          <Icon name="chevronDown" size={15} class={`text-faint transition-transform ${open() ? "rotate-180" : ""}`} />
        </Show>
      </button>
      <Show when={open()}>
        <div class="px-[18px] pb-4 -mt-1">
          <p class="text-muted mb-2.5">{props.evaluation.reasoning}</p>
          <For each={props.evaluation.timestamp_events}>
            {(ev) => (
              <div class="card mb-2 last:mb-0" style={{ background: "var(--surface-2)", "box-shadow": "none" }}>
                <div class="flex items-center gap-2.5 px-3 py-2.5 border-b" style={{ "border-color": "var(--line)" }}>
                  <span class="mono text-muted text-xs">{ev.timestamp}</span>
                  <b class="text-ink text-[13px]">{ev.speaker}</b>
                  <span class="pill ml-auto"><span class="dot" style={{ background: impactColor[ev.impact] }} />{ev.impact}</span>
                </div>
                <div class="px-3 py-2.5 text-muted italic">“{ev.quote}”</div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

const momentChip: Record<CriticalMoment["type"], string> = {
  "Strong Move": "chip-yes", "Missed Opportunity": "chip-partial", "Critical Error": "chip-no",
};

function Report(props: { call: CallRow; analysis: Analysis }) {
  const a = () => props.analysis;
  const evalByKey = (key: string) => a().evaluations.find((e) => e.key === key);
  let firstOpen = true;
  const takeFirstOpen = () => { const v = firstOpen; firstOpen = false; return v; };

  return (
    <>
      {/* Hero */}
      <div class="card p-[18px] mb-4">
        <div class="flex flex-col sm:flex-row items-start gap-5">
          <ScoreDial score={a().summary.total_score} max={a().summary.max_possible} />
          <div class="flex-1 min-w-0 flex flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2.5">
              <h1 class="text-xl font-bold tracking-tight text-ink">{props.call.title}</h1>
              <Show when={props.call.outcome}>{(o) => <OutcomeBadge outcome={o()} />}</Show>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
              <span>Advisor <b class="mono text-ink">{a().call_metadata.advisor_name}</b></span>
              <span>Prospect <b class="mono text-ink">{a().call_metadata.prospect_name}</b></span>
              <span>{props.call.date}</span>
            </div>
            <p class="text-muted mt-1.5 max-w-[70ch]">
              <b class="text-ink">Overall assessment.</b> {a().summary.overall_assessment}
            </p>
          </div>
        </div>
      </div>

      {/* Disqualification banner */}
      <Show when={a().disqualification_summary.was_disqualified}>
        <div class="flex gap-3 p-4 rounded-[12px] mb-4" style={{ border: "1px solid var(--dq)", background: "var(--dq-tint)" }}>
          <span class="w-5 h-5 rounded-full shrink-0 mt-0.5" style={{ border: "2px solid var(--dq-ink)" }} />
          <div class="text-[13px]">
            <b class="text-ink block">Call disqualified</b>
            <span class="text-ink-2">
              {a().disqualification_summary.disqualified_criteria.join(", ")}
              <Show when={a().disqualification_summary.disqualification_reasoning}> — {a().disqualification_summary.disqualification_reasoning}</Show>
            </span>
          </div>
        </div>
      </Show>

      <div class="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Left: criteria breakdown */}
        <div class="flex flex-col gap-4">
          <For each={CRITERIA_GROUPS}>
            {(group) => (
              <div class="card">
                <GroupLabel>{group.label}</GroupLabel>
                <For each={group.keys}>
                  {(key) => {
                    const ev = evalByKey(key);
                    return (
                      <Show when={ev}>
                        {(e) => <CriterionRow evaluation={e()} defaultOpen={takeFirstOpen()} />}
                      </Show>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>

        {/* Right rail */}
        <div class="flex flex-col gap-4">
          <Show when={a().critical_moments.length > 0}>
            <div class="card">
              <CardHeader title="Critical moments" />
              <div class="py-1.5">
                <For each={a().critical_moments}>
                  {(m) => (
                    <div class="flex gap-2.5 items-start px-4 py-2.5">
                      <span class={`chip ${momentChip[m.type] ?? "chip-dq"} mt-0.5`}><span class="dot" /></span>
                      <div class="text-[13px]">
                        <b class="text-ink">{m.type}</b> <span class="text-muted">· {m.timestamp}</span>
                        <br /><span class="text-muted text-[12.5px]">{m.description}</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={a().summary.strengths.length > 0}>
            <div class="card">
              <CardHeader title="Strengths" />
              <ul class="px-[18px] py-3 space-y-2">
                <For each={a().summary.strengths}>
                  {(s) => (
                    <li class="text-ink-2 flex gap-2">
                      <Icon name="check" size={15} class="mt-0.5 shrink-0" style={{ color: "var(--pos)" }} />
                      <span>{s.strength} <span class="mono text-faint text-xs">{s.timestamps.join(" · ")}</span></span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>

          <Show when={a().summary.areas_for_improvement.length > 0}>
            <div class="card">
              <CardHeader title="Areas for improvement" />
              <div class="px-[18px] py-3 space-y-3.5">
                <For each={a().summary.areas_for_improvement}>
                  {(area) => (
                    <div>
                      <b class="text-ink">{area.area}</b>
                      <p class="text-[12.5px] mt-1"><b class="text-ink-2">Try:</b> {area.recommendation} <span class="mono text-faint">{area.timestamps.join(" · ")}</span></p>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </>
  );
}

export function Scorecard() {
  const params = useParams();
  const [detail] = createResource(() => params.id, getCall);

  const crumbTitle = () => detail()?.call.title ?? "Call";

  return (
    <AppShell
      crumbs={<><span>Calls</span> / <b class="text-ink">{crumbTitle()}</b></>}
      actions={
        <>
          <button class="btn btn-sm"><Icon name="share" size={14} />Share</button>
          <button class="btn btn-sm"><Icon name="external" size={14} />Recording</button>
        </>
      }
    >
      <AsyncBoundary data={detail}>
        {(d) => {
          const analysis = toAnalysis(d);
          const call = detailToCallRow(d);
          return (
            <Show
              when={analysis}
              fallback={
                <EmptyState
                  title={call.status === "failed" ? "Analysis failed" : "Analysis in progress"}
                  hint={call.status === "failed"
                    ? "We couldn't grade this call. It will retry automatically, or you can re-trigger it from the recorder."
                    : "This call is being graded against the H.E.A.R.T. rubric. The scorecard will appear here when it's ready."}
                >
                  <StatusPill status={call.status} />
                </EmptyState>
              }
            >
              {(a) => <Report call={call} analysis={a()} />}
            </Show>
          );
        }}
      </AsyncBoundary>
    </AppShell>
  );
}
